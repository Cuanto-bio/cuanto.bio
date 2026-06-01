import { browser } from '$app/environment';

// Persists whether the user has dismissed the auto-shown install prompt. Stored
// in localStorage because it is a purely client-side decision the server never
// needs (the whole install feature is gated on client-only signals) and it must
// survive reloads and app restarts. The `name:thing` key mirrors the sidebar's
// `sidebar:state` cookie convention. All access is guarded for the absence of
// localStorage (SSR, private mode, storage disabled) so callers never throw.

export const INSTALL_DISMISS_KEY = 'cuanto:install-prompt-dismissed';

export function isInstallPromptDismissed(): boolean {
  if (!browser) return false;
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markInstallPromptDismissed(): void {
  if (!browser) return;
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, 'true');
  } catch {
    // Storage unavailable (private mode / quota) — nothing to persist.
  }
}
