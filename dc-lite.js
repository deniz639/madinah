/* dc-lite: tiny renderer for the Madinah static site.
   Reads the page template (<template id="dc-tpl">), runs the page's Component
   logic, fills {{holes}}, repeats loops, shows/hides conditionals, and patches
   the live page in place when state changes (so animations don't replay). */
(function () {
  'use strict';
  var handlers = {}, hid = 0;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, p);
    schedule();
  };
  window.DCLogic = DCLogic;

  var comp, tpl, app, queued = false;
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(function () { queued = false; update(); }); } }

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g, ONE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  function look(scope, path) {
    if (path === 'true') return true; if (path === 'false') return false;
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function fill(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = look(scope, p); return v == null || v === false ? '' : String(v); });
  }
  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown' };
  var BOOL = { checked: 1, disabled: 1, selected: 1, hidden: 1, open: 1, readonly: 1, required: 1 };

  function renderInto(parent, nodes, scope) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { parent.appendChild(document.createTextNode(fill(n.nodeValue, scope))); continue; }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'TEMPLATE' && n.hasAttribute('data-for')) {
        var m = ONE.exec(n.getAttribute('data-for')), list = m ? look(scope, m[1]) : null, as = n.getAttribute('data-as') || 'item';
        (list || []).forEach(function (item, idx) {
          var s = Object.create(scope); s[as] = item; s.$index = idx;
          renderInto(parent, n.content.childNodes, s);
        });
        continue;
      }
      if (n.tagName === 'TEMPLATE' && n.hasAttribute('data-if')) {
        var mm = ONE.exec(n.getAttribute('data-if')), val = mm ? look(scope, mm[1]) : false;
        if (val && val !== 'false') renderInto(parent, n.content.childNodes, scope);
        continue;
      }
      var el = n.namespaceURI === 'http://www.w3.org/2000/svg'
        ? document.createElementNS(n.namespaceURI, n.tagName) : document.createElement(n.tagName);
      for (var a = 0; a < n.attributes.length; a++) {
        var at = n.attributes[a], name = at.name, raw = at.value, one = ONE.exec(raw);
        if (EVENTS[name]) {
          var fn = one ? look(scope, one[1]) : null;
          if (typeof fn === 'function') { var id = 'h' + (hid++); handlers[id] = fn; el.setAttribute('data-dc-' + EVENTS[name], id); }
          continue;
        }
        var v = one ? look(scope, one[1]) : fill(raw, scope);
        if (BOOL[name]) { if (v && v !== 'false') el.setAttribute(name, ''); continue; }
        if (v == null || v === false) continue;
        el.setAttribute(name, String(v));
      }
      renderInto(n.tagName === 'TEMPLATE' ? el.content : el, (n.tagName === 'TEMPLATE' ? n.content : n).childNodes, scope);
      parent.appendChild(el);
    }
  }

  /* in-place patch: keeps existing elements (and their running animations) */
  function morph(live, next) {
    var lc = live.childNodes, nc = next.childNodes, i;
    for (i = 0; i < nc.length; i++) {
      var a = lc[i], b = nc[i];
      if (!a) { live.appendChild(b.cloneNode(true)); continue; }
      if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { live.replaceChild(b.cloneNode(true), a); continue; }
      if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; continue; }
      if (a.nodeType !== 1) continue;
      var j, at;
      for (j = a.attributes.length - 1; j >= 0; j--) { at = a.attributes[j].name; if (!b.hasAttribute(at)) a.removeAttribute(at); }
      for (j = 0; j < b.attributes.length; j++) { at = b.attributes[j]; if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); }
      if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') {
        if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
        else if (b.hasAttribute('value') && a.value !== b.getAttribute('value')) a.value = b.getAttribute('value');
      }
      if (a.tagName === 'DETAILS') continue; /* let the visitor open/close FAQs */
      morph(a, b);
      if (a.tagName === 'SELECT') { var sel = b.querySelector('option[selected]'); if (sel) a.value = sel.value || sel.textContent; }
    }
    while (lc.length > nc.length) live.removeChild(live.lastChild);
  }

  function update() {
    handlers = {}; hid = 0;
    var vals = comp.renderVals ? comp.renderVals() : {};
    var frag = document.createElement('div');
    renderInto(frag, tpl.content.childNodes, Object.assign(Object.create(comp.props), vals));
    morph(app, frag);
  }

  function dispatch(type) {
    document.addEventListener(type, function (e) {
      var t = e.target.closest ? e.target.closest('[data-dc-' + type + ']') : null;
      if (!t) return;
      var fn = handlers[t.getAttribute('data-dc-' + type)];
      if (fn) { if (type === 'submit') e.preventDefault(); fn(e); }
    });
  }

  function start() {
    tpl = document.getElementById('dc-tpl'); app = document.getElementById('app');
    var src = document.getElementById('dc-logic'), props = {};
    try { props = JSON.parse(src.getAttribute('data-props') || '{}'); } catch (e) {}
    var p = {}; Object.keys(props).forEach(function (k) { if (k[0] !== '$') p[k] = props[k] && typeof props[k] === 'object' && 'default' in props[k] ? props[k].default : props[k]; });
    var Component = new Function('DCLogic', src.textContent + '\n;return typeof Component!=="undefined"?Component:null;')(DCLogic);
    comp = Component ? new Component(p) : new DCLogic(p);
    if (!comp.props) comp.props = p;
    ['click', 'change', 'submit', 'keydown'].forEach(dispatch);
    /* React-style onChange on text fields fires while typing */
    document.addEventListener('input', function (e) {
      var t = e.target; if (!t.matches || !t.matches('[data-dc-change]')) return;
      if (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT') return;
      var fn = handlers[t.getAttribute('data-dc-change')]; if (fn) fn(e);
    });
    document.addEventListener('change', function (e) {
      var t = e.target; if (t.matches && t.matches('[data-dc-change]') && !(t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT')) e.stopImmediatePropagation();
    }, true);
    update();
    document.documentElement.classList.add('dc-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
