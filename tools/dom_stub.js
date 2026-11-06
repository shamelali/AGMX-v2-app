/* ============================================================
   AGMX — minimal DOM stub for the view harnesses
   ------------------------------------------------------------
   Enough of Element and Document for the no-build views to run
   under plain node: text-only rendering (innerHTML assignment is
   an assertion failure), child lists, class lookups, and click
   handlers that report which control was pressed.
   Usage: const { El, makeDocument } = require("./dom_stub.js");
   ============================================================ */
"use strict";

const assert = require("assert");

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.style = {};
    this.dataset = {};
    this._text = "";
    this._attrs = {};
    this._listeners = {};
    this.parentElement = null;
    this.disabled = false;
    this.value = "";
  }
  get className() { return this._attrs.class || ""; }
  set className(v) { this._attrs.class = String(v); }
  get textContent() {
    return this._text + this.childNodes.map((c) => c.textContent || "").join("");
  }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  set innerHTML(v) { throw new Error(`innerHTML assigned (${v}) — AGMX renders values as text`); }
  get innerHTML() { return undefined; }
  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  append(...children) { children.forEach((c) => this.appendChild(c)); }
  prepend(child) { child.parentElement = this; this.childNodes.unshift(child); }
  replaceChildren(...children) {
    this._text = "";
    this.childNodes = [];
    children.forEach((c) => this.appendChild(c));
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  click() {
    const calls = this._listeners.click || [];
    assert.ok(calls.length, `no click handler on ${this.className}`);
    return Promise.all(calls.map((fn) => fn({ currentTarget: this })));
  }
  hasListener(type) { return (this._listeners[type] || []).length > 0; }
  get parentNode() { return this.parentElement; }
  get firstChild() { return this.childNodes[0] || null; }
  focus() { /* the views only move focus; nothing asserts on it */ }
  remove() {
    const siblings = this.parentElement && this.parentElement.childNodes;
    if (siblings) this.parentElement.childNodes = siblings.filter((c) => c !== this);
  }
  insertBefore(node, reference) {
    node.parentElement = this;
    const at = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node);
    return node;
  }
  dispatchEvent(event) {
    (this._listeners[event.type] || []).forEach((fn) => fn(event));
    return true;
  }
  removeAttribute(k) { delete this._attrs[k]; }
  // Descendants only, like the real Element APIs these views rely on.
  querySelectorAll(selector) { return this.all().filter((n) => n.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { const l = list(); if (!l.includes(c)) l.push(c); self.className = l.join(" "); },
      remove: (c) => { self.className = list().filter((x) => x !== c).join(" "); },
      toggle: (c) => { const l = list(); const at = l.indexOf(c); if (at < 0) l.push(c); else l.splice(at, 1); self.className = l.join(" "); },
    };
  }
  classListToggle() { /* unused by these views */ }
  matches(sel) {
    if (sel.startsWith(".")) return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(sel)) return node;
      node = node.parentElement;
    }
    return null;
  }
  all() {
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  findByClass(name) { return this.all().find((n) => n.className.split(/\s+/).includes(name)) || null; }
  findAllByClass(name) { return this.all().filter((n) => n.className.split(/\s+/).includes(name)); }
  findById(id) { return this.all().find((n) => n.id === id) || null; }
  findText(needle) {
    const lower = needle.toLowerCase();
    return this.all().some((n) => (n._text || "").toLowerCase().includes(lower));
  }
}

// `roots` are elements the code looks up by id (app-bootstrap resolves
// document.getElementById("app")), plus any pre-seeded nodes they contain.
function makeDocument(roots) {
  const doc = {
    createElement: (tag) => new El(tag),
    createComment: (text) => ({ nodeType: 8, textContent: String(text), childNodes: [] }),
    getElementById: (id) => {
      for (const root of Object.values(roots || {})) {
        const found = root && root.id === id ? root : root && root.findById(id);
        if (found) return found;
      }
      return null;
    },
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatchEvent(event) { (this._listeners[event.type] || []).forEach((fn) => fn(event)); return true; },
    readyState: "loading",
  };
  return doc;
}

// app-bootstrap dispatches a CustomEvent for its runtime status hook.
function makeCustomEvent() {
  return class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = (init && init.detail) || null;
    }
  };
}

module.exports = { El, makeDocument, makeCustomEvent };
