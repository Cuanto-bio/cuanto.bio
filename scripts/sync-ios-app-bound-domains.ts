import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeServerOrigin } from '../src/lib/native/serverUrl';

// iOS App-Bound mode restricts the WKWebView to the domains in
// WKAppBoundDomains, so that list has to include the host the wrapper loads.
// Capacitor does not manage this key, and it lives in a native plist that
// cannot read .env at runtime, so keep it in sync with PUBLIC_URL here (the
// same value capacitor.config.ts loads).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = join(root, 'ios', 'App', 'App', 'Info.plist');

// The wrapper only navigates to PUBLIC_URL's host, but iOS lists localhost as an
// app-bound domain by default; keep it so nothing relying on it breaks.
const EXTRA_DOMAINS = ['localhost'];

if (!existsSync(plistPath)) {
  console.log(`iOS platform not found at ${plistPath}; skipping.`);
  process.exit(0);
}

const host = new URL(nativeServerOrigin(process.env.PUBLIC_URL)).hostname;
const plist = readFileSync(plistPath, 'utf8');

// Match the WKAppBoundDomains key and its <array>, capturing the surrounding
// indentation so the rest of the plist is left byte-for-byte untouched.
const re =
  /([ \t]*)<key>WKAppBoundDomains<\/key>[ \t]*\r?\n([ \t]*)<array>[\s\S]*?<\/array>/;
const match = plist.match(re);
if (!match) {
  console.error(
    'WKAppBoundDomains not found in Info.plist. Add the key once (Capacitor ' +
      'does not manage it), then this script will keep it in sync.',
  );
  process.exit(1);
}

const keyIndent = match[1];
const arrayIndent = match[2];
const childIndent = `${arrayIndent}\t`;
const domains = [host, ...EXTRA_DOMAINS];
const rebuilt = [
  `${keyIndent}<key>WKAppBoundDomains</key>`,
  `${arrayIndent}<array>`,
  ...domains.map((d) => `${childIndent}<string>${d}</string>`),
  `${arrayIndent}</array>`,
].join('\n');

const next = plist.replace(re, () => rebuilt);
if (next === plist) {
  console.log(`WKAppBoundDomains already set to: ${domains.join(', ')}`);
} else {
  writeFileSync(plistPath, next);
  console.log(`WKAppBoundDomains set to: ${domains.join(', ')}`);
}
