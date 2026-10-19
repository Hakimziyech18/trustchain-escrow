import { jest, describe, beforeEach, it, expect } from '@jest/globals';

const main = { clean: jest.fn() };
const deadLetter = { clean: jest.fn() };

jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  stellarEventsQueue: main,
  deadLetterQueue: deadLetter,
  queueMetrics: {},
  connection: {},
}));

const { default: router } = await import('../api/routes/queueDashboardRoutes.js');
const handler = router.stack.find((layer) => layer.route?.path === '/cleanup').route.stack[0].handle;

async function cleanup(body) {
  const res = {
    statusCode: 200,
    result: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.result = value; return this; },
  };
  await handler({ body }, res);
  return res;
}

describe('queue health retention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    main.clean.mockResolvedValue([]);
    deadLetter.clean.mockResolvedValue([]);
  });

  it('removes a bounded batch of old completed jobs without exposing IDs', async () => {
    main.clean.mockResolvedValue(['private-1', 'private-2']);
    const res = await cleanup({});
    expect(res.statusCode).toBe(200);
    expect(main.clean).toHaveBeenCalledWith(86400000, 100, 'completed');
    expect(res.result).toEqual({ message: 'Cleaned up 2 completed jobs', cleanedCount: 2 });
  });

  it('routes a bounded cleanup to the dead-letter failed queue', async () => {
    const res = await cleanup({ queue: 'dead-letter', state: 'failed', keepLast: 3, olderThanMs: 60000 });
    expect(res.statusCode).toBe(200);
    expect(deadLetter.clean).toHaveBeenCalledWith(60000, 3, 'failed');
    expect(main.clean).not.toHaveBeenCalled();
  });

  it.each([
    { state: 'active' },
    { queue: 'unknown' },
    { keepLast: 0 },
    { keepLast: 1001 },
    { keepLast: '100' },
    { olderThanMs: 0 },
    { olderThanMs: Number.MAX_SAFE_INTEGER },
  ])('refuses unsafe or malformed cleanup parameters: %j', async (body) => {
    const res = await cleanup(body);
    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: 'Invalid cleanup parameters' });
    expect(main.clean).not.toHaveBeenCalled();
    expect(deadLetter.clean).not.toHaveBeenCalled();
  });

  it('returns a deterministic error without leaking dependency details', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      main.clean.mockRejectedValue(new Error('redis://credential@private-host'));
      const res = await cleanup({});
      expect(res.statusCode).toBe(500);
      expect(res.result).toEqual({ error: 'Failed to cleanup jobs' });
      expect(spy).toHaveBeenCalledWith('[Dashboard] Queue cleanup failed');
    } finally {
      spy.mockRestore();
    }
  });
});
