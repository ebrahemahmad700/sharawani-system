// Browser tests: a real Chrome, clicking through the real screens.
//
//   cd app/e2e
//   npm install                     once
//   npx playwright test             against http://localhost:3111
//   BASE=https://... npx playwright test --headed     watch it happen
//
// The HTTP tests in ../test/ can say what the server sent. They cannot say whether
// a mouse wheel moves the page, whether a PDF actually draws, or what happens to
// the first tab when a second person signs in in the second. Those were three of
// the ten things reported from the demo, and this is where they are held.
//
// The installed Google Chrome is used (channel: 'chrome'), so nothing has to be
// downloaded on an office machine. PW_CHANNEL=msedge uses Edge instead, and
// PW_CHANNEL=chromium uses Playwright's own copy after `npx playwright install`.
//
// These tests write letters into whatever database the server uses. Point BASE at
// the local stack or the demo, never at the municipality's real server.

import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL || 'chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One at a time. The tests share fixture accounts, and two of them sign the
  // same person in and out on purpose.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE || 'http://localhost:3111',
    ...(channel === 'chromium' ? {} : { channel }),
    locale: 'ckb',
    screenshot: 'only-on-failure',
    // A trace is a recording of every step, screenshot and request, opened with
    // `npx playwright show-trace`. Video is left off: it needs a separate download
    // that an office machine may not be allowed to make.
    trace: 'retain-on-failure',
  },
});
