import type { Page } from '@playwright/test';

/**
 * Snapshot of the app's observable state at a moment in time. Used as the
 * "before" and "after" points of an action so a test can prove the effect
 * of that action by diff — never by "it said it worked".
 *
 * Collected in one round-trip on the page for perf: one evaluate call
 * reads URL, DOM counts, localStorage keys, and a timestamp.
 */
export type PageState = {
  url: string;
  title: string;
  timestamp: number;
  /** Count of children directly under #root. Zero = React did not mount. */
  rootChildren: number;
  /** Count of elements that have a data-testid attribute. Useful as a
   *  proxy for "UI rendered". */
  testidCount: number;
  /** Map from testid pattern prefix → count. Lets assertions pick a
   *  specific surface (e.g. `session-row-` rows) without counting unrelated
   *  stuff. Only tracks our known testid prefixes. */
  testidGroups: Record<string, number>;
  /** localStorage keys we rely on (excludes arbitrary entries). */
  localStorage: Record<string, string | null>;
  /** Selected body text, first N characters — cheap content-presence check. */
  bodyTextHead: string;
};

const WATCHED_TESTID_PREFIXES = [
  'session-row-',
  'title-input-',
  'title-',
  'rescan-btn',
  'tile-pane-',
  'tile-divider-',
  'update-banner',
  'right-tab-',
  'right-tab-new-terminal',
  'split-h-btn',
  'split-v-btn',
  'close-pane-btn',
  'session-search-input',
  'tweaks-button',
  'transcript-pane',
  'rowbtn-',
] as const;

const WATCHED_LS_KEYS = ['cm_tweaks'] as const;

/** Capture PageState in one evaluate. Any call-site can use this to diff
 *  before vs after an action. */
export async function capturePageState(page: Page): Promise<PageState> {
  return await page.evaluate(
    ({ prefixes, lsKeys }) => {
      const groups: Record<string, number> = {};
      const all = document.querySelectorAll('[data-testid]');
      let total = 0;
      all.forEach((el) => {
        total += 1;
        const tid = el.getAttribute('data-testid') || '';
        for (const p of prefixes) {
          if (tid === p || tid.startsWith(p)) {
            groups[p] = (groups[p] || 0) + 1;
          }
        }
      });
      const ls: Record<string, string | null> = {};
      for (const k of lsKeys) ls[k] = localStorage.getItem(k);
      return {
        url: location.href,
        title: document.title,
        timestamp: Date.now(),
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        testidCount: total,
        testidGroups: groups,
        localStorage: ls,
        bodyTextHead: (document.body.innerText || '').slice(0, 300),
      };
    },
    { prefixes: [...WATCHED_TESTID_PREFIXES], lsKeys: [...WATCHED_LS_KEYS] },
  );
}

/** Diff two states — useful as a one-liner assertion aid in test logs. */
export function diffState(before: PageState, after: PageState): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  if (before.url !== after.url) diff.url = { from: before.url, to: after.url };
  if (before.rootChildren !== after.rootChildren) {
    diff.rootChildren = { from: before.rootChildren, to: after.rootChildren };
  }
  if (before.testidCount !== after.testidCount) {
    diff.testidCount = { from: before.testidCount, to: after.testidCount };
  }
  const groupKeys = new Set([...Object.keys(before.testidGroups), ...Object.keys(after.testidGroups)]);
  const groupDiff: Record<string, unknown> = {};
  for (const k of groupKeys) {
    const a = before.testidGroups[k] ?? 0;
    const b = after.testidGroups[k] ?? 0;
    if (a !== b) groupDiff[k] = { from: a, to: b };
  }
  if (Object.keys(groupDiff).length) diff.testidGroups = groupDiff;
  return diff;
}
