// Runs every *.test.mjs under every project, plus the popup DOM tests.
import { readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const projects = readdirSync(root).filter(
  n => existsSync(`${root}${n}/manifest.json`) && statSync(`${root}${n}`).isDirectory()
)

let failed = false
for (const project of projects) {
  const testDir = `${root}${project}/test`
  if (!existsSync(testDir)) continue

  for (const file of readdirSync(testDir).filter(f => f.endsWith('.test.mjs'))) {
    try {
      execFileSync(process.execPath, [`${testDir}/${file}`], { stdio: 'inherit' })
    } catch {
      failed = true
    }
  }
}

if (failed) {
  console.error('\nsome tests failed')
  process.exit(1)
}
console.log('\nall projects passed')
