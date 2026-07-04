import { describe, expect, it, vi } from 'vitest';
import {
  type InstallingWorker,
  type UpdatableRegistration,
  watchForUpdates,
} from './swUpdate';

// Minimal fakes for the service-worker registration/worker surface.
function makeInstalling(): InstallingWorker & { fireStateChange: () => void } {
  let listener: (() => void) | null = null;
  return {
    state: 'installing',
    postMessage: vi.fn(),
    addEventListener: (_type: 'statechange', l: () => void) => {
      listener = l;
    },
    fireStateChange: () => listener?.(),
  };
}

function makeRegistration(
  initial: Partial<UpdatableRegistration> = {},
): UpdatableRegistration & { fireUpdateFound: () => void } {
  let updateFound: (() => void) | null = null;
  return {
    waiting: initial.waiting ?? null,
    installing: initial.installing ?? null,
    addEventListener: (_type: 'updatefound', l: () => void) => {
      updateFound = l;
    },
    fireUpdateFound: () => updateFound?.(),
  };
}

describe('watchForUpdates', () => {
  it('prompts immediately when a worker is already waiting and controlled', () => {
    const waiting = { postMessage: vi.fn() };
    const reg = makeRegistration({ waiting });
    const onReady = vi.fn();

    watchForUpdates(reg, onReady, () => true);

    expect(onReady).toHaveBeenCalledWith(waiting);
  });

  it('does NOT prompt for an already-waiting worker on first install (no controller)', () => {
    const waiting = { postMessage: vi.fn() };
    const reg = makeRegistration({ waiting });
    const onReady = vi.fn();

    watchForUpdates(reg, onReady, () => false);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('prompts when an installing worker reaches installed while controlled', () => {
    const installing = makeInstalling();
    const reg = makeRegistration({ installing });
    const onReady = vi.fn();

    watchForUpdates(reg, onReady, () => true);
    expect(onReady).not.toHaveBeenCalled();

    installing.state = 'installed';
    installing.fireStateChange();

    expect(onReady).toHaveBeenCalledWith(installing);
  });

  it('does NOT prompt when the installing worker activates directly (first install)', () => {
    const installing = makeInstalling();
    const reg = makeRegistration({ installing });
    const onReady = vi.fn();

    // No controller: this is a first install, worker goes straight to activated.
    watchForUpdates(reg, onReady, () => false);

    installing.state = 'installed';
    installing.fireStateChange();

    expect(onReady).not.toHaveBeenCalled();
  });

  it('prompts for a future update announced via updatefound', () => {
    const reg = makeRegistration();
    const onReady = vi.fn();

    watchForUpdates(reg, onReady, () => true);
    expect(onReady).not.toHaveBeenCalled();

    // A new worker starts installing after the page loaded.
    const installing = makeInstalling();
    reg.installing = installing;
    reg.fireUpdateFound();

    installing.state = 'installed';
    installing.fireStateChange();

    expect(onReady).toHaveBeenCalledWith(installing);
  });

  it('does not fire while the installing worker is in intermediate states', () => {
    const installing = makeInstalling();
    const reg = makeRegistration({ installing });
    const onReady = vi.fn();

    watchForUpdates(reg, onReady, () => true);

    installing.state = 'installing';
    installing.fireStateChange();
    expect(onReady).not.toHaveBeenCalled();
  });
});
