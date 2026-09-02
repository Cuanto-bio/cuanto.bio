import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
  default: Object.assign(
    vi.fn(() => Promise.resolve([])),
    {
      json: (v: unknown) => v,
    },
  ),
}));

vi.mock('./auth', () => ({
  getClient: vi.fn(),
  isScopeSufficient: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  default: { child: () => ({ warn: vi.fn(), error: vi.fn() }) },
}));

import { PdsScopeInsufficientError, PdsSessionExpiredError } from './pds';
import { pdsAuthErrorFail, pdsAuthErrorResponse } from './pds-error-response';

describe('pdsAuthErrorResponse', () => {
  test('maps PdsScopeInsufficientError to 403 permissionRequired', async () => {
    const res = pdsAuthErrorResponse(new PdsScopeInsufficientError());
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({
      error: 'pds_permission_required',
      permissionRequired: true,
    });
  });

  test('maps PdsSessionExpiredError to 401 sessionExpired', async () => {
    const res = pdsAuthErrorResponse(new PdsSessionExpiredError());
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({
      error: 'pds_session_expired',
      sessionExpired: true,
    });
  });

  test('checks the scope subclass before the session parent', () => {
    // PdsScopeInsufficientError extends PdsSessionExpiredError; a naive
    // instanceof order would misreport it as a plain expiry.
    const res = pdsAuthErrorResponse(new PdsScopeInsufficientError());
    expect(res?.status).toBe(403);
  });

  test('returns null for an unrelated error so the caller keeps its fallback', () => {
    expect(pdsAuthErrorResponse(new Error('boom'))).toBeNull();
  });
});

describe('pdsAuthErrorFail', () => {
  test('maps PdsScopeInsufficientError to a 403 ActionFailure', () => {
    expect(pdsAuthErrorFail(new PdsScopeInsufficientError())).toMatchObject({
      status: 403,
      data: { permissionRequired: true, error: 'pds_permission_required' },
    });
  });

  test('maps PdsSessionExpiredError to a 401 ActionFailure', () => {
    expect(pdsAuthErrorFail(new PdsSessionExpiredError())).toMatchObject({
      status: 401,
      data: { sessionExpired: true, error: 'pds_session_expired' },
    });
  });

  test('returns null for an unrelated error', () => {
    expect(pdsAuthErrorFail(new Error('boom'))).toBeNull();
  });
});
