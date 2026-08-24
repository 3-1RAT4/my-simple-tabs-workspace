// L0 gates: syntax check every script, validate each manifest, run web-ext lint.
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const webExt = `${root}node_modules/.bin/web-ext`
const projects = readdirSync(root).filter(
  n => existsSync(`${root}${n}/manifest.json`) && statSync(`${root}${n}`).isDirectory()
)

let failed = false

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
  )
}

for (const project of projects) {
  const dir = `${root}${project}`
  console.log(`\n${project}`)

  try {
    JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
    console.log('  ok   manifest parses')
  } catch (err) {
    failed = true
    console.log(`  FAIL manifest: ${err.message}`)
  }

  for (const file of walk(dir).filter(f => f.endsWith('.js') && !f.includes('node_modules'))) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (err) {
      failed = true
      console.log(`  FAIL ${file.replace(dir + '/', '')}\n${err.stderr?.toString() ?? ''}`)
    }
  }
  console.log('  ok   scripts parse')

  try {
    execFileSync(
      webExt,
      ['lint', '--source-dir', dir, '--ignore-files', '*.sh', 'README.md', 'test/**'],
      { stdio: 'pipe' }
    )
    console.log('  ok   web-ext lint')
  } catch (err) {
    failed = true
    console.log(`  FAIL web-ext lint\n${err.stdout?.toString() ?? ''}`)
  }
}

process.exit(failed ? 1 : 0)
