import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

const testFiles = args.length ? args.map((file) => `tests/e2e/${file}`) : ['tests/e2e/*.spec.js']

const result = spawnSync(
  process.execPath,
  ['./node_modules/mocha/bin/mocha.js', '--timeout', '30000', ...testFiles],
  {
    stdio: 'inherit',
    shell: false,
  },
)

process.exit(result.status ?? 1)
