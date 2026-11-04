// Run with: node infra/test_cf_function.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'cf_index_rewrite.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const cases = [
  ['/r-test/', '/r-test/index.html'],
  ['/r-test', '/r-test/index.html'],
  ['/r-test/assets/index-abc.js', '/r-test/assets/index-abc.js'],
  ['/r-test/about', '/r-test/about/index.html'],
  ['/_rip/index.html', '/_rip/index.html'],
];

for (const [input, expected] of cases) {
  const out = sandbox.handler({ request: { uri: input } }).uri;
  assert.strictEqual(out, expected, `${input} -> ${out}, expected ${expected}`);
  console.log(`ok  ${input} -> ${out}`);
}
console.log('all passed');
