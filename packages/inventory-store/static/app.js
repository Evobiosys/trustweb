// Vanilla JS dashboard client. No framework, no build step.
const CATEGORIES = ["housing", "lendable-want-back", "give-without-worry", "network-introduction", "community-hostable"];
const CARE_IF_LOST = ["high", "medium", "none"];
const CIRCLES = ["self", "inner", "solidarity", "extended"];
const STATUSES = ["available", "lent-out", "reserved", "gone", "retired"];
const SOURCES = ["manual", "transcript-extraction", "conversation-update"];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function selectField(name, options, label) {
  const wrap = el("label", {}, [document.createTextNode(label ?? name)]);
  const select = el("select", { name });
  for (const opt of options) select.append(el("option", { value: opt }, [document.createTextNode(opt)]));
  wrap.append(select);
  return wrap;
}

function textField(name, label) {
  const wrap = el("label", {}, [document.createTextNode(label ?? name)]);
  wrap.append(el("input", { name, type: "text" }));
  return wrap;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

async function loadRecords() {
  const records = await api("/api/current");
  const body = document.getElementById("records-body");
  body.innerHTML = "";
  for (const r of records) {
    const tr = el("tr", {}, [
      el("td", {}, [document.createTextNode(r.name)]),
      el("td", {}, [document.createTextNode(r.category)]),
      el("td", {}, [document.createTextNode(r.status)]),
      el("td", {}, [document.createTextNode(r.care_if_lost)]),
      el("td", {}, [document.createTextNode(r.circle)]),
      el("td", {}, [document.createTextNode(r.availability_note ?? "")]),
      el("td", {}, [document.createTextNode(r.claimed_at)]),
      el("td", {}, [document.createTextNode(r.id)]),
    ]);
    body.append(tr);
  }
}

function buildNewRecordForm() {
  const form = document.getElementById("new-record-form");
  form.className = "grid";
  form.append(
    textField("name"),
    selectField("category", CATEGORIES),
    textField("description"),
    selectField("care_if_lost", CARE_IF_LOST),
    selectField("circle", CIRCLES),
    selectField("status", STATUSES),
    textField("location"),
    textField("availability_note"),
    textField("community_pool"),
    textField("tags (comma-separated)", "tags"),
    textField("note"),
    selectField("source", SOURCES),
  );
  form.append(el("button", { type: "submit" }, [document.createTextNode("Add resource")]));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const record = {
      name: fd.get("name") || "",
      category: fd.get("category"),
      description: fd.get("description") || "",
      care_if_lost: fd.get("care_if_lost"),
      circle: fd.get("circle"),
      status: fd.get("status"),
      location: fd.get("location") || null,
      availability_note: fd.get("availability_note") || null,
      community_pool: fd.get("community_pool") || null,
      tags: (fd.get("tags (comma-separated)") || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      note: fd.get("note") || null,
      source: fd.get("source"),
      heard_from: null,
      verified: null,
      claimed_at: new Date().toISOString(),
    };
    const result = await api("/api/records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    if (result.warning) {
      if (confirm(`Warning: ${result.warning} (pool ${result.poolId}). Proceed anyway?`)) {
        await api("/api/records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...record, confirmed: true }),
        });
      }
    }
    form.reset();
    loadRecords();
  });
}

function buildSupersedeForm() {
  const form = document.getElementById("supersede-form");
  form.append(
    textField("id", "resource id to supersede"),
    selectField("status", STATUSES),
    textField("availability_note"),
    textField("note"),
  );
  form.append(el("button", { type: "submit" }, [document.createTextNode("Supersede")]));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const id = fd.get("id");
    const patch = {};
    if (fd.get("status")) patch.status = fd.get("status");
    if (fd.get("availability_note")) patch.availability_note = fd.get("availability_note");
    if (fd.get("note")) patch.note = fd.get("note");
    const result = await api(`/api/records/${encodeURIComponent(id)}/supersede`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (result.warning) {
      if (confirm(`Warning: ${result.warning} (pool ${result.poolId}). Proceed anyway?`)) {
        await api(`/api/records/${encodeURIComponent(id)}/supersede`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...patch, confirmed: true }),
        });
      }
    }
    form.reset();
    loadRecords();
  });
}

function renderTrace(trace) {
  const container = document.getElementById("query-trace");
  container.innerHTML = "";
  const section = (title, data) => {
    container.append(el("h3", {}, [document.createTextNode(title)]));
    container.append(el("pre", {}, [document.createTextNode(JSON.stringify(data, null, 2))]));
  };
  section("1. query", trace.query);
  section("2. scanned", trace.scanned);
  section("3. candidates", trace.candidates);
  section("4. k_decision", trace.k_decision);
  section("5. outward", trace.outward);
}

function buildQueryForm() {
  const form = document.getElementById("query-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const trace = await api("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester: fd.get("requester"), text: fd.get("text") }),
    });
    renderTrace(trace);
  });
}

buildNewRecordForm();
buildSupersedeForm();
buildQueryForm();
document.getElementById("reload-records").addEventListener("click", loadRecords);
loadRecords();
