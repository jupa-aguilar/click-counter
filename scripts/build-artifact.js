// Empaqueta dist/ en un solo HTML para publicarlo como Artifact en claude.ai.
// Uso: npm run build:artifact  →  dist/explicamelo.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const assets = 'dist/assets'
const files = readdirSync(assets)
const read = ext => files.filter(f => f.endsWith(ext)).map(f => readFileSync(`${assets}/${f}`, 'utf8')).join('\n')
const css = read('.css')
const js = read('.js').replace(/<\/script/gi, '<\\/script')

const html = `<title>Explícamelo</title>
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`
writeFileSync('dist/explicamelo.html', html)
console.log(`dist/explicamelo.html (${(html.length / 1024).toFixed(1)} KB)`)
