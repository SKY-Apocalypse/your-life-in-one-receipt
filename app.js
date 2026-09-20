/* ==========================================================================
   Threads — an eleven-year digital life, read sideways.

   The app has one idea: a receipt on its own is noise, but a receipt with its
   neighbours is a memory. Everything here exists to make those neighbours
   visible — the field draws them, the rail explains them, the story walks you
   through them.

   Sections
     1. Data & constants
     2. Small helpers
     3. Derived indexes
     4. State
     5. The field (canvas)
     6. The rail (detail panel)
     7. Reading views (chapters, moments, patterns)
     8. Story mode
     9. Wiring
   ========================================================================== */

(function () {
  "use strict";

  /* ── 1. Data & constants ─────────────────────────────────────────────── */

  const DATA = window.__THREADS_DATA__;

  const KINDS = [
    { id: "music",    label: "Listening", css: "--music" },
    { id: "place",    label: "Places",    css: "--place" },
    { id: "purchase", label: "Spending",  css: "--purchase" },
    { id: "media",    label: "Screens",   css: "--media" },
    { id: "event",    label: "Money in",  css: "--event" },
  ];

  const KIND_ORDER = KINDS.map((k) => k.id);

  const THREAD_COPY = {
    moment: "happened alongside this",
    echo:   "the same artist, years apart",
    place:  "the same place",
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ── 2. Small helpers ────────────────────────────────────────────────── */

  const $  = (sel, root = document) => root.querySelector(sel);
  const el = (id) => document.getElementById(id);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function kindColor(kind) {
    return cssVar("--" + kind) || cssVar("--text-soft");
  }

  /** Stable pseudo-random in [0,1) from a string — keeps node jitter fixed. */
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  function fmtDate(iso, withTime) {
    const d = new Date(iso);
    const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!withTime) return base;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${base}, ${hh}:${mm}`;
  }

  function fmtMonth(period) {              // "2017-04" → "Apr 2017"
    const [y, m] = period.split("-");
    return `${MONTHS[+m - 1]} ${y}`;
  }

  function fmtMoney(n) {
    if (n === null || n === undefined) return "—";
    return "₹" + Math.round(n).toLocaleString("en-IN");
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ── 3. Derived indexes ──────────────────────────────────────────────── */

  const receipts = DATA.receipts.map((r) => ({ ...r, ms: Date.parse(r.t) }));
  const byId = new Map(receipts.map((r) => [r.id, r]));

  /** id → [{ other, kind, label }] */
  const links = new Map();
  for (const t of DATA.threads) {
    if (!byId.has(t.a) || !byId.has(t.b)) continue;
    if (!links.has(t.a)) links.set(t.a, []);
    if (!links.has(t.b)) links.set(t.b, []);
    links.get(t.a).push({ other: t.b, kind: t.kind, label: t.label });
    links.get(t.b).push({ other: t.a, kind: t.kind, label: t.label });
  }

  /** id → moment it belongs to */
  const momentOf = new Map();
  for (const m of DATA.moments) {
    for (const id of m.members) momentOf.set(id, m);
  }

  /* Level of detail: rank receipts within their lane so a wide view can show
     only the most substantial ones. Zooming in lets the rest surface. */
  const LANE_SHARE = { music: .38, purchase: .22, place: .15, media: .13, event: .12 };

  for (const kind of KIND_ORDER) {
    receipts
      .filter((r) => r.type === kind)
      .sort((a, b) => weightOf(b) - weightOf(a))
      .forEach((r, i) => { r.rank = i; });
  }

  function weightOf(r) {
    if (r.type === "music") return (r.minutes || 0) + (r.loop || 0) * 12;
    return (r.amount || 0) + 30;
  }

  const T0 = receipts[0].ms;
  const T1 = receipts[receipts.length - 1].ms;

  const chapters = DATA.chapters.map((c) => ({
    ...c,
    t0: Date.parse(c.start + "-01T00:00"),
    t1: Date.parse(c.end + "-28T23:59"),
  }));

  /* ── 4. State ────────────────────────────────────────────────────────── */

  const state = {
    view: "field",                      // field | chapters | moments | patterns
    window: { t0: T0, t1: T1 },         // visible time range on the field
    kinds: new Set(KIND_ORDER),
    query: "",
    showLinks: true,
    selected: null,                     // receipt id
    hovered: null,
    story: null,                        // { step } while story mode runs
  };

  function matches(r) {
    if (!state.kinds.has(r.type)) return false;
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return (r.title + " " + (r.note || "") + " " + (r.category || "") +
            " " + (r.track || "")).toLowerCase().includes(q);
  }

  function select(id, opts = {}) {
    state.selected = id;
    if (opts.reveal && id) revealInWindow(byId.get(id).ms);
    if (opts.toField && state.view !== "field") setView("field");
    renderRail();
    drawField();
  }

  /** Nudge the time window so a receipt is actually on screen. */
  function revealInWindow(ms) {
    const { t0, t1 } = state.window;
    if (ms >= t0 && ms <= t1) return;
    const span = t1 - t0;
    state.window = { t0: ms - span / 2, t1: ms + span / 2 };
  }

  /* ── 5. The field ────────────────────────────────────────────────────── */

  const canvas = el("field");
  const ctx = canvas.getContext("2d");
  const tooltip = el("tooltip");

  const PAD = { l: 16, r: 16, t: 30, b: 26 };
  let layout = [];                      // [{ r, x, y, radius }]
  let cssW = 0, cssH = 0;

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField();
  }

  function laneFor(kind) {
    const i = KIND_ORDER.indexOf(kind);
    const top = PAD.t;
    const h = (cssH - PAD.t - PAD.b) / KIND_ORDER.length;
    return { top: top + i * h, height: h };
  }

  function xOf(ms) {
    const { t0, t1 } = state.window;
    return PAD.l + ((ms - t0) / (t1 - t0)) * (cssW - PAD.l - PAD.r);
  }

  function radiusOf(r) {
    if (r.type === "music") return clamp(Math.sqrt(r.minutes || 4) * 0.58, 1.7, 7);
    if (r.amount) return clamp(Math.sqrt(r.amount) * 0.085, 1.7, 7);
    return 2.4;
  }

  let shown = 0, inWindow = 0;

  function computeLayout() {
    layout = [];
    const { t0, t1 } = state.window;
    const budget = clamp(cssW * 0.9, 260, 1800);

    const visible = receipts.filter((r) => r.ms >= t0 && r.ms <= t1);
    inWindow = visible.length;

    // how many of each lane survive at this zoom level
    const counts = {};
    for (const r of visible) counts[r.type] = (counts[r.type] || 0) + 1;
    const allow = {};
    for (const kind of KIND_ORDER) {
      allow[kind] = Math.max(30, Math.round(budget * LANE_SHARE[kind]));
    }

    const density = clamp(Math.sqrt(budget / Math.max(visible.length, 1)), .5, 1);

    for (const r of visible) {
      // rank is global per lane; compare against the window's own cut-off
      if (counts[r.type] > allow[r.type] && r.rank > laneCutoff(r.type, allow[r.type], t0, t1))
        continue;
      const lane = laneFor(r.type);
      layout.push({
        r,
        x: xOf(r.ms),
        y: lane.top + lane.height * (0.18 + hash01(r.id) * 0.64),
        radius: radiusOf(r) * density,
      });
    }
    shown = layout.length;
  }

  /* The rank of the Nth-heaviest receipt of a lane inside the current window.
     Cached per window so panning stays cheap. */
  const cutoffCache = new Map();

  function laneCutoff(kind, allow, t0, t1) {
    const key = `${kind}|${allow}|${Math.round(t0)}|${Math.round(t1)}`;
    if (cutoffCache.has(key)) return cutoffCache.get(key);
    const ranks = receipts
      .filter((r) => r.type === kind && r.ms >= t0 && r.ms <= t1)
      .map((r) => r.rank)
      .sort((a, b) => a - b);
    const cut = ranks[Math.min(allow, ranks.length) - 1] ?? Infinity;
    if (cutoffCache.size > 400) cutoffCache.clear();
    cutoffCache.set(key, cut);
    return cut;
  }

  function drawField() {
    if (!cssW) return;
    computeLayout();
    ctx.clearRect(0, 0, cssW, cssH);

    drawChapterBands();
    drawLanes();
    if (state.showLinks) drawThreads();
    drawNodes();
    drawSelection();
    updateHint();
  }

  function updateHint() {
    const hint = el("fieldhint");
    if (!hint) return;
    hint.textContent = shown < inWindow
      ? `Showing the ${shown.toLocaleString("en-IN")} heaviest of ` +
        `${inWindow.toLocaleString("en-IN")} receipts in view — zoom in for the rest.`
      : "Drag to move through time, scroll to zoom, click any dot to pull its threads.";
  }

  function drawChapterBands() {
    const dim = cssVar("--line");
    ctx.save();
    chapters.forEach((c, i) => {
      const x0 = clamp(xOf(c.t0), PAD.l, cssW - PAD.r);
      const x1 = clamp(xOf(c.t1), PAD.l, cssW - PAD.r);
      if (x1 - x0 < 1) return;
      if (i % 2 === 0) {
        ctx.fillStyle = dim;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x0, PAD.t - 12, x1 - x0, cssH - PAD.t - PAD.b + 12);
        ctx.globalAlpha = 1;
      }
      if (x1 - x0 > 86) {
        ctx.fillStyle = cssVar("--text-dim");
        ctx.font = '500 11px "IBM Plex Sans", sans-serif';
        ctx.fillText(c.title, x0 + 8, PAD.t - 16);
      }
    });
    ctx.restore();
  }

  function drawLanes() {
    ctx.save();
    ctx.font = '500 10.5px "IBM Plex Mono", monospace';
    for (const k of KINDS) {
      const lane = laneFor(k.id);
      ctx.strokeStyle = cssVar("--line");
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, lane.top + lane.height);
      ctx.lineTo(cssW - PAD.r, lane.top + lane.height);
      ctx.stroke();
      const label = k.label.toLowerCase();
      const w = ctx.measureText(label).width;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = cssVar("--field-bg");
      ctx.fillRect(PAD.l, lane.top + 2, w + 10, 15);
      ctx.globalAlpha = state.kinds.has(k.id) ? 0.9 : 0.3;
      ctx.fillStyle = kindColor(k.id);
      ctx.fillText(label, PAD.l + 5, lane.top + 13);
    }
    ctx.globalAlpha = 1;

    // year ticks along the bottom
    const y0 = new Date(state.window.t0).getFullYear();
    const y1 = new Date(state.window.t1).getFullYear();
    ctx.fillStyle = cssVar("--text-dim");
    ctx.strokeStyle = cssVar("--line");
    for (let y = y0; y <= y1; y++) {
      const x = xOf(Date.parse(`${y}-01-01T00:00`));
      if (x < PAD.l || x > cssW - PAD.r) continue;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t - 10);
      ctx.lineTo(x, cssH - PAD.b + 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(String(y), x + 4, cssH - PAD.b + 16);
    }
    ctx.restore();
  }

  /** Faint background weave: echoes and repeated places, drawn as arcs. */
  function drawThreads() {
    const pos = new Map(layout.map((n) => [n.r.id, n]));
    ctx.save();
    ctx.lineWidth = 1;
    for (const t of DATA.threads) {
      if (t.kind === "moment") continue;
      const a = pos.get(t.a), b = pos.get(t.b);
      if (!a || !b) continue;
      if (!matches(a.r) || !matches(b.r)) continue;
      ctx.strokeStyle = t.kind === "echo" ? kindColor("music") : kindColor("place");
      ctx.globalAlpha = t.kind === "echo" ? 0.13 : 0.1;
      arc(a, b);
      ctx.stroke();
    }
    ctx.restore();
  }

  function arc(a, b) {
    const lift = Math.min(120, Math.abs(b.x - a.x) * 0.22);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x, a.y - lift, b.x, b.y - lift, b.x, b.y);
  }

  function drawNodes() {
    for (const n of layout) {
      const on = matches(n.r);
      ctx.globalAlpha = on ? 0.82 : 0.07;
      ctx.fillStyle = kindColor(n.r.type);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();

      // a loop worth noticing gets a ring
      if (on && n.r.loop >= 6) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = kindColor("music");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Selected node: its own halo plus bright threads to everything it touches. */
  function drawSelection() {
    const id = state.hovered || state.selected;
    if (!id) return;
    const pos = new Map(layout.map((n) => [n.r.id, n]));
    const here = pos.get(id);
    const connected = links.get(id) || [];

    ctx.save();
    ctx.lineWidth = 1.4;
    for (const link of connected) {
      const other = pos.get(link.other);
      if (!other || !here) continue;
      ctx.strokeStyle = link.kind === "echo" ? kindColor("music")
                      : link.kind === "place" ? kindColor("place")
                      : cssVar("--text-soft");
      ctx.globalAlpha = 0.75;
      arc(here, other);
      ctx.stroke();

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = kindColor(other.r.type);
      ctx.beginPath();
      ctx.arc(other.x, other.y, other.radius + 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (here) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssVar("--text");
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(here.x, here.y, here.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function nodeAt(px, py) {
    let best = null, bestD = 13;
    for (const n of layout) {
      if (!matches(n.r)) continue;
      const d = Math.hypot(n.x - px, n.y - py);
      if (d < Math.max(bestD, n.radius + 4)) { best = n; bestD = d; }
    }
    return best;
  }

  function showTooltip(node, px, py) {
    const r = node.r;
    const bits = [];
    if (r.type === "music") {
      bits.push(`${r.plays} plays · ${Math.round(r.minutes)} min`);
      if (r.track) bits.push(escapeHtml(r.track));
    } else {
      if (r.amount) bits.push(fmtMoney(r.amount));
      if (r.note) bits.push(escapeHtml(r.note));
    }
    tooltip.innerHTML =
      `<strong>${escapeHtml(r.title)}</strong><br>` +
      `<span class="t-when">${fmtDate(r.t, !r.dayonly)}</span><br>` +
      bits.join("<br>");
    tooltip.style.display = "block";
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = clamp(px + 14, 8, cssW - box.width - 8) + "px";
    tooltip.style.top = clamp(py + 14, 8, cssH - box.height - 8) + "px";
  }

  function hideTooltip() { tooltip.style.display = "none"; }

  /* ── field interaction ───────────────────────────────────────────────── */

  let drag = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.offsetX, moved: false, t0: state.window.t0, t1: state.window.t1 };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.offsetX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      const span = drag.t1 - drag.t0;
      const shift = (dx / (cssW - PAD.l - PAD.r)) * span;
      state.window = { t0: drag.t0 - shift, t1: drag.t1 - shift };
      hideTooltip();
      drawField();
      return;
    }
    const node = nodeAt(e.offsetX, e.offsetY);
    const id = node ? node.r.id : null;
    if (id !== state.hovered) {
      state.hovered = id;
      drawField();
    }
    if (node) showTooltip(node, e.offsetX, e.offsetY);
    else hideTooltip();
    canvas.style.cursor = node ? "pointer" : "grab";
  });

  canvas.addEventListener("pointerup", (e) => {
    const wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) return;
    const node = nodeAt(e.offsetX, e.offsetY);
    select(node ? node.r.id : null);
  });

  canvas.addEventListener("pointerleave", () => {
    state.hovered = null;
    hideTooltip();
    drawField();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.offsetX, e.deltaY > 0 ? 1.18 : 0.85);
  }, { passive: false });

  function zoomAt(px, factor) {
    const { t0, t1 } = state.window;
    const span = t1 - t0;
    const focus = t0 + ((px - PAD.l) / (cssW - PAD.l - PAD.r)) * span;
    const next = clamp(span * factor, 1000 * 60 * 60 * 24 * 3, (T1 - T0) * 1.2);
    const ratio = (focus - t0) / span;
    state.window = { t0: focus - next * ratio, t1: focus + next * (1 - ratio) };
    drawField();
  }

  // two-finger pinch on touch devices
  let pinch = null;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinch = { d: touchDist(e), t0: state.window.t0, t1: state.window.t1 };
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const scale = pinch.d / touchDist(e);
      const mid = (pinch.t0 + pinch.t1) / 2;
      const span = clamp((pinch.t1 - pinch.t0) * scale,
                         1000 * 60 * 60 * 24 * 3, (T1 - T0) * 1.2);
      state.window = { t0: mid - span / 2, t1: mid + span / 2 };
      drawField();
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => { pinch = null; });

  function touchDist(e) {
    const [a, b] = e.touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  /* ── 6. The rail ─────────────────────────────────────────────────────── */

  function renderRail() {
    const rail = el("rail");
    if (!state.selected) {
      rail.innerHTML = railIntro();
      return;
    }
    const r = byId.get(state.selected);
    const moment = momentOf.get(r.id);
    const connected = (links.get(r.id) || []).slice(0, 22);

    rail.innerHTML = `
      <div class="railsection">
        <span class="detail-kind" style="--kc:var(--${r.type})">
          ${KINDS.find((k) => k.id === r.type).label}
        </span>
        <h2 class="detail-title">${escapeHtml(r.title)}</h2>
        <p class="detail-when">${fmtDate(r.t, !r.dayonly)}</p>
        ${r.note ? `<p class="detail-note">${escapeHtml(r.note)}</p>` : ""}
        <dl class="facts">${factRows(r)}</dl>
      </div>

      ${moment ? `
      <div class="railsection">
        <h3 class="railhead">What this was part of</h3>
        <p class="railnote">${escapeHtml(moment.narration)}</p>
      </div>` : ""}

      <div class="railsection">
        <h3 class="railhead">${connected.length ? "Threads from here" : "Nearest in time"}</h3>
        <p class="railnote">${connected.length
          ? "Receipts this one is tied to. Follow any of them."
          : "Nothing else was logged close enough to tie to this one. " +
            "Here is what sits either side of it."}</p>
        <ul class="threadlist">
          ${(connected.length ? connected.map((link) => {
            const o = byId.get(link.other);
            return { o, why: (link.label ? escapeHtml(link.label) + " · " : "") +
                            THREAD_COPY[link.kind] };
          }) : neighbours(r)).map(({ o, why }) => `
            <li><button data-goto="${o.id}">
              ${escapeHtml(o.title)}
              <span class="why">${why} · ${fmtDate(o.t)}</span>
            </button></li>`).join("")}
        </ul>
      </div>`;

    rail.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () =>
        select(b.getAttribute("data-goto"), { reveal: true }));
    });
  }

  /** The closest receipts either side, for anything that stands alone. */
  function neighbours(r) {
    const i = receipts.indexOf(r);
    const near = [];
    for (let k = 1; k <= 3; k++) {
      if (receipts[i - k]) near.push(receipts[i - k]);
      if (receipts[i + k]) near.push(receipts[i + k]);
    }
    return near
      .sort((a, b) => Math.abs(a.ms - r.ms) - Math.abs(b.ms - r.ms))
      .slice(0, 6)
      .map((o) => ({ o, why: gapText(o.ms - r.ms) }));
  }

  function gapText(ms) {
    const abs = Math.abs(ms);
    const hour = 3.6e6, day = 8.64e7;
    const when = abs < hour ? `${Math.round(abs / 6e4)} minutes`
               : abs < day  ? `${Math.round(abs / hour)} hours`
               : abs < day * 60 ? `${Math.round(abs / day)} days`
               : `${Math.round(abs / (day * 30.4))} months`;
    return `${when} ${ms < 0 ? "earlier" : "later"}`;
  }

  function factRows(r) {
    const rows = [];
    if (r.type === "music") {
      rows.push(["Tracks played", r.plays]);
      rows.push(["Time", Math.round(r.minutes) + " min"]);
      if (r.track) rows.push(["Most played", r.track]);
      if (r.loop > 1) rows.push(["On repeat", r.loop + "×"]);
      rows.push(["Device", r.mode]);
    } else {
      if (r.amount) rows.push([r.flow === "Income" ? "Received" : "Amount",
                               fmtMoney(r.amount)]);
      if (r.category) rows.push(["Category", r.category]);
      if (r.mode) rows.push(["Paid by", r.mode]);
      rows.push(["Source", r.source === "card" ? "card statement" : "household ledger"]);
    }
    return rows.map(([k, v]) =>
      `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("");
  }

  function railIntro() {
    const v = DATA.patterns.vocab;
    return `
      <div class="railsection">
        <h3 class="railhead">Start anywhere</h3>
        <p class="railnote">
          Every dot is one receipt from someone's decade: a listening session, a
          fare, a bill, a subscription. Click one and the app draws what it was
          tangled up with.
        </p>
        <dl class="facts">
          <div><dt>Plays logged</dt><dd>${v.plays.toLocaleString("en-IN")}</dd></div>
          <div><dt>Hours of music</dt><dd>${v.hours.toLocaleString("en-IN")}</dd></div>
          <div><dt>Artists</dt><dd>${v.artists.toLocaleString("en-IN")}</dd></div>
          <div><dt>Transactions</dt><dd>${v.spends.toLocaleString("en-IN")}</dd></div>
          <div><dt>Reconstructed moments</dt><dd>${DATA.moments.length}</dd></div>
        </dl>
      </div>
      <div class="railsection">
        <h3 class="railhead">Three ways in</h3>
        <ul class="threadlist">
          <li><button data-jump="loop">The night one song played 76 times</button></li>
          <li><button data-jump="dense">The busiest hour in the archive</button></li>
          <li><button data-jump="last">The very last receipt</button></li>
        </ul>
      </div>`;
  }

  /* ── 7. Reading views ────────────────────────────────────────────────── */

  function renderChapters() {
    const maxHours = Math.max(...chapters.map((c) => c.hours));
    return `
      <div class="readwrap">
        <h2 class="lede">Eight stretches, found by looking for the moment the
          behaviour changed.</h2>
        <p class="lede-sub">Nobody labelled these. The app split the eleven years
          wherever listening hours, night-time share, skip rate and taste breadth
          shifted together, then described what it found. Open one to see it on
          the field.</p>
        ${chapters.map((c, i) => `
          <article class="chapter" data-chapter="${i}">
            <p class="ch-range">${fmtMonth(c.start)}<br>→ ${fmtMonth(c.end)}</p>
            <div>
              <h3 class="ch-title">${escapeHtml(c.title)}</h3>
              <p class="ch-sketch">${escapeHtml(c.sketch)}</p>
              <div class="ch-artists">
                ${c.artists.slice(0, 5).map((a) =>
                  `<span>${escapeHtml(a.name)}</span>`).join("")}
              </div>
            </div>
            <div class="ch-meter">
              <p class="meter"><b>${Math.round(c.hours).toLocaleString("en-IN")}</b>
                hours listened
                <span class="bar"><i style="width:${(c.hours / maxHours) * 100}%"></i></span>
              </p>
              <p class="meter"><b>${Math.round(c.night * 100)}%</b> after 11pm</p>
              <p class="meter"><b>${Math.round(c.skip * 100)}%</b> skipped</p>
            </div>
          </article>`).join("")}
      </div>`;
  }

  function renderMoments() {
    const list = DATA.moments.filter((m) =>
      !state.query ||
      m.narration.toLowerCase().includes(state.query.toLowerCase()));

    return `
      <div class="readwrap">
        <h2 class="lede">${DATA.moments.length} scenes rebuilt from receipts that
          sat too close together to be unrelated.</h2>
        <p class="lede-sub">Each card below was assembled by grouping receipts of
          different kinds within a three-hour window, then writing out what that
          combination describes. Click one to see its pieces on the field.</p>
        <div class="moments">
          ${list.length ? list.map((m) => `
            <button class="moment" data-moment="${m.id}">
              <p>${escapeHtml(m.narration)}</p>
              <span class="mkinds">
                ${m.kinds.map((k) => `<i style="background:var(--${k})"></i>`).join("")}
                <span class="mmeta">${m.n} receipts</span>
              </span>
            </button>`).join("")
          : `<p class="empty">Nothing matches “${escapeHtml(state.query)}”.</p>`}
        </div>
      </div>`;
  }

  function renderPatterns() {
    const p = DATA.patterns;
    const span = [Date.parse(DATA.meta.span[0]), Date.parse(DATA.meta.span[1])];

    const ghosts = p.ghosts.map((g) => {
      const f = Date.parse(g.first + " 1");
      const l = Date.parse(g.last + " 1");
      const pk = Date.parse(g.peak + "-01");
      const pct = (t) => ((t - span[0]) / (span[1] - span[0])) * 100;
      return `
        <div class="ghost">
          <b>${escapeHtml(g.name)}</b>
          <span class="n">${g.peak_n} plays in ${fmtMonth(g.peak)}</span>
          <span class="life">
            <i style="left:${pct(f)}%;width:${Math.max(1, pct(l) - pct(f))}%"></i>
            <u style="left:${pct(pk)}%"></u>
          </span>
        </div>`;
    }).join("");

    const loops = p.loops.map((l) => `
      <div class="loop">
        <span class="count">${l.n}×</span>
        <span>
          ${escapeHtml(l.track)}
          <small>${escapeHtml(l.artist)} · ${fmtDate(l.t, true)}</small>
        </span>
      </div>`).join("");

    return `
      <div class="readwrap">
        <h2 class="lede">Patterns nobody wrote down.</h2>
        <p class="lede-sub">Four ways of asking the same question: what kept
          happening, and what quietly stopped?</p>
        <div class="patterngrid">
          <section class="card">
            <h3>Artists who burned out</h3>
            <p class="sub">Each bar is how long an artist stayed in rotation. The
              amber mark is the month they took over — and then they were gone.</p>
            ${ghosts}
          </section>

          <section class="card">
            <h3>Songs on repeat</h3>
            <p class="sub">A single track, played over and over inside one
              sitting. These are the nights something was being worked through.</p>
            ${loops}
          </section>

          <section class="card">
            <h3>The pulse</h3>
            <p class="sub">Listening hours per month across eleven years, with
              recorded spending underneath where the ledger overlaps.</p>
            ${pulseChart(p.series)}
          </section>

          <section class="card">
            <h3>The clock</h3>
            <p class="sub">When in the day the music happened, summed across the
              whole archive.</p>
            ${clockChart(p.clock)}
          </section>
        </div>
      </div>`;
  }

  function pulseChart(series) {
    const W = 560, H = 190, base = H - 26;
    const maxH = Math.max(...series.map((s) => s.hours));
    const maxS = Math.max(...series.map((s) => s.spend)) || 1;
    const step = W / series.length;

    const line = series.map((s, i) =>
      `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},` +
      `${(base - (s.hours / maxH) * (base - 8)).toFixed(1)}`).join(" ");

    const bars = series.map((s, i) => s.spend
      ? `<rect x="${(i * step).toFixed(1)}" y="${base + 2}" width="${Math.max(step - .6, .6).toFixed(1)}"
               height="${((s.spend / maxS) * 18).toFixed(1)}" fill="var(--purchase)" opacity=".55"/>`
      : "").join("");

    const years = series.map((s, i) => s.m.endsWith("-01")
      ? `<text class="axis" x="${(i * step).toFixed(1)}" y="${H - 2}">${s.m.slice(2, 4)}</text>`
      : "").join("");

    return `<figure>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
           aria-label="Monthly listening hours from 2013 to 2024">
        <path d="${line}" fill="none" stroke="var(--music)" stroke-width="1.6"/>
        ${bars}${years}
      </svg>
      <figcaption>Peak: ${Math.round(maxH)} hours in a single month.</figcaption>
    </figure>`;
  }

  function clockChart(clock) {
    const W = 260, cx = W / 2, cy = W / 2, rIn = 42, rOut = 112;
    const max = Math.max(...clock);
    const wedges = clock.map((v, h) => {
      const a0 = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((h + 1) / 24) * Math.PI * 2 - Math.PI / 2;
      const r = rIn + (v / max) * (rOut - rIn);
      const night = h >= 23 || h < 5;
      const pt = (ang, rad) =>
        `${(cx + Math.cos(ang) * rad).toFixed(1)},${(cy + Math.sin(ang) * rad).toFixed(1)}`;
      return `<path d="M${pt(a0, rIn)} L${pt(a0, r)} A${r},${r} 0 0,1 ${pt(a1, r)}
                       L${pt(a1, rIn)} A${rIn},${rIn} 0 0,0 ${pt(a0, rIn)} Z"
              fill="var(--${night ? "place" : "music"})" opacity="${night ? .85 : .55}"/>`;
    }).join("");

    const night = clock.reduce((sum, v, h) =>
      (h >= 23 || h < 5) ? sum + v : sum, 0);
    const share = Math.round((night / clock.reduce((a, b) => a + b, 0)) * 100);

    return `<figure>
      <svg viewBox="0 0 ${W} ${W}" width="100%" role="img"
           aria-label="Plays by hour of day">
        ${wedges}
        <text class="axis" x="${cx}" y="${cy - 2}" text-anchor="middle">midnight</text>
        <text class="axis" x="${cx}" y="${cy + 12}" text-anchor="middle">${share}%</text>
      </svg>
      <figcaption>${share}% of all listening happened between 11pm and 5am.</figcaption>
    </figure>`;
  }

  /* ── 8. Story mode ───────────────────────────────────────────────────── */

  function startStory() {
    state.story = { step: 0 };
    setView("field");
    playStep();
  }

  function playStep() {
    const c = chapters[state.story.step];
    const pad = (c.t1 - c.t0) * 0.06;
    state.window = { t0: c.t0 - pad, t1: c.t1 + pad };

    // pick the richest moment inside this chapter as the anchor
    const anchor = DATA.moments
      .filter((m) => { const t = Date.parse(m.t); return t >= c.t0 && t <= c.t1; })
      .sort((a, b) => b.n - a.n)[0];

    state.selected = anchor ? anchor.members[0] : null;
    renderStoryBar(c, anchor);
    renderRail();
    drawField();
  }

  function renderStoryBar(c, anchor) {
    const bar = el("storybar");
    bar.hidden = false;
    bar.innerHTML = `
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.sketch)}</p>
      ${anchor ? `<p style="color:var(--text-dim);font-size:13px">
        Inside it: ${escapeHtml(anchor.narration)}</p>` : ""}
      <div class="storynav">
        <span class="step">${state.story.step + 1} of ${chapters.length} ·
          ${fmtMonth(c.start)} – ${fmtMonth(c.end)}</span>
        <button data-story="prev" ${state.story.step === 0 ? "disabled" : ""}>Back</button>
        <button data-story="next" ${
          state.story.step === chapters.length - 1 ? "disabled" : ""}>Next</button>
        <button data-story="exit">Close</button>
      </div>`;

    bar.querySelectorAll("[data-story]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.getAttribute("data-story");
        if (act === "exit") return endStory();
        state.story.step += act === "next" ? 1 : -1;
        playStep();
      });
    });
  }

  function endStory() {
    state.story = null;
    el("storybar").hidden = true;
  }

  /* ── 9. Wiring ───────────────────────────────────────────────────────── */

  function setView(view) {
    state.view = view;
    if (view !== "field") endStory();

    el("fieldwrap").hidden = view !== "field";
    el("reader").hidden = view === "field";
    el("rail").hidden = view !== "field";

    document.querySelectorAll(".viewswitch button").forEach((b) =>
      b.setAttribute("aria-current", String(b.dataset.view === view)));

    if (view === "chapters") el("reader").innerHTML = renderChapters();
    if (view === "moments")  el("reader").innerHTML = renderMoments();
    if (view === "patterns") el("reader").innerHTML = renderPatterns();

    el("reader").querySelectorAll("[data-chapter]").forEach((node) => {
      node.addEventListener("click", () => {
        const c = chapters[+node.dataset.chapter];
        const pad = (c.t1 - c.t0) * 0.06;
        state.window = { t0: c.t0 - pad, t1: c.t1 + pad };
        setView("field");
        drawField();
      });
    });

    el("reader").querySelectorAll("[data-moment]").forEach((node) => {
      node.addEventListener("click", () => {
        const m = DATA.moments.find((x) => x.id === node.dataset.moment);
        const t = Date.parse(m.t);
        const day = 1000 * 60 * 60 * 24;
        state.window = { t0: t - day * 45, t1: t + day * 45 };
        setView("field");
        select(m.members[0]);
      });
    });

    if (view === "field") requestAnimationFrame(resizeCanvas);
  }

  function buildControls() {
    const kinds = el("kinds");
    kinds.innerHTML = KINDS.map((k) =>
      `<button class="kind ${k.id}" data-kind="${k.id}" data-on="true">
         <span class="dot"></span>${k.label}
       </button>`).join("");

    kinds.querySelectorAll("[data-kind]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.kind;
        if (state.kinds.has(id)) state.kinds.delete(id);
        else state.kinds.add(id);
        b.dataset.on = String(state.kinds.has(id));
        drawField();
      });
    });

    el("search").addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      if (state.view === "moments") el("reader").innerHTML = renderMoments();
      drawField();
    });

    el("links").addEventListener("change", (e) => {
      state.showLinks = e.target.checked;
      drawField();
    });

    el("reset").addEventListener("click", () => {
      state.window = { t0: T0, t1: T1 };
      drawField();
    });

    document.querySelectorAll(".viewswitch button").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view)));

    el("play").addEventListener("click", startStory);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { endStory(); select(null); }
      if (state.story && e.key === "ArrowRight" &&
          state.story.step < chapters.length - 1) {
        state.story.step++; playStep();
      }
      if (state.story && e.key === "ArrowLeft" && state.story.step > 0) {
        state.story.step--; playStep();
      }
    });
  }

  /** The three shortcuts in the empty rail. */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    const kind = b.dataset.jump;
    let target;
    if (kind === "loop") {
      target = receipts.filter((r) => r.loop).sort((a, b2) => b2.loop - a.loop)[0];
    } else if (kind === "last") {
      target = receipts[receipts.length - 1];
    } else {
      const best = DATA.moments.slice().sort((a, b2) => b2.n - a.n)[0];
      target = byId.get(best.members[0]);
    }
    const day = 1000 * 60 * 60 * 24;
    state.window = { t0: target.ms - day * 30, t1: target.ms + day * 30 };
    select(target.id);
  });

  window.addEventListener("resize", () => {
    if (state.view === "field") resizeCanvas();
  });

  el("spanlabel").textContent =
    `${fmtDate(DATA.meta.span[0])} – ${fmtDate(DATA.meta.span[1])} · ` +
    `${DATA.meta.receipts.toLocaleString("en-IN")} receipts · ` +
    `${DATA.meta.threads.toLocaleString("en-IN")} threads`;

  buildControls();
  setView("field");
  renderRail();
  resizeCanvas();
})();
