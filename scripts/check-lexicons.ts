import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `src/lib/lexicons/**` is generated from `lexicons/**` by `pnpm lex:gen`, and
// nothing else regenerates it. This check regenerates into a throwaway
// directory and diffs it against the committed output, so a lexicon edit can't
// land without its generated TS. Generating out-of-tree keeps the check
// non-mutating (safe to run from `pnpm check` and pre-commit) and stops
// `lex build --clear` from wiping the real directory when a lexicon fails to
// parse. See https://tangled.org/cuanto.bio/cuanto.bio/issues/66.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lexBin = join(root, 'node_modules', '.bin', 'lex');
const committed = join(root, 'src', 'lib', 'lexicons');
const fresh = mkdtempSync(join(tmpdir(), 'lex-check-'));

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .sort();
}

function drift(): string[] {
  // Mirror the `lex:gen` script's flags exactly, only changing --out.
  execFileSync(
    lexBin,
    [
      'build',
      '--out',
      fresh,
      '--lexicons',
      './lexicons',
      '--indexFile',
      '--clear',
    ],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );

  const freshFiles = new Set(listFiles(fresh));
  const committedFiles = new Set(listFiles(committed));

  return [
    ...[...freshFiles]
      .filter((f) => !committedFiles.has(f))
      .map((f) => `  + ${f} (missing)`),
    ...[...committedFiles]
      .filter((f) => !freshFiles.has(f))
      .map((f) => `  - ${f} (stale, no longer generated)`),
    ...[...freshFiles]
      .filter(
        (f) =>
          committedFiles.has(f) &&
          !readFileSync(join(fresh, f)).equals(
            readFileSync(join(committed, f)),
          ),
      )
      .map((f) => `  ~ ${f} (out of date)`),
  ];
}

let changes: string[];
try {
  changes = drift();
} finally {
  // process.exit() below would skip a finally, so clean up first.
  rmSync(fresh, { recursive: true, force: true });
}

if (changes.length > 0) {
  console.error(
    `src/lib/lexicons does not match lexicons/:\n${changes.join('\n')}\n\n` +
      'Run `pnpm lex:gen` and commit the result.',
  );
  process.exit(1);
}

console.log('src/lib/lexicons is up to date with lexicons/');
