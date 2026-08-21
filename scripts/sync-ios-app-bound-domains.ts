import 'dotenv/config';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeServerOrigin } from '../src/lib/native/serverUrl';

// iOS App-Bound mode restricts the WKWebView to the domains in
// WKAppBoundDomains, so that list has to include the host the wrapper loads.
// Info.plist reads that value as $(WK_APP_BOUND_DOMAIN), substituted by Xcode
// at build time from ios/Env.xcconfig (included by ios/debug.xcconfig), so the
// tracked plist never carries a literal, environment-specific hostname and
// this script only ever writes to a gitignored file.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iosDir = join(root, 'ios');
const plistPath = join(iosDir, 'App', 'App', 'Info.plist');
const envConfigPath = join(iosDir, 'Env.xcconfig');

if (!existsSync(plistPath)) {
  console.log(`iOS platform not found at ${plistPath}; skipping.`);
  process.exit(0);
}

const host = new URL(nativeServerOrigin(process.env.PUBLIC_URL)).hostname;
writeFileSync(envConfigPath, `WK_APP_BOUND_DOMAIN = ${host}\n`);
console.log(`ios/Env.xcconfig: WK_APP_BOUND_DOMAIN = ${host}`);
