// Runs every test/*.test.mjs.
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const testDir = new URL('../test/', import.meta.url).pathname
let failed = false

for (const file of readdirSync(testDir).filter(f => f.endsWith('.test.mjs')).sort()) {
  try {
    execFileSync(process.execPath, [testDir + file], { stdio: 'inherit' })
  } catch {
    failed = true
  }
}

if (failed) {
  console.error('\nsome tests failed')
  process.exit(1)
}
console.log('\nall tests passed')
