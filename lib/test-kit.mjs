// A test runner small enough to read in one sitting.

let failures = 0
let passes = 0

export function test(name, fn) {
  return { name, fn }
}

export async function run(suiteName, tests) {
  console.log(`\n${suiteName}`)
  for (const { name, fn } of tests) {
    try {
      await fn()
      passes++
      console.log(`  ok   ${name}`)
    } catch (err) {
      failures++
      // Without this the process exits 0 and tools/test.mjs reports success.
      process.exitCode = 1
      console.log(`  FAIL ${name}`)
      console.log(`       ${err.message}`)
      if (process.env.VERBOSE) console.log(err.stack)
    }
  }
}

export function summary() {
  console.log(`\n${passes} passed, ${failures} failed`)
  return failures === 0
}

export function eq(actual, expected, what = 'value') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`)
}

export function ok(cond, what = 'condition') {
  if (!cond) throw new Error(`${what} was falsy`)
}
