# Pepito+

React 18 + Vite PWA (GitHub Pages) and the same code wrapped by Capacitor 8 as an iOS app (bundle id com.buzz.pepito).
State is one persisted Zustand store, `src/store/useStore.js`; pure logic lives in `src/lib`, `src/health`, `src/body`, `src/sauna`, `src/sleep`.

## Commands
- `npm test` (vitest once, never watch) · `npm run typecheck` · `npm run lint` · `npm run e2e` (background dev server on :5174)
- `npm run build:web` (Pages, base /budget-app/, SW) · `npm run build:native` (`dist-native`) · `npm run cap:sync` (+ `cap sync ios`)
- Health demo: `VITE_DEMO_HEALTH=1 npx vite --port 5175` in the background, then `e2e/_health-demo.mjs` (`CHROMIUM_PATH=/opt/pw-browsers/chromium`).
## Rules
- Never commit `/dev-assets`, body photos, `test-fixtures/private/` or a DEVELOPMENT_TEAM. Never run a dev server in the foreground.
- Plain, calm wording. No medical advice, diagnosis or causal claims. No em dashes in UI copy (comma, colon or full stop).
- Never delete stored user data: a removed feature stops collecting and loses its UI, its rows stay in the store and the backup.
- Nothing with health values goes to the network or the console. No heat or temperature warnings anywhere (a test scans).
- Design: dark only, Inter, tabular numbers, spacing 4/8/12/16/20/24/32/40/56, radii 10/14/20/pill, colour only where it carries
  meaning, no coloured icon tiles. Easy to read: `components/ui/Glance.jsx` + `src/lib/glance.ts` (AnswerLine, StatRow, DeltaChip by
  `betterOf`, StatusDot, InfoButton, ProgressRow), three text levels; every chart passes `src/body/chartGlance.ts`.
- Tabs: Home, Body (Composition, Measurements, Effects, Recovery), Sleep (native only), Sauna, More (Calendar, Reactions, Bloods, Stock first).
  Home is exactly: readiness card (native), today's log, sauna row. Screens other than Home are lazy, each in an `ErrorBoundary`.
- Removed earlier, data kept: Symptoms "how I feel", daily check-in, Supplies (gear), Body › Training; Sleep sounds, Watch movement
  recording and Watch Start sleep (`nightExtras.sounds/restless`, `soundsLog`, `sleepModeLog` stay; `src/sleep/removed.test.js` guards).
## Health (native only)
- `HEALTH_BUILD` (`src/health/ui.js`) is false on the web. Reads Apple Health; the one write is water with a sauna rating (`writeWater`).
  `@capgo/capacitor-health` plus the Swift plugin `plugins/pepito-health`. Screens lazy in `src/components/health`.
- Data: `bridge.ts` → `dayLogic.ts` (nights, days, workouts) → `sync.ts` (full history once, then from last sync −3 days) → Dexie
  `pepito-health` (`cache.ts`, not in the backup). Bump `NIGHTS_SCHEMA` (now 5) to re-read the year. Engines `src/health/engine/*`,
  constants in `config.ts`, wired by `model.ts`; `compoundEffects.ts` feeds Body › Effects.
- Body values: always `getLatestMeasurement` / `dailySeries` (`src/body/bodySeries.ts`); "since" deltas via `getStartValue`
  (`startPoint.ts`). Source families (`sources.ts`): Scale, Evolt, DEXA, one line per source, never mixed. Scan fields `scanFields.ts`.
- Charts: `TrendChart.jsx`, maths `src/body/chartPoints.ts`, `BodyChart.jsx`, lanes `Lanes.jsx`; `--series-*` colours only; ranges
  fit the data (14 days min), under 3 points is a list; suspect scale weights are left out until kept (`readingReviews`).
  Imports (`src/body/import`, IO `src/lib/importFiles.js`): Evolt PDFs, Withings zip/CSV/Medical Report, scan JSON; only add.
## Sleep (Apple Health only)
- One source per night (`buildNights`, grouped by source name, never blended). `healthSettings.sleepSource` (null = any Apple Watch),
  picked in More › Health › Sleep source (`sourceRows`, `src/sleep/sources.ts`: only sources Health returned, nights in 30 days,
  stages). A night the chosen source missed uses the next source with sleep, `fallback: true`, labelled "Other source", and is left
  out of baselines (`model.ts`) and the Sleep Lab (`useSleepLab`). In bed alone is not a source.
- Restless measures (`src/sleep/restless.ts`): wake-ups and awake minutes, fragmentation (stage changes per hour), heart rate spikes
  (over 10 bpm above the night's median for 2 min+); `restlessLine`: "Woke 4 times, 21 min awake. 2 heart rate spikes."
- Night card (`NightCard.jsx`, `src/sleep/nightView.ts`, touch `nightGestures.ts`): stages, Heart rate, HRV dots, SpO2 dots (amber
  under 90), Breathing rate; no Move or Sound. `whatHappened`: wake-ups, spikes, surges, SpO2 dips. Overnight extras `overnight.ts`.
- Sleep Lab (`src/sleep/analysis`, Web Worker `src/lib/compute`): outcomes include wakeUps, wasoMin, fragmentation, hrSpikes;
  association never cause, n shown. Apnea (`apnea.ts`, "Screen, not a diagnosis"): breathing disturbances, SpO2, breathing rate,
  STOP-BANG (snoring from partner answers), bloods. Nightmares (`nightmares.ts`): HR surges, HRV drops, awake after REM.
- Logging `logging.ts`, prompts `prompts.ts`, setup `setup.ts`, late phone use from Screen Time (`native/sleepRuntime.js`).
## Sauna
- `saunaSessions`, `saunaSettings`, `saunaTimer` (backed up); `src/sauna` (`sauna.ts`, `saunaEffects.ts`, `analytics.ts` + `ANALYTICS`,
  `insights.ts`). Session on day D = night D, morning D+1; no statistic uses a day before the first session. Health via
  `saunaHealthContext.js`; Watch Cool down reads HR 5 min after Stop; rating `SaunaRatingSheet`; no HR → `hrAround`.
## Compounds and stock
- `isDue(compound, date, { pushes, pauses })` (`src/lib/due.js`) is the only answer to "owed on a date"; Home omits pauses.
  Rests are not missed; pushes never land in a rest; stock walks day by day (`runOutWalk.js`); restarts via `restartDose`, `rungOn`.
- One open vial per compound; what is left is never stored: `remainingMg` (`src/lib/vials.js`) = total less doses since
  `activatedAt` plus adjustments. `vials.js` is the authority (`vialChangeNeeded`, `changeVial`, `forecastRunOut`, `stockRows`).
  Order by = run-out minus `orderLeadDays` (14). UI `components/stock` (`VialPromptHost.jsx`, `StockRoom.jsx`).
## Photos and tape
- Photos (`PhotosSection.jsx`, `components/photos`): resized before storing (`src/lib/photoImage.js`, 2000 px, 0.85, 480 px thumb).
  Adjust stores `align` { scale, x, y, rotation } on the photo (`src/lib/photoAlign.ts`), never edits the image; compare and grid draw
  every photo in one 3:4 frame with it. Auto align: Vision body pose via `PepitoCamera` (`src/native/camera.js`), which also gives
  camera access and Settings. Camera and library usage texts are set in `native_targets.rb` (iOS closes the app without them).
- Tape: Body › Measurements (`components/measurements`), logic `src/body/tape.ts`; `logTape` writes only the sites changed and merges
  into a typed entry on the same day; `tapeSettings` (sites, better per site, reminder) is in the backup.
## Native
- `buildSnapshot` (`src/native`) is the only source for widgets, notifications, Siri and the Watch; queued actions apply once by id.
- Swift: `ios/PepitoKit` (PepitoCore, `swift test` in CI; PepitoWidgetUI; PepitoWatchUI), app `ios/App/App/Native`, targets
  `ios/PepitoWidgets`, `ios/PepitoWatch`, `ios/PepitoWatchWidgets`. Add targets and files only with `ruby ios/scripts/native_targets.rb`;
  flags in `ios/native-features.json`. `PepitoSnapshotTests` renders surfaces to `design-snapshots/` (CI commits them).
- Watch: Home is a menu; only a running sauna opens straight to its screen. Sleep tile and complication are read-only (last night's
  score or hours, tap for a summary from `sleep.lastNight`). Backups `autoBackup.js` (14 kept), PDFs `src/lib/pdf`, local error log.
## After every push
After the final push, always end the chat reply with a section titled How to update my phone. It contains: (a) the direct download
link for the pushed branch as a zip, in the form https://github.com/OWNER/REPO/archive/refs/heads/BRANCH.zip with the real owner,
repo and branch filled in; (b) the link to open a pull request for the branch (https://github.com/OWNER/REPO/compare/BRANCH?expand=1);
(c) numbered plain-English steps, matching how this project is actually built and installed on my iPhone, from downloading or
pulling the code through to the app running on my phone, including any merge step, build commands, npx cap sync ios, opening Xcode,
choosing my iPhone and pressing Run; (d) anything I must do once for this specific change (for example new permissions, settings to
check, or a Shortcut to delete). Write it for a smart beginner, no jargon without a plain explanation.
Owner/repo from `git remote get-url origin` (Buzz1503/budget-app); steps per the README: `npm install`, `npm run cap:sync`, then
`npm run cap:open` (opens `ios/App/App.xcodeproj` in Xcode), pick the iPhone, Run.
