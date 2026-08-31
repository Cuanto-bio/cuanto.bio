import { redirect } from '@sveltejs/kit';
import { signInHref } from '$lib/auth/signin';
import { isNative } from '$lib/platform';
import type { PageLoad } from './$types';

/**
 * Forwards a native visitor to the native sign-in route.
 *
 * Server-rendered routes bounce unauthenticated visitors here (see
 * webSignInHref in $lib/auth/signin), and they cannot tell a native visitor
 * from a web one: isNative() reads the Capacitor bridge, which exists only in
 * the app's webview. This load does run there, so it is where the two flows
 * part company.
 *
 * The web form is worse than useless in the app: submitting it redirects to the
 * user's PDS, which App-Bound Domains will not load in the webview, so iOS
 * hands the whole flow to the system browser. The user signs in successfully on
 * the website and the app is still signed out, with nothing to bring them back.
 *
 * Note this does not fire during the native sign-in itself. That deliberately
 * opens /auth/signin?client=native in the *system browser*, where isNative() is
 * false and the web form is exactly what is wanted.
 */
export const load: PageLoad = ({ url }) => {
  if (!isNative()) return;
  redirect(302, signInHref(url.searchParams.get('returnTo')));
};
