import { describe, expect, test } from 'vitest';
import { formatVersion } from './app-version.js';

describe('formatVersion', () => {
  test('pairs the package version with the commit it was built from', () => {
    expect(
      formatVersion({
        pkgVersion: '1.0.3',
        sha: '4ba0cee9ed42aed2f048c8c9874dc68336417af6',
        dirty: false,
        now: 1787100000000,
      }),
    ).toBe('1.0.3+4ba0cee');
  });

  // A dirty tree's code is not the commit's code, so naming the commit would
  // assert something false — precisely the kind of claim this whole mechanism
  // exists to stop.
  test('refuses to name a commit when the tree has uncommitted changes', () => {
    const version = formatVersion({
      pkgVersion: '1.0.3',
      sha: '4ba0cee9ed42aed2f048c8c9874dc68336417af6',
      dirty: true,
      now: 1787100000000,
    });
    expect(version).not.toContain('4ba0cee');
    expect(version).toBe('1.0.3+dev.1787100000000');
  });

  test('falls back to a timestamp when no commit is knowable', () => {
    expect(
      formatVersion({
        pkgVersion: '1.0.3',
        sha: null,
        dirty: false,
        now: 1787100000000,
      }),
    ).toBe('1.0.3+dev.1787100000000');
  });

  // service-worker.ts keys its shell cache on this value, so two builds of
  // different code sharing a version would strand users on a stale shell. The
  // fallback must therefore never be a constant.
  test('never repeats itself across unidentifiable builds', () => {
    const args = { pkgVersion: '1.0.3', sha: null, dirty: false };
    expect(formatVersion({ ...args, now: 1787100000000 })).not.toBe(
      formatVersion({ ...args, now: 1787100000001 }),
    );
  });
});
