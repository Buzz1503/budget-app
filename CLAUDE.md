# Pepito+

React 18 + Vite PWA (GitHub Pages) and the same code wrapped by Capacitor 8 as
an iOS app (bundle id com.buzz.pepito). State is one persisted Zustand store,
`src/store/useStore.js`; pure logic lives in `src/lib` and `src/health`.

## Commands

- `npm test` — vitest, run once (never watch mode)
- `npm run typecheck`, `npm run lint` — TypeScript and ESLint, Health, body, sauna and chart code
- `npm run build:web` — Pages build (`base /budget-app/`, service worker)
- `npm run build:native` — iOS build into `dist-native` (`base /`, no service worker)
- `npm run cap:sync` — native build, then `cap sync ios`
- `npm run e2e` — Playwright suites against a dev server on :5174, started in the background

## Rules

- Never commit `/dev-assets` or any body photo.
- Never run a dev server in the foreground.
- Plain, calm wording. No medical advice, no diagnosis, no causal claims, no em dashes in UI copy.
- Tabs: Home, Body (Composition, Effects, Recovery), Sleep (native only), Sauna,
  More (Calendar, Reactions, Bloods, Stock first; low-stock dot on More and Stock).
- Home is exactly: readiness card (native), today's log, sauna row (`homeSections`).
- Removed in 2D, data kept in store and backup: Symptoms "how I feel", the daily
  check-in, Supplies (gear), Body › Training. Never delete stored data when
  removing a feature. Needles: `src/lib/needle.js` remembers the last one.
- Design: dark only, Inter, tabular numbers, spacing 4/8/12/16/20/24/32/40/56,
  radii 10/14/20/pill, colour only where it carries meaning, no coloured icon tiles.

## Health (native only)

- Reads Apple Health, never writes. `@capgo/capacitor-health` for most reads, plus
  the local Swift plugin `plugins/pepito-health` (lean mass, protein, HR recovery,
  daylight, daily sums, date of birth and sex).
- `HEALTH_BUILD` (`src/health/ui.js`) is false in the web build, so no Health code
  ships to Pages. All screens are lazy and live in `src/components/health`.
- Data: `bridge.ts` (plugin → raw types) → `dayLogic.ts` (nights, days, workouts)
  → `sync.ts` (full history in 30-day windows, found by a body-reading probe, once;
  then from last sync −3 days)
  → Dexie cache `pepito-health` (`cache.ts`). The cache is not in the backup;
  settings, check-ins and habits are (in the Zustand store). Nights carry stage
  `segments` and `sleepingHR`; bump `NIGHTS_SCHEMA` (`sync.ts`) to re-read the year.
- Engines: `src/health/engine/*`, pure, constants in `config.ts`; `model.ts` wires them. `compoundEffects.ts` feeds
  Body › Effects (per compound: since starting, overlaps within 14 days, clean
  windows); `sleepView.ts` feeds the Sleep tab (`SleepTab.jsx`, `SleepCharts.jsx`).
- Body values: always `getLatestMeasurement` / `dailySeries` (`src/body/bodySeries.ts`,
  hooks in `src/lib/useBody.js`). Newest day wins; scan > Withings > manual > other
  only within a day. Never read `measurements` directly for a current value.
- "Since" deltas: always `getStartValue` (`src/body/startPoint.ts`) against the
  starting point (`bodyStart`, default: first tracked compound start). Same field
  only; entries with `hiddenFromCharts` are in no series.
- Source families (`src/body/sources.ts`): Scale (Withings, typed-in, other apps; the
  v23 migration stamps `family` + `originalSource`), Evolt (all Evolt scans and the
  estimated start), DEXA (any other scan; own page `body/DexaPage.jsx`, compared only
  with DEXA, in no series or chart). One line per source, never mixed
  (`seriesByFamily`, `familySeries`). Weight, body fat, fat/lean/muscle mass are not
  typed in; tape still is. Start entry: 1 Jan 2025, Evolt, estimated. Scan fields live in `src/body/scanFields.ts`; skeletal muscle is
  never muscle mass, visceral level never visceral fat.
- Scans: `src/data/evolt_scans.json` imported by v22 (`scanHistory.ts`); More › Import
  scans uses `scanImport.ts` (dedupe on date + time + device).
- Charts: `TrendChart.jsx`, maths in `src/body/chartPoints.ts`; body metrics via `BodyChart.jsx`
  (one source, Scale | Evolt, saved in `chartSources`). Lanes (`Lanes.jsx`, `src/body/lanes.ts`)
  under every chart. Series colours only from `--series-*` tokens.
- Demo: `VITE_DEMO_HEALTH=1 npx vite --port 5175` (dev only), then `e2e/_health-demo.mjs`.
- Sauna: `saunaSessions`, `saunaSettings`, `saunaTimer` in the store (in the backup);
  pure logic in `src/sauna` (`sauna.ts`, `saunaEffects.ts` on the compare engine;
  session on day D = night D, morning D+1). Screens in `src/components/sauna`; the
  Health parts (Watch detection, HR, effects) are lazy in `src/health/ui.js`.
- Nothing with health values goes to the network or to the console.

## Native surfaces (3B)

- `src/native`: `buildSnapshot` (doses, units, groups, sauna, readiness) is the only
  source for widgets, notifications, Siri and the Watch; `applyPendingActions` +
  `useStore.applyNativeActions` apply queued actions once by id. Native never logs.
- Swift: `ios/PepitoKit` (PepitoCore model and logic, `swift test` runs on Linux;
  PepitoTheme tokens), app code `ios/App/App/Native`, shared `ios/Shared`, targets
  `ios/PepitoWidgets`, `ios/PepitoWatch`, `ios/PepitoWatchWidgets`. Add targets and files
  only with `ruby ios/scripts/native_targets.rb`; flags in `ios/native-features.json`.

## Native design (3C)

- Widget and Live Activity views live in `ios/PepitoKit/Sources/PepitoWidgetUI`, Watch
  screens and complications in `PepitoWatchUI`; targets only wrap them (intents via
  `WidgetActions`, mode via `SurfaceMode`). Watch Home is a menu (`WatchRoute`); only a
  running sauna opens straight to its screen. One hero, max three text sizes, lime only
  for done/progress/primary action, no mid-word truncation (use short variants).
- `PepitoSnapshotTests` renders every surface to `design-snapshots/` (CI job `snapshots`
  commits them back). Accented/vibrant are emulated; timer ProgressViews are drawn still.
- Dose reminders: More › Notifications › Remind me on (Watch default, iPhone, Both).
  Watch plans them from the snapshot (`WatchReminders.swift`, same ids); parity fixture
  `Fixtures/reminders.json` from `fixture.test.js`. Snapshot carries 7 days.

## Compound cycling

- Whether a compound is owed on a date is decided in one place: `isDue(compound, date,
  { pushes, pauses })` in `src/lib/due.js` (set up, on cycle, weekday, push, pause). Home,
  the calendar, the snapshot, reminders and nudges, adherence and restock all ask it;
  `daily.isDueToday` is only its building block. Home does not pass pauses (it keeps
  the Paused banner), everyone else does.
- A rest is not stopped and not missed. A push never lands in a rest (`pushDestination`).
  Stock is walked day by day (`runOutWalk.js`), so rests and pauses draw nothing and
  the forecast, run-out dot and alerts agree. Tenure and time at a dose count on-cycle
  days only (`onDaysBetween`); the calendar span stays `elapsedDays`.
- Restart dose: `restartDose` on the compound, 'resume' or 'floor' (`restartMode`;
  playbook if it states one, else resume). `rungOn` gives the dose for any date, so
  widgets and the Watch show a restart's dose unopened; `applyCycleRestarts` persists it.
- Effects: `cycleEvents` adds cycle off and on as stop and restart points in
  `useCompounds`. Snapshot `cycles.restarts` feeds the evening-before notice on the Watch.

