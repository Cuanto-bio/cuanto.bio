import { env } from '$env/dynamic/public';

/**
 * Adds the Umami analytics tracker to the page when both
 * PUBLIC_UMAMI_SCRIPT_URL and PUBLIC_UMAMI_WEBSITE_ID are set, so analytics are
 * on only where the deployment is configured for them (production) and off in
 * dev and tests.
 *
 * This runs client-side rather than rendering a tag in app.html or
 * <svelte:head>: /app is prerendered at build time, and reading
 * $env/dynamic/public while prerendering is an error, so a server-rendered tag
 * couldn't follow a runtime env var on the page the native wrapper launches.
 *
 * The tracker records client-side navigations itself by hooking
 * history.pushState, so this only needs to run once per page load.
 */
export function loadAnalytics() {
  const src = env.PUBLIC_UMAMI_SCRIPT_URL;
  const websiteId = env.PUBLIC_UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = src;
  script.dataset.websiteId = websiteId;
  // Query strings can hold things that don't belong in analytics, like the
  // native sign-in challenge and returnTo on /auth/signin.
  script.dataset.excludeSearch = 'true';
  script.dataset.doNotTrack = 'true';
  document.head.appendChild(script);
}
