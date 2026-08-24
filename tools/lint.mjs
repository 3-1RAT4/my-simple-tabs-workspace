// L0 gates: manifest parses, every script parses, web-ext lint is clean.
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const webExt = `${root}node_modules/.bin/web-ext`
let failed = false

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'web-ext-artifacts') return []
    const path = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(path) : [path]
  })
}

try {
  JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'))
  console.log('ok   manifest parses')
} catch (err) {
  failed = true
  console.log(`FAIL manifest: ${err.message}`)
}

for (const file of walk(root.replace(/\/$/, '')).filter(f => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (err) {
    failed = true
    console.log(`FAIL ${file.replace(root, '')}\n${err.stderr?.toString() ?? ''}`)
  }
}
console.log('ok   scripts parse')

try {
  execFileSync(
    webExt,
    ['lint', '--source-dir', root, '--ignore-files', '*.sh', 'README.md', 'CLAUDE.md',
     'test/**', 'tools/**', 'package*.json', 'node_modules/**', 'web-ext-artifacts/**'],
    { stdio: 'pipe' }
  )
  console.log('ok   web-ext lint')
} catch (err) {
  failed = true
  console.log(`FAIL web-ext lint\n${err.stdout?.toString() ?? ''}`)
}

process.exit(failed ? 1 : 0)
