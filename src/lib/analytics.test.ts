// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted((): Record<string, string | undefined> => ({}));

vi.mock('$env/dynamic/public', () => ({ env }));

import { loadAnalytics } from './analytics';

const SCRIPT_URL = 'https://analytics.example.com/script.js';
const WEBSITE_ID = 'e2783331-7949-4f0e-80dc-38a6e554369f';

function trackerScripts() {
  return document.head.querySelectorAll<HTMLScriptElement>(
    `script[src="${SCRIPT_URL}"]`,
  );
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete env.PUBLIC_UMAMI_SCRIPT_URL;
  delete env.PUBLIC_UMAMI_WEBSITE_ID;
});

describe('loadAnalytics', () => {
  test('adds the Umami tracker for the configured website', () => {
    env.PUBLIC_UMAMI_SCRIPT_URL = SCRIPT_URL;
    env.PUBLIC_UMAMI_WEBSITE_ID = WEBSITE_ID;
    loadAnalytics();
    const scripts = trackerScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].defer).toBe(true);
    expect(scripts[0].dataset.websiteId).toBe(WEBSITE_ID);
  });

  test('keeps query strings out of tracked URLs', () => {
    // Sign-in URLs carry returnTo and the native sign-in challenge.
    env.PUBLIC_UMAMI_SCRIPT_URL = SCRIPT_URL;
    env.PUBLIC_UMAMI_WEBSITE_ID = WEBSITE_ID;
    loadAnalytics();
    expect(trackerScripts()[0].dataset.excludeSearch).toBe('true');
  });

  test('honors Do Not Track', () => {
    env.PUBLIC_UMAMI_SCRIPT_URL = SCRIPT_URL;
    env.PUBLIC_UMAMI_WEBSITE_ID = WEBSITE_ID;
    loadAnalytics();
    expect(trackerScripts()[0].dataset.doNotTrack).toBe('true');
  });

  test('adds nothing without a website ID', () => {
    env.PUBLIC_UMAMI_SCRIPT_URL = SCRIPT_URL;
    loadAnalytics();
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  test('adds nothing without a script URL', () => {
    env.PUBLIC_UMAMI_WEBSITE_ID = WEBSITE_ID;
    loadAnalytics();
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });
});
