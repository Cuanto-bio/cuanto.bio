import { describe, expect, it, vi } from 'vitest';
import {
  type ControllerContainer,
  type InstallingWorker,
  reloadOnControllerChange,
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

function makeContainer(): ControllerContainer & {
  fireControllerChange: () => void;
} {
  let listener: (() => void) | null = null;
  return {
    addEventListener: (_type: 'controllerchange', l: () => void) => {
      listener = l;
    },
    fireControllerChange: () => listener?.(),
  };
}

describe('reloadOnControllerChange', () => {
  it('reloads when an update takes over an already-controlled page', () => {
    const container = makeContainer();
    const reload = vi.fn();

    // A controller is already present: this page is running the old worker's
    // assets, so once the new worker claims it the page must reload (issue #4).
    reloadOnControllerChange(container, () => true, reload);
    container.fireControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload when a first-install worker claims an uncontrolled page', () => {
    const container = makeContainer();
    const reload = vi.fn();

    // First install: no controller when the page loaded. The service worker's
    // activate handler calls clients.claim(), which fires controllerchange even
    // though the page is already running the newest assets. Reloading here
    // yanks the page out from under whatever the visitor just did -- it aborts
    // an in-flight navigation and drops unsaved form state (issue #42).
    reloadOnControllerChange(container, () => false, reload);
    container.fireControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads for an update that arrives after a first install claimed the page', () => {
    const container = makeContainer();
    const reload = vi.fn();

    // Page opened with no worker, so the first controllerchange is the install
    // claiming it and must not reload. But the page is controlled from then on,
    // so a later update in this same session is the issue #4 case and must.
    // Reading hasController() once up front would miss this.
    reloadOnControllerChange(container, () => false, reload);
    container.fireControllerChange();
    expect(reload).not.toHaveBeenCalled();

    container.fireControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at most once when controllerchange fires repeatedly', () => {
    const container = makeContainer();
    const reload = vi.fn();

    reloadOnControllerChange(container, () => true, reload);
    container.fireControllerChange();
    container.fireControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
