# Pepito+

React 18 + Vite PWA (GitHub Pages) and the same code wrapped by Capacitor 8 as
an iOS app (bundle id com.buzz.pepito). State is one persisted Zustand store,
`src/store/useStore.js`; pure logic lives in `src/lib` and `src/health`.

## Commands

- `npm test` — vitest, run once (never watch mode)
- `npm run typecheck`, `npm run lint` — TypeScript and ESLint, Health, body and chart code
- `npm run build:web` — Pages build (`base /budget-app/`, service worker)
- `npm run build:native` — iOS build into `dist-native` (`base /`, no service worker)
- `npm run cap:sync` — native build, then `cap sync ios`
- `npm run e2e` — Playwright suites against a dev server on :5174, started in the background

## Rules

- Never commit `/dev-assets` or any body photo.
- Never run a dev server in the foreground.
- Plain, calm wording. No medical advice, no diagnosis, no causal claims, no em dashes in UI copy.
- Tabs: Home, Body (Composition, Effects, Recovery, Training), Sleep (native
  only), Calendar, More (Symptoms and Bloods are its first two rows).
- Design: dark only, Inter, tabular numbers, spacing 4/8/12/16/20/24/32/40/56,
  radii 10/14/20/pill, colour only where it carries meaning, no coloured icon tiles.

## Health (native only)

- Reads Apple Health, never writes. `@capgo/capacitor-health` for most reads, plus
  the local Swift plugin `plugins/pepito-health` (lean mass, protein, HR recovery,
  daylight, daily sums, date of birth and sex).
- `HEALTH_BUILD` (`src/health/ui.js`) is false in the web build, so no Health code
  ships to Pages. All screens are lazy and live in `src/components/health`.
- Data: `bridge.ts` (plugin → raw types) → `dayLogic.ts` (nights, days, workouts)
  → `sync.ts` (365-day backfill in 30-day windows, then from last sync −3 days)
  → Dexie cache `pepito-health` (`cache.ts`). The cache is not in the backup;
  settings, check-ins and habits are (in the Zustand store). Nights carry stage
  `segments` and `sleepingHR`; bump `NIGHTS_SCHEMA` (`sync.ts`) to re-read the year.
- Engines: `src/health/engine/*`, pure functions, every constant in `config.ts`.
  `model.ts` wires them together for the screens. `compoundEffects.ts` feeds
  Body › Effects (per compound: since starting, overlaps within 14 days, clean
  windows); `sleepView.ts` feeds the Sleep tab (`SleepTab.jsx`, `SleepCharts.jsx`).
- Body values: always `getLatestMeasurement` / `dailySeries` (`src/body/bodySeries.ts`,
  hooks in `src/lib/useBody.js`). Newest day wins; scan > manual > Withings > other
  only within a day. Never read `measurements` directly for a current value.
- "Since" deltas: always `getStartValue` (`src/body/startPoint.ts`) against the
  starting point (`bodyStart`, default: first tracked compound start). Same field
  only; entries with `hiddenFromCharts` are in no series.
- Device families: body fat %, fat mass and lean mass are one line per family
  (Evolt, Withings, Manual), never mixed (`familySeries`, `pickFamily`); weight
  is merged. Scan fields live in `src/body/scanFields.ts`; skeletal muscle is
  never muscle mass, visceral level never visceral fat.
- Scans: `src/data/evolt_scans.json` (schema `pepito-scan-import/v1`) is imported
  by the v22 migration (`scanHistory.ts`); More › Data › Import scans uses
  `scanImport.ts` (dedupe on date + time + device).
- Charts: one component, `src/components/charts/TrendChart.jsx`, arithmetic in
  `src/body/chartPoints.ts` (FamilyChart for device lines). Compound lanes
  (`Lanes.jsx`, `src/body/lanes.ts`) sit under every chart. Series colours only
  from `--series-*` tokens.
- Demo data: `VITE_DEMO_HEALTH=1 npx vite --port 5175` in dev only, then
  `BASE_URL=http://localhost:5175/budget-app/ node e2e/_health-demo.mjs`.
- Nothing with health values goes to the network or to the console.
- iOS: HealthKit entitlement in `ios/App/App/App.entitlements`; the read prompt
  text is `NSHealthShareUsageDescription` in Info.plist.
