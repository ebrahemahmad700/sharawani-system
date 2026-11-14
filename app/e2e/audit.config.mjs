// The whole-system audit: the crawl and the journeys in ./audit.
//
//   npx playwright test -c audit.config.mjs                  everything
//   npx playwright test -c audit.config.mjs crawl            only the crawl
//   node audit/summarise.mjs                                 the report
//
// The crawl only follows links. The journeys register letters, add users, change
// settings and put them back: local stack only, never a real server.

import base from './playwright.config.mjs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  testDir: './audit',
  outputDir: './audit-output/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-output/results.json' }]],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
