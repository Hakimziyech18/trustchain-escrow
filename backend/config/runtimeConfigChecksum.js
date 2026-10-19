/**
 * Stable checksum for an allow-listed, non-secret runtime configuration.
 * Caller supplies the loader; neither credentials nor raw failures are logged.
 * This module does not change existing runtime endpoints by itself.
 */
import { createHash } from 'node:crypto';

export function checksumRuntimeConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid runtime configuration');
  }
  const { stellarNetwork, platformFeePercent, allowedOrigins } = value;
  if (
    typeof stellarNetwork !== 'string' || !stellarNetwork ||
    typeof allowedOrigins !== 'string' ||
    typeof platformFeePercent !== 'number' || !Number.isFinite(platformFeePercent)
  ) {
    throw new Error('Invalid runtime configuration');
  }
  // Explicit allow-list also makes changes to the input object's key order
  // irrelevant and prevents keys named password/token/secret entering the hash.
  const safeConfig = { stellarNetwork, platformFeePercent, allowedOrigins };
  return createHash('sha256').update(JSON.stringify(safeConfig)).digest('hex');
}

/** Load, time out, validate and retry a runtime-config dependency. */
export async function readRuntimeConfigChecksum(loader, { timeoutMs = 1000, retries = 2 } = {}) {
  if (
    typeof loader !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 30000 || !Number.isSafeInteger(retries) || retries < 0 || retries > 5
  ) {
    throw new Error('Invalid checksum options');
  }
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timeout;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => loader(controller.signal)),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Runtime configuration timeout'));
          }, timeoutMs);
        }),
      ]);
      return checksumRuntimeConfig(result);
    } catch {
      // Never leak dependency error strings, credentials or responses.
      if (attempt === retries) throw new Error('Runtime configuration unavailable');
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
  throw new Error('Runtime configuration unavailable');
}
