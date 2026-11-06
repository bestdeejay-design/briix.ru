/* Optional developer-only browser checks. The static site never loads this file. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const BASE_URL = (process.env.BRIIX_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.env.BRIIX_TEST_OUT || require('node:os').tmpdir();
async function launch() {
  let args = ['--no-sandbox'];
  try {
    // Serverless Chromium builds sometimes add --single-process, which breaks
    // media playback in headless tests. Keep the rest of their sandbox flags.
    args = require('@sparticuz/chromium').args.filter(a => !['--single-process', '--in-process-gpu'].includes(a));
  } catch (_) { /* a normal Playwright Chromium install needs no extra flags */ }
  if (process.env.BRIIX_CHROMIUM_ARGS) args = JSON.parse(process.env.BRIIX_CHROMIUM_ARGS);
  return chromium.launch({ headless: true, executablePath: process.env.BRIIX_CHROMIUM || undefined, args });
}
module.exports = { launch, AxeBuilder, BASE_URL, OUT };
