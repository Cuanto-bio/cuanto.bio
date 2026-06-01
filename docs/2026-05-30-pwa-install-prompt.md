# Plan: Prompt mobile users to install the PWA

## Revision (2026-06-01): one-click install abandoned

We initially built the **one-click install** path: intercept Chromium's
`beforeinstallprompt`, stash the event, and show our own **Install** button that
fires the native dialog. We abandoned it and now let Chrome show its own install
prompt instead. The reason: we could almost never actually show users that
button.

- `beforeinstallprompt` only fires on Chromium *and* only after Chrome's own
  engagement/installability heuristics are satisfied, so in practice the
  deferred event was rarely available when our dialog opened.
- Intercepting it means calling `event.preventDefault()`, which **suppresses
  Chrome's own well-tuned install prompt**. So a flaky one-click path was costing
  us Chrome's reliable default for no net gain.
- "Chromium-based" browsers (e.g. DuckDuckGo on Android) often don't implement
  the install APIs at all, and `getInstalledRelatedApps()` is effectively
  Chrome-on-Android only and per-browser, so cross-browser install detection
  isn't possible anyway.

**Current behavior:** we no longer listen for `beforeinstallprompt`. Chrome
prompts Chromium users itself; our dialog only ever shows manual,
browser-specific instructions. We still listen for `appinstalled` and call
`getInstalledRelatedApps()` to suppress our own prompt once the app is installed.
The sections below describe the original plan; where they mention `canInstall`,
`promptInstall()`, `deferredPrompt`, a one-click **Install** button, or the
`justInstalled` post-install message, those have been removed.

## Context

Cuanto.bio is an installable PWA (valid `static/manifest.webmanifest`, a
service worker with a fetch handler registered in `+layout.svelte`), but nothing
currently nudges users to install it. We want to:

- Show a succinct dialog explaining the user can install the site like an app.
- ~~Offer **one-click install** where the browser supports it (Chromium via
  `beforeinstallprompt`)~~ *(abandoned, see Revision above)*, and show
  **pictorial, browser-specific instructions** (WebKit/Safari, Firefox, generic
  fallback) on every platform. Chromium users get Chrome's own native prompt.
- Auto-show the dialog once after a signed-in user follows a protocol, unless
  they've already dismissed it.
- Provide a always-available, subtle entry point to re-open the dialog.

### Decisions (confirmed with user)

- **"Mobile" = touch device**: gate on `matchMedia('(pointer: coarse)')`, any
  width. Excludes desktop/laptop entirely (where "install like an app" is less
  relevant and one-click already exists separately).
- **Persistent entry point** = a **subtle, non-dismissible footer strip** at the
  end of page content on every screen (not the sidebar, not the bottom-nav More
  menu).
- **"Dismissed"** = any close (X / backdrop / Esc) of the *auto-shown* dialog
  sets a persistent flag; it then never auto-shows again. Manual reopen via the
  footer button always works.
- Never show the dialog, auto-trigger, or footer strip when already running
  standalone (installed) or on a non-touch device.

## Suppression signals (when to hide everything)

A combined `shouldOfferInstall` is true only when **all** hold:

1. Touch device — `matchMedia('(pointer: coarse)').matches`.
2. Not standalone — `!matchMedia('(display-mode: standalone)').matches &&
   (navigator as any).standalone !== true`.
3. Not detected-installed — `appinstalled` hasn't fired this session AND
   `navigator.getInstalledRelatedApps()` (Android Chromium enhancement) didn't
   report our webapp.

The auto-trigger adds: signed in (implicit — follow requires it) AND not
previously dismissed.

## New files

### `src/lib/pwa/detect.ts` (pure, unit-tested)
- `detectBrowserFamily(ua: string): 'chromium' | 'webkit' | 'firefox' | 'other'`.
  **Order matters — iOS-wrapped browsers must be handled first**, since on iOS
  every browser is WebKit regardless of its badge:
  - **iOS Safari** (iPad/iPhone WebKit, not `FxiOS`/`CriOS`/`EdgiOS`) → `webkit`
    (gets the specific share-sheet steps).
  - **Non-Safari iOS** (`FxiOS`, `CriOS`, `EdgiOS`) → `other`. Do **not** let
    these fall through to `firefox`/`chromium` — that would show the wrong
    (Android-style) steps. They get the generic Share-button instructions
    instead.
  - Desktop/Android Firefox (`Firefox`, *not* `FxiOS`) → `firefox`.
  - Chrome/Edg/Chromium/Samsung (*not* `CriOS`/`EdgiOS`) → `chromium`.
  - else → `other`.
- `isStandalone(win): boolean` — display-mode standalone OR `navigator.standalone`.
- `isIOS(ua, win): boolean` — iPhone/iPad/iPod, **plus iPadOS-reports-as-Mac**
  (Mac UA + touch points). Gates the bookmark alternative: iOS WebKit evicts the
  service-worker cache *and* IndexedDB after ~7 days of no interaction, so a
  bookmark is **not** a reliable offline path on iOS. Bookmarking is only offered
  where storage persists permanently, i.e. `!isIOS`.
- Keep these framework-free so they run in vitest's node env.

### `src/lib/pwa/dismiss.ts` (pure, unit-tested)
- `INSTALL_DISMISS_KEY = 'cuanto:install-prompt-dismissed'`.
- `isInstallPromptDismissed()` / `markInstallPromptDismissed()` over
  `localStorage`, guarded for absence (SSR / private mode).

### `src/lib/pwa/install.svelte.ts` (Svelte 5 runes singleton)
Holds reactive UI state and orchestration; delegates pure logic to the modules
above. Exposes a singleton (pattern mirrors `useOnline`, `nav`):
- ~~`$state` `deferredPrompt`~~ (removed), `installed`, `dialogOpen`,
  `dialogAuto`.
- Reactive touch/standalone via `new MediaQuery('(pointer: coarse)')` and
  `'(display-mode: standalone)')` from `svelte/reactivity` (same pattern as
  `src/lib/hooks/is-mobile.svelte.ts`).
- `init()` (idempotent, called from `+layout.svelte` `onMount`): registers
  `appinstalled` (set installed, mark dismissed) and runs
  `getInstalledRelatedApps()` if present. **No longer registers
  `beforeinstallprompt`** (see Revision), so Chrome keeps its own install prompt.
- ~~`canInstall` — `!!deferredPrompt`.~~ (removed)
- `shouldOffer` — combined suppression signals above.
- `browserFamily` — from `detectBrowserFamily(navigator.userAgent)`.
- `isIOS` — from `isIOS(...)`; passed to the dialog to gate the bookmark
  alternative (`showBookmarkAlt={!install.isIOS}`).
- `open(auto = false)` — sets `dialogOpen`/`dialogAuto`.
- `maybeAutoPrompt()` — if `shouldOffer && !isInstallPromptDismissed()` →
  `open(true)`.
- `closeDialog()` — clears `dialogOpen`; if `dialogAuto`,
  `markInstallPromptDismissed()`.
- ~~`promptInstall()` — `deferredPrompt.prompt()`, await `userChoice`, clear it,
  toast on accept, close dialog.~~ (removed)

### `src/lib/components/InstallPromptDialog.svelte`
- shadcn Dialog (`$lib/components/ui/dialog`), `bind:open` to `install.dialogOpen`
  with an `onOpenChange(false) → install.closeDialog()` so any close path runs
  the dismiss logic.
- **Copy leads with the offline benefit**, not "install like an app." e.g. title
  "Use Cuanto offline in the field" / description "Add it to your home screen and
  open it like an app — even without a connection." The offline-in-the-field
  value is the primary message (this feature's stated goal).
- ~~If `install.canInstall`: a single **Install** button →
  `install.promptInstall()`.~~ (removed) Always render
  `<InstallInstructions family={install.browserFamily}
  showBookmarkAlt={!install.isIOS} />`.
- Mounted once, globally, in `+layout.svelte` (next to `Toaster`).

### `src/lib/components/InstallInstructions.svelte`
- Prop `family`. Renders numbered, **pictorial** steps using existing
  `@lucide/svelte` icons as the in-line glyphs the user should look for.
- **Critical UX detail**: on both WebKit and Firefox, "Add to Home Screen" is
  *not* visible at the top level — it's hidden behind a scroll / "More" /
  "View More" expansion. This is the single biggest drop-off point, so each
  flow must make that intermediate step an **explicit, emphasized step**, not an
  aside.
  - **webkit (iOS Safari)**: tap **Share** (`Share` icon) → in the share sheet,
    **scroll down the actions list** (and if it's missing, tap **Edit
    Actions…**) to reveal **Add to Home Screen** (`SquarePlus`) → **Add**. Call
    out the scroll/"more actions" step explicitly.
  - **firefox (Android)**: tap the **⋮ menu** (`EllipsisVertical`) → it's not
    top-level — tap **More** / scroll to expand → **Add to Home Screen** /
    **Install**. Call out the **More** step explicitly.
  - **chromium (Android)**: tap the **⋮ menu** (`EllipsisVertical`) → **Install
    app** / **Add to Home screen** → confirm. Usually surfaced directly, so no
    extra expand step.
  - **other** (incl. non-Safari iOS browsers): generic — find the **Share**
    button, then look for **Add to Home Screen** (it may be under a **More** /
    **View More** menu). Also mention the browser menu as an alternate spot for
    "Install" / "Add to Home Screen".
- **Bookmark alternative — `showBookmarkAlt` prop (`!isIOS` only)**: where the
  service-worker cache + IndexedDB persist permanently (Android/desktop), append
  a smaller secondary line: "Or bookmark this page — it'll still work offline."
  **Never rendered on iOS** (Safari or `FxiOS`/`CriOS`), because iOS evicts that
  storage after ~7 days idle, making a bookmark an unreliable offline path there.
- Icon-based illustration matches the app's existing icon idiom. (Real
  screenshots are a possible later enhancement; noted, not in scope — YAGNI.)

### `src/lib/components/InstallFooter.svelte`
- The persistent entry point. Renders **only when `install.shouldOffer`**.
- Subtle, non-dismissible: a thin, centered, muted text-button
  ("Install Cuanto as an app") → `install.open(false)`.
- Uses theme colors from `layout.css` (e.g. `text-muted-foreground`,
  `border-border`); no custom colors.

## Modified files

### `src/routes/+layout.svelte`
- `onMount`: call `install.init()`.
- Render `<InstallFooter />` at the end of page content (after `{@render
  children()}`, before/above `<MobileNav />`) so it sits at the end of every
  screen.
- Render `<InstallPromptDialog />` globally (alongside `<Toaster />`).

### `src/lib/components/ProtocolDetail.svelte`
- In the **follow** form's `onEnhance` success branch (around lines 151–156,
  *not* unfollow), call `install.maybeAutoPrompt()`. Triggering from inside this
  component covers both `/protocols/...` and `/app/protocols/...` parents without
  threading a new prop through either page. Follow only renders when signed in,
  satisfying the signed-in requirement.

### `src/lib/hooks/is-mobile.svelte.ts`
- Optionally add an `IsTouch extends MediaQuery('(pointer: coarse)')` class for
  reuse, mirroring `IsMobile`. (Or inline `MediaQuery` in the singleton — pick
  one; reuse preferred.)

### `src/routes/manifest.webmanifest/+server.ts` (replaces `static/manifest.webmanifest`)
The manifest is served from a **route**, not a static file, so it can be
white-labeled and run from any domain. The `<link rel="manifest"
href="/manifest.webmanifest">` in `app.html` is unchanged; the route serves the
same path.
- `"id": "/app/"` (stable app identity) and `"start_url": "/app/"` stay
  **relative** — they resolve against the serving origin automatically.
- `"prefer_related_applications": false` and a self-referential
  `"related_applications": [{ "platform": "webapp", "url":
  "${origin}/manifest.webmanifest" }]` so `getInstalledRelatedApps()` can detect
  our own install on Android Chromium. This entry is the only field that *must*
  be an **absolute** URL, which is why a static file would have to hardcode the
  domain. `origin` comes from `PUBLIC_URL` (`$env/dynamic/public`, same pattern
  as `auth.ts`), falling back to the request origin if unset. So
  `getInstalledRelatedApps()` detection follows whatever domain serves the app.
- Served with `content-type: application/manifest+json`.
- **Note:** moving off `static/` means the manifest is no longer precaptured by
  the service worker's `files` precache. It's fetched from the network instead,
  which is fine (the browser only fetches the manifest at install/update time,
  not on every offline load).
- White-label TODO (out of scope here): `name`, `short_name`, `description`,
  `theme_color`, and icons are still hardcoded Cuanto branding; only the
  `related_applications` URL is domain-aware so far.

## Testing

### Unit (`pnpm test:unit`, vitest/node)
- `src/lib/pwa/detect.test.ts`: `detectBrowserFamily` across representative UA
  strings (iOS Safari, Chrome Android, Edge, Firefox Android, FxiOS, an
  unknown UA → other); `isStandalone` with mocked `matchMedia` / `navigator`.
- `src/lib/pwa/dismiss.test.ts`: set/get round-trip and graceful no-op when
  `localStorage` throws/absent.

### Integration (`pnpm test:integration`, Playwright)
Use `devices['iPhone 15']` (`test.use`) for touch context (pattern from
`tests/mobile-nav.spec.ts`); auth cookie + protocol seed from
`tests/fixtures.ts` / `tests/protocol-follows.spec.ts`.
- **Footer present on touch, absent on desktop**: assert the footer button shows
  under iPhone emulation and not under the default desktop project.
- **WebKit instructions**: open via footer on the webkit project → dialog shows
  Add-to-Home-Screen steps (there is never an Install button now).
- **Auto-prompt after follow + dismissal**: signed in, follow a seeded protocol
  → dialog auto-appears; close it → reload/refollow → dialog does **not**
  auto-appear (localStorage flag), but footer button still opens it.
- **Standalone suppression**: `page.addInitScript` stubbing
  `matchMedia('(display-mode: standalone)')` → matches → assert footer absent and
  no auto-prompt.
- ~~**One-click path**: synthetic `beforeinstallprompt` → **Install** button.~~
  *(removed with the one-click path; the dialog now always shows instructions.)*

### Manual
`pnpm dev`, open in Chrome DevTools device mode (touch), verify footer +
dialog with instructions; verify nothing renders in desktop mode or when
launched as an installed app. Chrome's own native install prompt (no longer
intercepted) can be exercised via DevTools "Application → Manifest".

## Out of scope (YAGNI)
- Real screenshot assets for instructions (icon glyphs used instead).
- Server-side / cross-device dismissal sync (local `localStorage` only).
- Desktop browsers' manual install flows (e.g. Safari's "Add to Dock") —
  desktop is excluded by the touch gate.
