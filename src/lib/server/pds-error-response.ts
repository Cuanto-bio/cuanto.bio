import { fail, json } from '@sveltejs/kit';
import {
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from '$lib/server/pds';

// PDS writes fail in two ways the UI needs to tell apart: an expired session
// means "sign in again", while insufficient scope means "you are still signed
// in, but grant one more permission". Collapsing both into a single "your
// connection has expired" message reads as untrue when the token still works for
// everything else. Every write endpoint that talks to the PDS routes its auth
// failures through here so the split stays identical across the app; the
// follow endpoint was the first to make it (see ProtocolDetail.svelte).
//
// The body carries a machine-readable `error` slug (checked in
// src/lib/offline/upload.ts and src/routes/app/+layout.svelte) alongside a
// boolean flag (checked in ProtocolDetail.svelte and ProtocolForm.svelte).

type PdsAuthError =
  | {
      status: 403;
      body: {
        error: 'pds_permission_required';
        permissionRequired: true;
        message: string;
      };
    }
  | {
      status: 401;
      body: {
        error: 'pds_session_expired';
        sessionExpired: true;
        message: string;
      };
    };

function classifyPdsAuthError(err: unknown): PdsAuthError | null {
  // PdsScopeInsufficientError extends PdsSessionExpiredError, so check it first.
  if (err instanceof PdsScopeInsufficientError) {
    return {
      status: 403,
      body: {
        error: 'pds_permission_required',
        permissionRequired: true,
        message: err.message,
      },
    };
  }
  if (err instanceof PdsSessionExpiredError) {
    return {
      status: 401,
      body: {
        error: 'pds_session_expired',
        sessionExpired: true,
        message: err.message,
      },
    };
  }
  return null;
}

// For +server.ts route handlers: a JSON Response for a PDS auth failure, or null
// if `err` is something else (the caller keeps its own fallback: rethrow, 502,
// a logged "Failed to ..." body, etc.).
export function pdsAuthErrorResponse(err: unknown): Response | null {
  const mapped = classifyPdsAuthError(err);
  return mapped ? json(mapped.body, { status: mapped.status }) : null;
}

// For +page.server.ts form actions: an ActionFailure for a PDS auth failure, or
// null otherwise.
export function pdsAuthErrorFail(err: unknown) {
  const mapped = classifyPdsAuthError(err);
  return mapped ? fail(mapped.status, mapped.body) : null;
}
