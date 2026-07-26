# Peptide Command Center

An installable, offline-capable personal tracker for peptide protocols — dosing and titration, injection-site rotation, single-syringe mixing chemistry, body composition and adherence.

> **Personal tracking tool — not medical advice.** Every dose, ladder, cycle and evidence tier in the app is an editable starting point, reviewed by nobody. Verify everything yourself.

**Live app:** https://buzz1503.github.io/budget-app/

## Your data stays on your device

Nothing is uploaded anywhere — there is no backend. Logs, photos and measurements live in your browser's localStorage and IndexedDB, and none of it is in this repository. Because that storage can be cleared by the browser or the OS, use **More → Settings → Back up everything** periodically; that produces one file containing your data *and* your photos.

## Install on iPhone

Open the live URL in **Safari** → Share → **Add to Home Screen** → Add. It launches full-screen with no address bar and works offline.

## What's in it

| Screen | What it does |
| --- | --- |
| **Home** | Time-aware AM/PM slots showing exactly what's due now; one-tap logging with injection-site rotation; co-draw ("log together") with safety gating |
| **Calculator** | Reconstitution and dose maths, both directions, with an animated U-100 syringe |
| **Body** | Measurements, trends with a 7-day rolling average, progress photos with a ghost-overlay pose guide, a metric-driven body model, and an outcome engine |
| **Symptoms** | Daily check-ins with a 14-day heatmap overlaid against active peptides |
| **Mix** | A 3,655-pair chemistry matrix over 86 compounds; verdict-driven reaction animations; a mandatory visual-inspection gate on cautions |
| **More** | Right Now (cycle phases), Plan (titration), Library, Stock, Needle guide, History & adherence, Settings |

Peptides added from the compound list carry an **evidence tier (T1–T5)** and a dose-confidence rating, and keep *established* (evidence) and *reported* (community) effects strictly separate. Compounds flagged **TX** get no dose at all — only the safety reason.

## Development

```bash
npm install
npm run dev              # dev server
npm test                 # 119 unit tests
npm run build            # production build (PWA)
npm run preview          # serve the build at /budget-app/
node e2e/pwa.mjs         # PWA + offline checks (needs preview running)
```

Other suites in `e2e/` (`smoke`, `v3`–`v6`) drive the app in a real browser at 390px; each takes a `BASE_URL`.

Deployment is automatic: pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages.

## Stack

React + Vite · Tailwind CSS v4 · Zustand (persisted) · Framer Motion · Recharts · vite-plugin-pwa (Workbox) · idb-keyval · pdf.js
