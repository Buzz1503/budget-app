#!/usr/bin/env node
// Run every e2e suite against one server and report honestly.
//
// This exists because of a bug in how the suites used to be counted. Each one
// defaulted to its own port, most of which nobody ever started, so those suites
// exited on connection-refused having printed no FAIL lines — and a count of
// FAIL lines read that as a clean pass. A suite that never ran looked exactly
// like a suite that passed.
//
// So: a suite's exit code decides, its own failure lines are reported, and a
// run that printed no PASS lines at all is called out as never having started
// rather than quietly counted as green.
import { spawnSync } from 'child_process'
import { readdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const only = process.argv.slice(2)
const suites = only.length ? only : readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'run-all.mjs')
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

const rows = []
for (const name of suites) {
  const r = spawnSync('node', [new URL(`./${name}.mjs`, import.meta.url).pathname], {
    encoding: 'utf8', env: { ...process.env, BASE_URL: BASE },
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const fails = (out.match(/^FAIL/gm) || []).length
  const passes = (out.match(/^PASS/gm) || []).length
  const noise = (out.match(/^\s+console: |^\s+pageerror: /gm) || []).length
  const ran = passes + fails > 0
  rows.push({ name, ok: r.status === 0 && ran, ran, passes, fails, noise, code: r.status })
  const mark = !ran ? 'NEVER RAN' : r.status === 0 ? 'ok' : 'FAILED'
  console.log(`${mark.padEnd(10)} ${name.padEnd(8)} ${passes} passed, ${fails} failed${noise ? `, ${noise} console error(s)` : ''}`)
  if (fails) for (const line of out.match(/^FAIL.*$/gm)) console.log(`             ${line}`)
  if (!ran) console.log(`             ${out.trim().split('\n').slice(-3).join(' | ').slice(0, 200)}`)
}

const bad = rows.filter((r) => !r.ok)
console.log(`\n${rows.length - bad.length}/${rows.length} suites green · ${rows.reduce((n, r) => n + r.passes, 0)} steps passed`)
if (bad.length) console.log(`not green: ${bad.map((r) => `${r.name}${r.ran ? '' : ' (never ran)'}`).join(', ')}`)
process.exit(bad.length ? 1 : 0)
