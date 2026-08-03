import { MediaQuery } from 'svelte/reactivity';
import { browser } from '$app/environment';
import { isNative } from '$lib/platform';
import {
  type BrowserFamily,
  detectBrowserFamily,
  isIOS as detectIOS,
} from './detect';
import {
  isInstallPromptDismissed,
  markInstallPromptDismissed,
} from './dismiss';

// Singleton holding all reactive state for the PWA install prompt and the logic
// that decides when to offer it. Mirrors the app's other client singletons
// (`useOnline`, `nav`). A single instance is shared across the app so the footer
// button and the post-follow auto-trigger drive the same dialog.
//
// We deliberately do NOT intercept `beforeinstallprompt`: on Chromium that would
// suppress Chrome's own (well-tuned) install prompt in exchange for a one-tap
// dialog we'd have to out-convert. Instead we let Chrome prompt Chromium users
// itself, and our UI only adds contextual manual instructions for platforms
// Chrome can't help (iOS Safari above all, which has no native install prompt).
class PwaInstall {
  // True once we know the app is installed (appinstalled fired this session or
  // getInstalledRelatedApps reported our webapp). Used to suppress our prompt.
  #installed = $state(false);
  #initialized = false;
  #touch = browser ? new MediaQuery('(pointer: coarse)') : null;
  #standalone = browser ? new MediaQuery('(display-mode: standalone)') : null;

  // Dialog visibility. `dialogAuto` records that the dialog was auto-shown after
  // a follow, so closing it counts as a dismissal.
  dialogOpen = $state(false);
  dialogAuto = $state(false);

  // Registers window listeners. Idempotent; called from the root layout onMount.
  init() {
    if (!browser || this.#initialized) return;
    this.#initialized = true;

    // Chrome shows its own install prompt; we just note the result so we stop
    // offering our instructions once the app is installed.
    window.addEventListener('appinstalled', () => {
      this.#installed = true;
      markInstallPromptDismissed();
    });

    // Android Chromium enhancement: authoritatively detect our own install
    // across sessions so we can suppress the prompt for already-installed users.
    const nav = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>>;
    };
    // In theory, getInstalledRelatedApps() only returns app related to our manifest
    nav
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.some((app) => app.platform === 'webapp')) {
          this.#installed = true;
        }
      })
      .catch(() => {
        // Unsupported or rejected — fall back to the other signals.
      });
  }

  // True when already running as an installed/standalone PWA.
  get isStandalone(): boolean {
    if (this.#standalone?.current) return true;
    return (
      browser &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  get isTouch(): boolean {
    return this.#touch?.current ?? false;
  }

  // Exposed for the debug readout in InstallFooter.
  get installed(): boolean {
    return this.#installed;
  }

  get isIOS(): boolean {
    return browser ? detectIOS(navigator.userAgent, window) : false;
  }

  get browserFamily(): BrowserFamily {
    return browser ? detectBrowserFamily(navigator.userAgent) : 'other';
  }

  // Whether to offer instructions at all: only on a touch device that isn't
  // already running standalone and isn't detected as installed. Gates both the
  // footer entry point and the auto-trigger.
  //
  // Never in the native shell. None of the other conditions catch that case: a
  // WKWebView is a touch device, does not match `display-mode: standalone`, and
  // has no `appinstalled` event — so without this the app would invite someone
  // to install the PWA from inside the installed native app.
  get shouldOffer(): boolean {
    return (
      !isNative() && this.isTouch && !this.isStandalone && !this.#installed
    );
  }

  open(auto = false): void {
    this.dialogAuto = auto;
    this.dialogOpen = true;
  }

  // Auto-show after a successful follow, unless suppressed or already dismissed.
  maybeAutoPrompt(): void {
    if (this.shouldOffer && !isInstallPromptDismissed()) this.open(true);
  }

  // Any close of an auto-shown dialog counts as a dismissal so it never
  // auto-appears again. Manual opens (footer button) do not set the flag.
  closeDialog(): void {
    if (this.dialogAuto) markInstallPromptDismissed();
    this.dialogOpen = false;
    this.dialogAuto = false;
  }
}

export const install = new PwaInstall();
