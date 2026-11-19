import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const traceDirectory = process.env.WUHOU_BROWSER_TRACE_DIR;
const traced = new WeakSet();
let sequence = 0;

export async function openTestContext(browser, options) {
  const context = await browser.newContext(options);
  if (traceDirectory) {
    await context.tracing.start({ screenshots: true, snapshots: true });
    traced.add(context);
  }
  return context;
}

export async function openTestPage(browser) {
  return (await openTestContext(browser)).newPage();
}

export async function closeTestContext(context) {
  try {
    if (traced.delete(context)) {
      await mkdir(traceDirectory, { recursive: true });
      await context.tracing.stop({ path: join(traceDirectory, `browser-${process.pid}-${++sequence}.zip`) });
    }
  } finally {
    await context.close();
  }
}

export async function closeTestBrowser(browser) {
  if (!browser) return;
  try {
    if (traceDirectory) await Promise.all(browser.contexts().map(closeTestContext));
  } finally {
    await browser.close();
  }
}

export function testBrowserChannel() {
  const channel = process.env.DRAFT_BROWSER_CHANNEL;
  return channel === 'headless-shell' ? undefined : channel || 'chrome';
}
