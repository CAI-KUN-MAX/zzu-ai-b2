const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/interviewTips.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const data = new Map();
const sessionStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
const api = {};
vm.runInNewContext(code, { exports: api, sessionStorage });

test('confirmed tips survive refresh and stay isolated by task and resume', () => {
  api.saveInterviewTips('task-1', 'resume-1', { job1: ['确认的提示'], job2: [] });
  assert.equal(api.readInterviewTips('task-1', 'resume-1').job1[0], '确认的提示');
  assert.equal(Object.keys(api.readInterviewTips('task-2', 'resume-1')).length, 0);
  assert.equal(Object.keys(api.readInterviewTips('task-1', 'resume-2')).length, 0);
  assert.equal(api.readInterviewTips('task-1', 'resume-1').job2.length, 0);
});
