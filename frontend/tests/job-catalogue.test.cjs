const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/jobCatalogue.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const api = {};
vm.runInNewContext(code, { exports: api, Set, Error });

test('locations retain every scope, normalize aliases, and group cities under provinces', () => {
  const jobs = [{ cities: ['河南', '郑州市', '广东省', '深圳市', '深圳', '全国', '海外', '嘉兴等'] }];
  const groups = api.locationGroups(jobs);
  assert.deepEqual(Array.from(groups.find(g => g.label === '河南').options, x => x.value), ['河南', '郑州']);
  assert.deepEqual(Array.from(groups.find(g => g.label === '广东').options, x => x.value), ['广东', '深圳']);
  assert.equal(groups[0].label, '全国范围');
  assert.equal(groups.flatMap(g => g.options).length, 7);
  assert.deepEqual(Array.from(api.jobCities({cities:['全国项目（以上海、北京等城市为主）','深圳、广州']})), ['全国项目（以上海、北京等城市为主）','深圳','广州']);
  assert.equal(api.filterJobCatalogue([{ cities:['广东省'], title:'开发', company:'甲', category:'计算机', education:'本科' }], {search:'', education:'全部', city:'广东'}).length, 1);
});

test('homepage catalogue includes all ten pages, including unverified jobs', async () => {
  const records = Array.from({ length: 1000 }, (_, i) => ({ job_id: String(i), application_status: i % 2 ? 'open' : 'unverified' }));
  const requested = [];
  const result = await api.loadJobCatalogue(async ({ page, page_size }) => {
    requested.push(page);
    return { total: 1000, catalogue_version: 'v1', items: records.slice((page - 1) * page_size, page * page_size) };
  });
  assert.equal(result.total, 1000);
  assert.equal(result.items.length, 1000);
  assert.equal(result.items.filter(x => x.application_status === 'unverified').length, 500);
  assert.deepEqual(requested, [1,2,3,4,5,6,7,8,9,10]);
});

test('empty, incomplete and changing catalogues cannot become misleading totals', async () => {
  assert.equal((await api.loadJobCatalogue(async () => ({ total: 0, items: [], catalogue_version: 'v1' }))).total, 0);
  await assert.rejects(api.loadJobCatalogue(async () => ({ total: 1000, items: [], catalogue_version: 'v1' })), /加载不完整/);
  await assert.rejects(api.loadJobCatalogue(async ({ page }) => ({ total: 101, items: [], catalogue_version: 'v' + page })), /已更新/);
  await assert.rejects(api.loadJobCatalogue(async () => ({ total: 2, items: [{job_id:'same'}, {job_id:'same'}], catalogue_version:'v1' })), /加载不完整/);
});

test('category badges and results share combined search, degree and city filters', () => {
  const jobs = [
    { job_id:'a', title:'Java工程师', company:'甲', category:'计算机', education:'本科', cities:['北京'] },
    { job_id:'b', title:'Java开发', company:'乙', category:'计算机', education:'硕士', cities:['北京市','深圳'] },
    { job_id:'c', title:'Java课程研发', company:'丙', category:'文法教育', education:'本科', cities:['北京市'] },
    { job_id:'d', title:'Java工程师', company:'丁', category:'计算机', education:'本科', cities:['上海'] },
  ];
  for (const filters of [
    {search:'',education:'全部',city:'全部'},
    {search:'java',education:'全部',city:'北京'},
    {search:' Java ',education:'本科',city:'北京市'},
    {search:'没有的岗位',education:'本科',city:'北京'},
  ]) {
    const filtered = api.filterJobCatalogue(jobs, filters);
    const counts = new Map();
    filtered.forEach(job => counts.set(job.category, (counts.get(job.category) || 0) + 1));
    assert.equal([...counts.values()].reduce((sum, n) => sum + n, 0), filtered.length);
    for (const category of ['计算机','文法教育']) assert.equal(counts.get(category) || 0, filtered.filter(job => job.category === category).length);
  }
  assert.equal(api.filterJobCatalogue(jobs, {search:'java',education:'全部',city:'北京'}).length, 3);
  assert.equal(api.filterJobCatalogue(jobs, {search:'java',education:'本科',city:'北京市'}).length, 2);
  assert.equal(api.filterJobCatalogue(jobs, {search:'乙',education:'全部',city:'北京'}).length, 1);
  assert.deepEqual(Array.from(api.jobCities({cities:['东莞市/中山市/江门市','东莞']})), ['东莞','中山','江门']);
});
