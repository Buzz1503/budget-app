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
  More (Calendar, Reactions, Bloods, Stock first; order-by dot on More and Stock).
- Home is exactly: readiness card (native), today's log, sauna row (`homeSections`).
- Removed in 2D, data kept in store and backup: Symptoms "how I feel", the daily
  check-in, Supplies (gear), Body › Training. Never delete stored data when
  removing a feature. Needles: `src/lib/needle.js` remembers the last one.
- Design: dark only, Inter, tabular numbers, spacing 4/8/12/16/20/24/32/40/56,
  radii 10/14/20/pill, colour only where it carries meaning, no coloured icon tiles.

## Health (native only)

- Reads Apple Health; the one write is dietary water logged with a sauna rating (`writeWater`,
  once per session, `waterWritten`). `@capgo/capacitor-health` for most reads, plus
  the local Swift plugin `plugins/pepito-health` (lean mass, protein, HR recovery,
  daylight, daily sums, date of birth and sex, breathing disturbances, headphone audio, daytime HR).
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
- Scans: `src/data/evolt_scans.json` imported by v22 (`scanHistory.ts`). More › Import (`components/data/ImportFiles.jsx`,
  also "+" on Composition › All scans) reads any mix of files: Evolt PDFs, Withings export (zip or CSV), Withings
  Medical Report PDF, scan JSON. See "Imports" below.
- Charts: `TrendChart.jsx`, maths in `src/body/chartPoints.ts`; body metrics via `BodyChart.jsx`
  (one source, Scale | Evolt, saved in `chartSources`). Lanes (`Lanes.jsx`, `src/body/lanes.ts`)
  under every chart. Series colours only from `--series-*` tokens. Ranges fit the data
  (`fitToData`: axis starts at the first point, 14 days minimum); a series under 90 days
  opens on All; under 3 points is a list, not a chart; pins are off on sauna charts.
  Readable: y axis padded to the data (`AXIS_PAD`), a reference band only where it overlaps
  (`bandInView`, else `bandCaption`), value labels by priority last, first, lowest, highest, then
  the start label (`labelPriority`, `placeLabels`, collisions hide), no +1 badges, pins as dots
  under the dates (the line only while tapped), 190 plot height; tap or expand for full screen
  (`zoomWindow`, `panWindow`, 14 days minimum). Scale weights more than 3 kg from both neighbours
  within 14 days (`suspectWeights`) are left out of every line and number (`excludeWeight` in
  `useBodyInput`) until kept; `readingReviews` holds keep or hide, the reading is never deleted.
- Body › Composition opens with two Evolt boxes (`lastScanStory`, `sinceStartStory` in
  `composition.ts`): the latest scan against the one before, then since the start. These two use
  Evolt only; every other latest value still uses `getLatestMeasurement`. Scan to scan
  (`scanToScan`) replaces the weekly bars.
- Demo: `VITE_DEMO_HEALTH=1 npx vite --port 5175` (dev only), then `e2e/_health-demo.mjs`.
- Sauna: `saunaSessions`, `saunaSettings`, `saunaTimer` in the store (in the backup);
  pure logic in `src/sauna` (`sauna.ts`, `saunaEffects.ts` on the compare engine;
  session on day D = night D, morning D+1). `analytics.ts` holds the tab's maths: one
  session against the 28 nights / 28 days before, HR climb, 10 C bands, cool-down drop,
  fluid estimate (typed weights, else weigh-ins 2 h either side; daily `weighIns` need
  `NIGHTS_SCHEMA` 3), consistency, patterns, longer term, with every unlock threshold in
  `ANALYTICS`. No sauna statistic uses a day before the first session (`sinceFirstSession`).
  Screens in `src/components/sauna`; Health lookups come through `saunaHealthContext.js`,
  filled by the lazy native `SaunaHealthProvider`. Watch Cool down (`watchSettings.coolDown`,
  default on) keeps reading HR 5 min after Stop; saved as `session.coolDown`.
- Nothing with health values goes to the network or to the console.
- No heat or temperature warnings anywhere (web, Watch, notifications); a test scans for them.
- Sauna insights (`src/sauna/insights.ts`): since you started against the 4 weeks before
  (`beforeVsSince`, `compoundCaveat`), inside sauna days (`withinSauna`, split by rank at the median),
  heat adaptation as heart rate at minute 10 (`heatAdaptation10`), the grid from the first week
  (`gridWeeks`). Locked lines read "Needs X. You have Y."
- Sauna rating (`session.rating`, `electrolytes`, `waterMl`): optional step after saving on the phone
  (`SaunaRatingSheet`) and the Watch (`SaunaRatingModel`, `saunaRating` action matched by start). Sessions
  with no heart rate get `hrAround` (before, after, at 30 min) from `src/native/saunaHR.js`.

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

## Stock

- One open vial per compound; everything else on the shelf is sealed (`vials`, batches).
  What is left in the open vial is **never stored**: `remainingMg` in `src/lib/vials.js`
  is the total less every dose logged since `activatedAt` (and shared draws), plus hand
  adjustments. Deleting or editing a log moves it. Nothing in the store decrements a vial.
  Old readers that want `remainingMg` on the record use `withRemaining` / `useOpenVialsView`.
- `src/lib/vials.js` is the pure authority: `vialChangeNeeded` (the question after a log:
  remaining below the next scheduled dose, found with `nextDose`, which walks titration,
  cycles via `isDue`, pushes and pauses), `changeVial` (oldest batch first by `addedAt`,
  overfill and waste recorded), `expiryOf`, `forecastRunOut`, `stockRows` (sorted by order
  by date), `orderNotices`, `countRows`, `migrateVialModel`.
- Order by date = run-out date minus `peptide.orderLeadDays` (default 14). Fridge life is
  `recon.expiryDays` (0 means no clock), else the playbook, else 28. Use by shows from 3 days
  before. The dot on More and Stock: something to order within 7 days, or out of stock.
- Store: `vialPrompts` and `lastVialChange` are ephemeral (not persisted, re-derived and
  pruned by `_refreshVialPrompts`). `_recordDose` calls `_queueVialPrompt`; backfills do not.
  `answerVialPrompt` (yes, still, notyet), `startNewVial`, `undoVialChange` (10 s in the UI),
  `markVialMixed`, `finishVial` (manual, finish only), `adjustOpenVial`, `applyCountCheck`
  (`stockAdjustments`, reason "count check"), `checkVialExpiry`. Persist v25 runs
  `migrateStock`; `stockMigration` keeps what it did.
- UI: `components/stock/VialPromptHost.jsx` (the question, the recipe and Mixed, Undo) mounted
  in `App.jsx`; `StockRoom.jsx` (rows, vial sheet, Order arrived, count check). There is no
  "Vial done" on Home any more.
- Native: `src/native/stockNotices.js` builds the order, fridge-life and count notices (calendar
  triggers have the `pepito.sched.` prefix and go in the snapshot's `stock.notices` for the
  Watch; immediate ones use `pepito.stock.` and are added once, remembered in
  `nativeState.ordersSent`). Items carry `vialAsk` so the Watch can ask right after its tick.
  Answers are `vialChange` and `snoozeOrder` actions through the same queue.

## Sleep Lab

- Logging (`src/sleep/logging.ts`): as-needed items (never due, never missed), variable grams, evening
  factors (Caffeine, Cold plunge, Late meal hidden, records kept), morning check. Persist v26.
- Night features (`src/sleep/features.ts`) and rows (`analysis/dataset.ts`) feed the engine in
  `src/sleep/analysis` (bootstrap CIs seeded, ridge from 60 nights, dose-response, lag-1, best/worst,
  weekday/weekend; "Clear" only when the CI excludes zero). Wording: association, never cause; n shown.
- Heavy work runs in one Web Worker (`src/lib/compute`: `jobs.ts`, `useComputed`), cached by input hash in
  memory and IndexedDB `pepito-compute` (not in the backup). Sleep analysis and Body › Effects use it.
- Sleep sounds (iPhone): the session file in the App Group is written at start and rewritten every 5 minutes
  (`SleepSoundsCore.session`, `open`, `lastCheckpoint`, `gaps`); a file still open on the next launch is closed at its
  last checkpoint as "app closed" (`recover`, `SleepSoundsEngine.recoverOpenSessions`). Interruptions, route changes and
  engine stops are gaps, then listening resumes (one `Segment` per engine run, each with its own clock). The web layer
  only collects closed sessions. `src/sleep/sounds.ts` (night numbers, `capturedMin`, `eligible`) and `soundsView.ts`
  (status line, session log, density, trend). Zero is not missing: ran and heard nothing is 0, did not run is `null`
  and a gap in the trend. Snoring feeds the analysis, apnea screen and report only from nights with 4 hours of audio.
  Screen `components/health/SoundsScreen.jsx` (row on the Sleep tab, Morning check line, "Test for 1 minute"); no audio is ever saved.
  Starting: the Start button (Sleep tab and screen, `startSounds('app')`) is the reliable path, in the foreground; the Shortcuts
  automation is the second. Every attempt is logged on the phone (`startWithResult`, `SleepSoundsCore.classifyStart`:
  started, blockedLocked, blockedBackground, noPermission, audioError, with the iOS error text), mirrored into the store
  (`soundsLog`) and listed under Sessions. A failed automatic start, an unexpected stop (`isUnexpected`) and a pause of 5
  minutes each send a notification at that moment with when and why; `SleepSoundsNotices.scheduleChecks` plans a bedtime
  check ("not listening yet") for 7 nights, cleared once listening starts. A tap sets `pendingStart`, the web layer starts
  in the foreground (`startIfAsked`). The Stop shortcut never answers a bare "was not running" (`notRunningWords`).
- Night card (`components/health/NightCard.jsx`, maths in `src/sleep/nightView.ts`, touch in `src/sleep/nightGestures.ts`):
  stages as coloured blocks, one row each (Awake, REM, Core, Deep; `--stage-*` tokens, totals under the names), then
  Move, Sound, HR, SpO2 lanes on one clock. Touch: `touch-action: pan-y`, the first 9 px decide page or chart
  (`lockDirection`); sideways drag is the crosshair, or pans when zoomed (hold 200 ms first for the crosshair); pinch
  zooms the time axis on the card (30 minutes to the night, `pinchZoom`); double tap resets; a tap never opens full
  screen (only the expand icon). Overview strip while zoomed; fixed-height panel above the chart while dragging
  (`crosshairCells`); ticks by width (`tickStepMin`, `tickPlace` keeps the last label in). What happened (`whatHappened`).
- Sleep sounds schedule (`sleepSettings.schedule`, default on, 21:00 to 05:00): the phone stops at the
  scheduled time itself (`SleepSoundsCore.until`, stop reason "scheduled"); on iOS 18+ the
  "Start sleep sounds on schedule" intent is an `AudioRecordingIntent` with the Sleep sounds Live
  Activity (`SleepSoundsActivityAttributes`, Stop via `StopSleepSoundsLiveIntent` and `SleepSoundsHooks`);
  a failed start and a missed start get a time-sensitive "Tap to start Sleep sounds". Check my setup is
  `checkSetup` over the start log.
- Apnea (`src/sleep/apnea.ts`, "Screen, not a diagnosis"), nightmares (`nightmares.ts`, estimate,
  calibrated from 10 confirmed nights), overnight extras (`src/health/overnight.ts`, NIGHTS_SCHEMA 4).
- Native: Watch restlessness (CMSensorRecorder records only the window asked for, so `RestlessStart.request` asks for a
  fresh 12 h on every app run, snapshot, Sleep sounds start, 9 pm schedule and Start sleep, `RestlessRecording.Trigger`;
  `RestlessRecorder` reads every unsent night of the last 3 days in 12 h pieces; the phone matches a summary to its
  night by overlap, `restlessForNight`, and the Move lane waits for the Watch on the latest night, `moveLane`), iPhone Sleep sounds (SoundAnalysis, `SleepSounds.swift`, Start and
  Stop sleep sounds App Intents for a Shortcuts automation), Screen Time late use (`PepitoLateUse`).
- Prompts (`src/sleep/prompts.ts`): evening factors 30 min before planned bedtime, morning check 30 min after
  wake, skipped once answered, following Remind me on; the Watch plans the same ids from `sleep.prompts`.
  Rested then dreams are one tap each (`followUp`). "Took Dex" is the `_TOOK` dose category.
- Sleep setup checklist (`src/sleep/setup.ts`, `SleepSetup.jsx`) ticks from data; the Watch reports its
  complication and battery (`watchStatus`) and nudges under 30% at the evening prompt.

## Data, reports, errors

- More › Data › Backups and reports (`components/data/DataReports.jsx`): daily backup on the iPhone to
  Documents/Backups (`src/lib/autoBackup.js`, `native/backupRuntime.js`, plugin `PepitoFiles`), 14 kept, Back up
  now, Restore. Doctor PDFs are made on the device (`src/lib/pdf`: `pdfDoc.js` writer, `reports.js`).
- Errors and failed syncs go to the local error log (`src/lib/errorLog.js`, localStorage, never network or
  console); every screen sits in an `ErrorBoundary`. Cold start is recorded on Home (`src/lib/coldStart.js`).
- Screens other than Home are lazy (`App.jsx`); long lists use `components/ui/LongList.jsx`.
- No em dashes in UI copy: write a comma, colon or full stop.

## Easy to read (elite pass)

- Shared pieces in `components/ui/Glance.jsx`, logic in `src/lib/glance.ts`: every card leads with one `AnswerLine`,
  changes are `StatRow`s with a `DeltaChip` coloured by `betterOf(metric)` (accent better, amber worse, grey none or
  no better side, weight has none), engine labels become `StatusDot` (Clear, Possible, Normal, Early), caveats sit
  behind `InfoButton`, locked items collapse into one `ProgressRow`. Three text levels only.
- Every chart passes `src/body/chartGlance.ts`: a question title (`CHART_QUESTION`), one answer line, y axis unit in
  words (`axisUnit`), better hint, a legend whenever there is more than one kind of mark. Full screen views render
  through a portal to `document.body` (a transformed ancestor traps `position: fixed`).
- Design review harness (dev only): `node scripts/design-review.mjs [screens] [--out dir]` seeds data via
  `?preview=<screen>` (`src/dev/preview.js`), shoots 390 x 844 and flags em dashes. Final shots in `design-review/final/`
  (committed); everything else under `design-review/` is ignored.

## Watch sleep mode

- PepitoCore `SleepMode.swift` (phase, complication state, recording window, the `sleepMode` message), views in
  `PepitoWatchUI/SleepModeViews.swift`. Start sleep: lights-out saved in App Group defaults, movement recording made
  to cover 10 h, `sendMessage` (else `transferUserInfo`) asks the iPhone to start Sleep sounds by "watch"; a start iOS
  blocks from the background falls back to the time-sensitive "Tap to start Sleep sounds". "I'm up" stops them
  (`watchUp`). The web layer keeps times in `sleepModeLog` (`src/sleep/sleepMode.ts`); the snapshot carries
  `sleep.lastNight` for the morning screen.

## Imports

- Pure code in `src/body/import`: `pdfLines.ts` (items grouped by y, sorted by x, positions kept), `evoltPdf.ts`
  (page 1 and YOUR NUTRITION, values by label and position, `checkEvolt`: lean + fat vs weight 0.3, ICF + ECF vs TBW
  0.3, body fat % 0.5, regions' fat vs fat mass 1.0, regions' lean between 0.75 x and LBM + 1.0, since head and neck
  are in no region), `withings.ts` (CSV columns by header name, zip via DecompressionStream, Medical Report summary),
  `plan.ts` (rows, statuses New / Already imported / Needs a check / Not recognised, duplicates: same device + date +
  time, or same date and weight within 0.1 kg in the same family, Health weigh-ins included). IO in `src/lib/importFiles.js`.
- Imports only add (`importBody`; an id clash gets a suffix); nothing is merged or replaced. Withings rows are Scale,
  source `withings`; muscle, bone and hydration live on `withingsMuscleMass`, `withingsBoneMass`, `withingsHydration`.
  Reports go in `withingsReports` (in the backup), shown under All metrics › Withings reports, never charted.
- Real PDFs only in `test-fixtures/private/` (gitignored); `pdfReal.test.js` skips without them. Synthetic fixtures in
  `fixtures.ts`. `snapshotWatched` (`native/runtime.js`) includes body data so an import refreshes the snapshot.
