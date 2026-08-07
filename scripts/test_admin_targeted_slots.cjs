#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.classList = { add: (...names) => names.forEach((name) => this.addClass(name)) };
    this.dataset = {};
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
  }

  addClass(name) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    names.add(name);
    this.className = [...names].join(" ");
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  click() {}
  remove() {}
}

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
};

element("admin-token").value = "test-admin-token";
element("stale-minutes").value = "240";
element("recent-page-size").value = "25";

const slots = Array.from({ length: 22 }, (_, index) => ({
  slot_id: `gapfill-slot-${String(index + 1).padStart(2, "0")}`,
  allocation_cohort: "gapfill_2026_07_microcell_v1",
  allocation_strategy_version: "speaker_bundle_latin_v1",
  cell_id: (index % 20) + 1,
  list_comb: "ABCD",
  pronunciation_style: index % 2 ? "b" : "a",
  speaker_pattern_bundle: (index % 10) + 1,
  status: index < 18 ? "open" : index < 20 ? "claimed" : "completed",
  claim_count: index < 18 ? 0 : 1,
  claimed_session_id: index < 18 ? null : `session-${index + 1}`,
  completed_session_id: index < 20 ? null : `session-${index + 1}`,
  updated_at: "2026-08-08T00:00:00.000Z",
}));

const summary = {
  ok: true,
  counts: {
    sessions: 0,
    rating_trials: 0,
    rating_assignments: 0,
    event_logs: 0,
    word_familiarity_responses: 0,
    targeted_allocation_slots: 22,
  },
  quality: {},
  sessions_by_status: [],
  targeted_allocation_slots: slots,
  recent_sessions: [],
  recent_sessions_page: {
    limit: 25,
    offset: 0,
    total: 0,
    include_dry_run: false,
    has_previous: false,
    has_next: false,
  },
};

const context = {
  Blob,
  URL,
  URLSearchParams,
  console,
  document: {
    body: new FakeElement("body"),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: element,
  },
  fetch: async (requestPath) => {
    assert.match(String(requestPath), /^\/api\/admin\/summary\?/);
    return {
      ok: true,
      json: async () => summary,
      text: async () => "",
    };
  },
  setTimeout,
};

const adminJs = fs.readFileSync(path.resolve(__dirname, "../admin/admin.js"), "utf8");
vm.runInNewContext(adminJs, context, { filename: "admin/admin.js" });

element("refresh-btn").listeners.click();

setTimeout(() => {
  assert.equal(element("targeted-slots-total").textContent, "22");
  assert.equal(element("targeted-slots-open").textContent, "18");
  assert.equal(element("targeted-slots-claimed").textContent, "2");
  assert.equal(element("targeted-slots-completed").textContent, "2");
  assert.equal(element("targeted-slots-progress").textContent, "2 / 22");
  assert.match(element("targeted-slots-meta").textContent, /expected 22-slot gap fill loaded/);
  assert.equal(element("targeted-slots-body").children.length, 22);
  assert.equal(element("admin-status").textContent, "Loaded");
  console.log("admin targeted-slot monitor: 22-slot rendering passed");
}, 0);
