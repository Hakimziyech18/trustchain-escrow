import { jest, describe, it, expect } from '@jest/globals';
import { checksumRuntimeConfig, readRuntimeConfigChecksum } from '../config/runtimeConfigChecksum.js';

const valid = {
  stellarNetwork: 'testnet',
  platformFeePercent: 2.5,
  allowedOrigins: 'https://app.example',
};

describe('runtime configuration checksum failure injection', () => {
  it('hashes only stable public fields regardless of input ordering or secrets', async () => {
    const a = checksumRuntimeConfig({ ...valid, password: 'never-hash-this' });
    const b = await readRuntimeConfigChecksum(async () => ({
      allowedOrigins: valid.allowedOrigins,
      stellarNetwork: valid.stellarNetwork,
      secret: 'different',
      platformFeePercent: valid.platformFeePercent,
    }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retries a timeout, then succeeds without waiting for the first loader', async () => {
    const loader = jest.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(valid);
    const hash = await readRuntimeConfigChecksum(loader, { timeoutMs: 5, retries: 1 });
    expect(hash).toBe(checksumRuntimeConfig(valid));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('retries malformed dependency responses', async () => {
    const loader = jest.fn().mockResolvedValueOnce({ unexpected: true }).mockResolvedValueOnce(valid);
    expect(await readRuntimeConfigChecksum(loader, { retries: 1 })).toBe(checksumRuntimeConfig(valid));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('fails safely after a bounded number of rejected attempts', async () => {
    const loader = jest.fn().mockRejectedValue(new Error('SECRET_PRIVATE_TOKEN'));
    await expect(readRuntimeConfigChecksum(loader, { retries: 2 }))
      .rejects.toThrow('Runtime configuration unavailable');
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('rejects unsafe option bounds without calling the dependency', async () => {
    const loader = jest.fn();
    await expect(readRuntimeConfigChecksum(loader, { retries: 999 }))
      .rejects.toThrow('Invalid checksum options');
    expect(loader).not.toHaveBeenCalled();
  });
});
