// Dependency-free hook unit harness. This does not replace real microphone/device tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function setup() {
  const slots = [];
  const cleanups = [];
  const instances = [];
  const received = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(fn) { return fn; },
    useEffect(fn) {
      const i = cursor++;
      if (!(i in slots)) { slots[i] = true; cleanups.push(fn()); }
    },
  };
  class Recognition {
    constructor() { instances.push(this); }
    start() {}
    stop() {}
    abort() { this.aborted = true; }
  }
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/useSpeechRecognition.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: name => { assert.equal(name, 'react'); return react; },
    window: { SpeechRecognition: Recognition }, Date,
  });
  const render = () => { cursor = 0; return exports.useSpeechRecognition({ onFinal: text => received.push(text) }); };
  return { render, instances, received, unmount: () => cleanups.forEach(fn => fn?.()) };
}

function result(instance, text) {
  instance.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
}

test('current final text is delivered, interim text is not', () => {
  const h = setup(); h.render().start(); const r = h.instances[0]; r.onstart();
  r.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'interim' } }] });
  assert.deepEqual(h.received, []);
  result(r, ' final '); assert.deepEqual(h.received, ['final']);
});

test('rapid start clicks create one recognition instance', () => {
  const h = setup(); const api = h.render(); api.start(); api.start();
  assert.equal(h.instances.length, 1);
});

test('stop isolates late text from the next question', () => {
  const h = setup(); h.render().start(); const old = h.instances[0]; old.onstart();
  h.render().stop(); result(old, 'old answer'); old.onstart(); old.onend();
  assert.deepEqual(h.received, []); assert.equal(old.aborted, true);
  assert.equal(h.render().status, 'stopped');
});

test('old end/error cannot clear or overwrite a restarted session', () => {
  const h = setup(); h.render().start(); const old = h.instances[0];
  h.render().stop(); h.render().start(); const current = h.instances[1]; current.onstart();
  old.onerror({ error: 'network' }); old.onend(); result(old, 'stale');
  assert.equal(h.render().status, 'listening');
  result(current, 'new answer'); assert.deepEqual(h.received, ['new answer']);
  h.render().start(); assert.equal(h.instances.length, 2);
});

for (const [error, status] of [['not-allowed', 'denied'], ['network', 'network'], ['no-speech', 'no-speech'], ['audio-capture', 'service']]) {
  test(`${error} remains specific after onend without onstart`, () => {
    const h = setup(); h.render().start(); const r = h.instances[0];
    r.onerror({ error }); const message = h.render().lastError; r.onend();
    assert.equal(h.render().status, status); assert.equal(h.render().lastError, message);
    h.render().start(); assert.equal(h.instances.length, 2);
  });
}

test('onend without onstart still reports failed startup', () => {
  const h = setup(); h.render().start(); h.instances[0].onend();
  assert.equal(h.render().status, 'failed');
});

test('switching to text or unmounting ignores queued results', () => {
  for (const action of ['reset', 'unmount']) {
    const h = setup(); h.render().start(); const r = h.instances[0];
    if (action === 'reset') h.render().reset(); else h.unmount();
    result(r, 'late'); r.onerror({ error: 'network' }); r.onend();
    assert.equal(r.aborted, true); assert.deepEqual(h.received, []);
    if (action === 'reset') assert.equal(h.render().status, 'idle');
  }
});
