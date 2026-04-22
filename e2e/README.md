# E2E — Playwright against the real backend

Layout intentionally mirrors Page Object Model + feature-test conventions:

```
e2e/
├── pages/                  # one file per UI surface; methods return nothing or scalar state
│   ├── windowChrome.ts     # title bar actions (readVersion, openTweaks)
│   ├── sessionList.ts      # left-pane actions (count, clickFirst, clickInViewerForRow)
│   └── updateBanner.ts     # self-update banner (seed, isVisible, clickDownload, clickRestartApply)
└── tests/
    └── feature/            # flows that combine page actions into user journeys
        ├── app-boots.spec.ts       # the one test that would have caught the black-screen bug
        └── update-flow.spec.ts     # hidden → available → staged → apply-guard
```

## Running locally

From this directory:

```bash
npm ci
npm run install-browsers    # first time only — downloads Chromium
npm test
```

`playwright.config.ts` spins up the backend via `python -m backend.cli --server-only --port 8769 --no-browser` with `CSV_TEST_MODE=1` so the `/api/_test/seed-update-state` hook is reachable.

## Running against the built .exe

CI uses this path to verify the actual shipped binary:

```bash
# terminal 1 — start the exe
CSV_TEST_MODE=1 ./claude-sessions-viewer.exe --server-only --port 8769 --no-browser

# terminal 2 — point the tests at it
CSV_APP_URL=http://127.0.0.1:8769 npm test
```

When `CSV_APP_URL` is set the config skips the `webServer` block so the exe stays the source of truth.

## Adding a page

Put the locators and actions in `pages/<name>.ts`. One class per surface. Actions should be named like user intents (`clickDownload`, `openTweaks`) rather than implementation details (`waitForSelectorAndClick`).

## Adding a feature test

Under `tests/feature/<verb-noun>.spec.ts`. Wire page objects together; never query the DOM directly from a feature test — that's what the page classes are for.
