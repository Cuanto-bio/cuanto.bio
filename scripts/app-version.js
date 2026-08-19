import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build the identifier that answers "which build am I actually looking at?".
 *
 * The native wrapper loads the site live rather than bundling it, so the APK's
 * own version number says nothing about the web build running inside it. That
 * gap sent us debugging a freeze against a deploy that predated the diagnostics
 * work entirely. See https://tangled.org/cuanto.bio/cuanto.bio/issues/50.
 *
 * Feeds kit.version.name, which surfaces in two places: `version` from
 * $app/environment (what the log page shows) and the service worker's shell
 * cache key. The second use imposes a hard rule — two builds of different code
 * must never share a version, or the service worker keeps serving a stale
 * shell. Hence the timestamp fallback: unidentifiable is acceptable, constant
 * is not.
 */
export function formatVersion({ pkgVersion, sha, dirty, now }) {
  // A dirty tree's code is not the commit's code, so naming the commit would
  // be a false claim of exactly the kind this exists to prevent.
  if (!sha || dirty) return `${pkgVersion}+dev.${now}`;
  return `${pkgVersion}+${sha.slice(0, 7)}`;
}

// Returns null rather than throwing on every way this can fail: no git binary,
// not a repo, no commits yet. All of them are "we cannot identify this build",
// which formatVersion already handles.
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function appVersion(env = process.env, now = Date.now()) {
  const { version: pkgVersion } = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  );

  // Railway injects service variables into the Docker build for stages that
  // declare them with ARG; see the Dockerfile. The image has no .git (excluded
  // by .dockerignore) and no git binary, so this variable is the only way the
  // production build can know its own commit. When it is set we trust it and
  // skip the dirty check, which has no meaning without a working tree.
  const injected = env.APP_COMMIT_SHA;
  if (injected) {
    return formatVersion({ pkgVersion, sha: injected, dirty: false, now });
  }

  return formatVersion({
    pkgVersion,
    sha: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    now,
  });
}
