const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const React = require(path.join(root, 'node_modules/react'));
const {renderToStaticMarkup} = require(path.join(root, 'node_modules/react-dom/server'));
function compile(source) { return ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText; }
const trust = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(root,'src/lib/jobTrust.ts'),'utf8')), {exports:trust});
const exportsObj = {};
const src = fs.readFileSync(path.join(root,'src/components/JobResultPage.tsx'),'utf8') + '\nexport { JobDetail };\n';
const stub = () => null;
function localRequire(id) {
 if(id === 'react') return React;
 if(id === 'react/jsx-runtime') return require(path.join(root,'node_modules/react/jsx-runtime'));
 if(id === '../lib/jobTrust') return trust;
 if(id === '../lib/theme') return {levelTone:()=>({chip:''})};
 return new Proxy({}, {get:()=>stub});
}
vm.runInNewContext(compile(src), {exports:exportsObj, require:localRequire});
const item = {job_id:'x',title:'测试岗位',level:'good',level_label:'匹配',score:80,stage1_score:80,matched:[],missing:[],subscores:[]};
const base = {company:'虚构公司',cities:['北京'],education:'本科',education_requirement:'本科',majors:['计算机'],graduation_year:'2027',published_at:'2026-01-01',publication_type:'original',jd_text:'虚构岗位内容',source_url:'https://example.com/source',verification_note:'测试',application_status:'open',effective_status:'open',application_verified:true,application_url:'https://example.com/apply',jd_completeness:'full'};
function render(job){return renderToStaticMarkup(React.createElement(exportsObj.JobDetail,{item,job,taskId:'t',resumeId:'r',onStartInterview:()=>{}}));}
test('details render application only when all verification prerequisites hold',()=>{
 for (const [change, expected] of [[{},true],[{effective_status:'closed'},false],[{effective_status:'unverified'},false],[{effective_status:undefined},false],[{application_verified:false},false],[{application_verified:undefined},false],[{application_url:null},false],[{application_url:''},false]]) {
  const html=render({...base,...change}); assert.equal(html.includes('前往投递'),expected,JSON.stringify(change)); assert.ok(html.includes('查看招聘来源'));
 }
});
test('details show content warnings and status independently',()=>{
 for (const [content,label,warning] of [['full','完整单岗 JD',false],['summary','岗位摘要',true],['campaign','企业招聘简章',true],['unknown','岗位内容完整度未知',true],[undefined,'岗位内容完整度未知',true]]) {
  const html=render({...base,jd_completeness:content,effective_status:'unverified'}); assert.ok(html.includes(label)); assert.equal(html.includes('岗位内容可能不完整'),warning); assert.ok(html.includes('招聘状态待核实')); assert.ok(!html.includes('前往投递'));
 }
 const closed=render({...base,effective_status:'closed'}); assert.ok(closed.includes('该岗位已关闭'));
});
