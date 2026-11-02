const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/jobMatchStorage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject, Date });

test('a recommendation can be restored before its job IDs are returned', () => {
  const record = { version: 1, taskId: 'task', resumeId: 'resume', resumeName: 'test',
    resumeStatus: 'need_review', jobIds: [], jobIndex: {}, savedAt: Date.now(), mode: 'recommend' };
  const restored = exportsObject.parseStoredJobMatch(record);
  assert.equal(restored.taskId, 'task');
  assert.equal(restored.resumeStatus, 'need_review');
  assert.equal(restored.mode, 'recommend');
  assert.equal(exportsObject.parseStoredJobMatch({ ...record, mode: 'manual' }), null);
});
