const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/jobTrust.ts"), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const api = {};
vm.runInNewContext(code, {exports: api});
test("legacy open and URL without proof stay unverified", () => {
  const legacy = {application_status: "open", application_url: "https://example.com"};
  assert.equal(api.jobStatus(legacy), "招聘状态待核实");
  assert.equal(api.canApply(legacy), false);
  assert.equal(api.jobContent(legacy), "岗位内容完整度未知");
});
test("application requires verified open and entrance", () => {
  const job = {application_status: "open", effective_status: "open", application_url: "https://example.com", application_verified: true};
  assert.equal(api.canApply(job), true);
  assert.equal(api.canApply({...job, effective_status: "closed"}), false);
  assert.equal(api.canApply({...job, application_verified: false}), false);
  assert.equal(api.jobStatus({...job, effective_status: "closed"}), "招聘已关闭");
});
test("content labels distinguish evidence", () => {
  assert.equal(api.jobContent({jd_completeness: "summary"}), "岗位摘要");
  assert.equal(api.jobContent({jd_completeness: "campaign"}), "企业招聘简章");
  assert.equal(api.jobContent({jd_completeness: "full"}), "完整单岗 JD");
});
