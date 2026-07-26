# Peptide Command Center

A personal peptide-protocol tracker — gamified, mobile-first, fully offline. **Not medical advice**: every dose, ladder, and cycle in the app is an editable anecdotal starting point.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
npm test           # vitest — titration + calculator math
node e2e/smoke.mjs # Playwright smoke test (needs `npm run dev` running)
```

## Stack

React + Vite · Tailwind CSS v4 · Zustand (`persist` → localStorage) · Framer Motion · Recharts · lucide-react · canvas-confetti · date-fns

## Tabs

- **Today** — daily completion ring, streak flame, XP/level; one-tap dose logging with celebration; expiry + restock alerts
- **Library** — 11 seeded peptides, all fields editable inline, add custom peptides
- **Schedule** — tolerance-gated titration ladders ("Tolerating well — advance?"), per-step overrides, cycle rings, 12-week dated projection (ceiling never exceeded)
- **Calc** — reconstitution math both directions with an animated U-100 syringe (1 unit = 0.01 mL)
- **Mix** — conservative will-they-mix verdicts; every pair separate unless verified; known-good pairs persist
- **Stock** — vial inventory, burn rate, run-out date, AUD cost per dose, fridge-expiry timers
- **Needle** — editable SubQ reference (29–31 g, 4–8 mm, site rotation)
- **More** — badges shelf, theme toggle, currency, restock lead time, JSON export, reset

All state persists in localStorage under the key `peptide-command-center`.
