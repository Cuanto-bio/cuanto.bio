import { describe, expect, test } from 'vitest';

describe('GET /api/ping', () => {
  test('returns 200 OK', async () => {
    const { GET } = await import('./+server');
    const resp = await GET();
    expect(resp.status).toBe(200);
  });

  test('sets Cache-Control: no-store', async () => {
    const { GET } = await import('./+server');
    const resp = await GET();
    expect(resp.headers.get('Cache-Control')).toBe('no-store');
  });
});
