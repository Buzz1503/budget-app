// Assemble the single-file artifact: inline the CSS + JS bundle into one HTML
// document. Run after `vite build --config vite.artifact.config.js`.
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIST = 'dist-artifact/assets'
const OUT = process.argv[2] || 'dist-artifact/peptide-command-center.html'

const files = readdirSync(DIST)
const cssFile = files.find((f) => f.endsWith('.css'))
const jsFile = files.find((f) => f.endsWith('.js') && !f.includes('worker'))
if (!cssFile || !jsFile) throw new Error('build output not found — run the artifact vite build first')

const css = readFileSync(join(DIST, cssFile), 'utf8')
const js = readFileSync(join(DIST, jsFile), 'utf8')

// A stray closing tag inside the bundle would break out of the inlined block.
if (/<\/script/i.test(js)) throw new Error('JS bundle contains a closing script tag')
if (/<\/style/i.test(css)) throw new Error('CSS bundle contains a closing style tag')

// charset MUST be declared: without it the page is sniffed as windows-1252 and
// every em-dash / ellipsis / emoji in the UI copy renders as mojibake.
const html = `<meta charset="utf-8" />
<title>Pepito +</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`

writeFileSync(OUT, html, 'utf8')
console.log(`wrote ${OUT} — ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB`)
