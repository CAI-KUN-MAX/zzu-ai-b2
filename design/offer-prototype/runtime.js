/*
 * 原型用的极简渲染器：解析 <template id="dc-template"> 里的模板，
 * 支持 {{a.b}} 取值、<sc-for list as>、<sc-if value>、onClick/onChange/onKeyDown、ref，
 * 每次 setState 后按位置比对更新 DOM（保留输入焦点和动画）。只服务于本目录的设计原型。
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var HTML_NS = 'http://www.w3.org/1999/xhtml';
  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onkeydown: 'keydown', onfocus: 'focus', onblur: 'blur' };

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (this.__schedule) this.__schedule();
  };

  function lookup(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var value = scope;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (value == null) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, function (_, path) {
      var v = lookup(scope, path);
      return v == null ? '' : String(v);
    });
  }

  function attrValue(raw, scope) {
    var m = raw.match(WHOLE);
    return m ? lookup(scope, m[1]) : interpolate(raw, scope);
  }

  // 模板 → 轻量节点树
  function build(node, scope, out) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child.nodeType === 3) {
        var text = interpolate(child.nodeValue, scope);
        if (text) out.push({ text: text });
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.localName;
      if (tag === 'sc-for') {
        var list = attrValue(child.getAttribute('list'), scope) || [];
        var as = child.getAttribute('as');
        for (var j = 0; j < list.length; j++) {
          var s = Object.create(scope);
          s[as] = list[j];
          s.$index = j;
          build(child, s, out);
        }
        continue;
      }
      if (tag === 'sc-if') {
        if (attrValue(child.getAttribute('value'), scope)) build(child, scope, out);
        continue;
      }
      var v = { tag: tag, ns: child.namespaceURI, attrs: {}, events: {}, value: null, ref: null, children: [] };
      var type = child.getAttribute('type');
      for (var k = 0; k < child.attributes.length; k++) {
        var name = child.attributes[k].name;
        var val = attrValue(child.attributes[k].value, scope);
        if (EVENTS[name]) {
          if (typeof val !== 'function') continue;
          var ev = EVENTS[name];
          // 和 React 一致：文本框的 onChange 每次输入都触发
          if (name === 'onchange' && (tag === 'textarea' || (tag === 'input' && type !== 'file' && type !== 'checkbox' && type !== 'radio'))) ev = 'input';
          v.events[ev] = val;
          continue;
        }
        if (name === 'ref') { v.ref = val; continue; }
        if (name === 'value' && (tag === 'input' || tag === 'textarea')) { v.value = val == null ? '' : String(val); continue; }
        if (val === true) val = name.indexOf('aria-') === 0 ? 'true' : '';
        if (val === false) { if (name.indexOf('aria-') === 0) val = 'false'; else continue; }
        if (val == null) continue;
        v.attrs[name] = String(val);
      }
      build(child, scope, v.children);
      out.push(v);
    }
  }

  var pendingRefs = [];

  function sameNode(node, v) {
    if (v.text != null) return node.nodeType === 3;
    return node.nodeType === 1 && node.__dc && node.localName === v.tag && node.__dc.attrs['class'] === v.attrs['class'];
  }

  function create(v) {
    if (v.text != null) return document.createTextNode(v.text);
    var el = v.ns && v.ns !== HTML_NS ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    el.__dc = { attrs: {}, events: {} };
    update(el, v, true);
    return el;
  }

  function update(el, v, fresh) {
    var old = el.__dc;
    var name;
    for (name in old.attrs) if (!(name in v.attrs)) el.removeAttribute(name);
    for (name in v.attrs) if (old.attrs[name] !== v.attrs[name]) el.setAttribute(name, v.attrs[name]);
    el.__handlers = v.events;
    var bound = Object.assign({}, old.events);
    Object.keys(v.events).forEach(function (ev) {
      if (bound[ev]) return;
      bound[ev] = true;
      el.addEventListener(ev, function (e) {
        var h = el.__handlers && el.__handlers[ev];
        if (h) h(e);
      });
    });
    patchChildren(el, v.children);
    if (v.value != null && el.value !== v.value) el.value = v.value;
    el.__dc = { attrs: v.attrs, events: bound };
    if (fresh && typeof v.ref === 'function') pendingRefs.push(function () { v.ref(el); });
  }

  function patchChildren(parent, vs) {
    var nodes = Array.prototype.slice.call(parent.childNodes);
    for (var i = 0; i < vs.length; i++) {
      var node = nodes[i];
      var v = vs[i];
      if (node && sameNode(node, v)) {
        if (v.text != null) { if (node.nodeValue !== v.text) node.nodeValue = v.text; }
        else update(node, v, false);
      } else {
        var fresh = create(v);
        if (node) parent.replaceChild(fresh, node); else parent.appendChild(fresh);
      }
    }
    for (var j = nodes.length - 1; j >= vs.length; j--) {
      if (nodes[j].parentNode === parent) parent.removeChild(nodes[j]);
    }
  }

  function mount(Component, host, template, props) {
    var c = new Component(props || {});
    if (!c.state) c.state = {};
    var queued = false;
    function render() {
      queued = false;
      var tree = [];
      build(template.content, c.renderVals(), tree);
      pendingRefs = [];
      patchChildren(host, tree);
      var refs = pendingRefs;
      pendingRefs = [];
      refs.forEach(function (f) { f(); });
    }
    c.__schedule = function () {
      if (queued) return;
      queued = true;
      Promise.resolve().then(render);
    };
    render();
    if (typeof c.componentDidMount === 'function') c.componentDidMount();
    return c;
  }

  window.DCLogic = DCLogic;
  window.DCPrototype = { mount: mount };
})();
