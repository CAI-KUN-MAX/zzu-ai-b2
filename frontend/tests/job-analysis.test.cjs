const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/jobAnalysis.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
const api = {};
vm.runInNewContext(code, {exports:api, Date, Number, Math});
test('analysis clock advances while running and freezes on completion', () => {
  const item = {analysis_status:'running', analysis_started_at:'2026-11-14T00:00:00Z'};
  assert.equal(api.analysisDuration(item, Date.parse('2026-11-14T00:00:12Z')), ' · 已用时 12 秒');
  assert.equal(api.analysisDuration({...item, analysis_status:'degraded', analysis_elapsed_ms:12500}, Date.now()), ' · 耗时 12 秒');
  assert.equal(api.analysisDuration({analysis_status:'degraded'}, Date.now()), '');
  assert.equal(api.analysisDuration(item, 0), ' · 已用时 0 秒');
});
test('failure messages distinguish evidence conflict and unknown historical failures', () => {
  assert.match(api.analysisFailure({analysis_error:'inconsistent_evidence'}), /证据不一致/);
  assert.match(api.analysisFailure({degraded_reason:'model_failed'}), /未保存详细原因/);
});
