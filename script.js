(() => {
  "use strict";

  /* ---------- editable configuration ---------- */
  const SITE = {
    author: "@Gleb Sheykhetov",
    credentials: "",            // optional; leave empty to omit the row
  };
  const SECTIONS = [
    { hash: "home",       label: "Home" },
    { hash: "what-is-ai", label: "What Is AI?" },
    { hash: "benefits",   label: "Benefits & Applications" },
    { hash: "risks",      label: "Risks & Challenges" },
    { hash: "futures",    label: "Possible Futures" },
    { hash: "sources",    label: "Sources" },
    { hash: "making-of",  label: "How This Website Was Made" },
    { hash: "surprise-for-adrian", label: "Surprise for ADRIAN", emphasis: "ADRIAN", accent: "pink" },
  ];
  const STORE_FX = "ai-essay.effects", STORE_MOTION = "ai-essay.motion";

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const root = document.documentElement;
  if (!root.lang) root.lang = "en";
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const desktopMQ = window.matchMedia("(min-width: 900px) and (min-height: 620px)");
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isDesktop = () => desktopMQ.matches;

  /* ---------- credentials row (only if configured) ---------- */
  if (SITE.credentials && SITE.credentials.trim()) {
    const p = document.createElement("p");
    p.className = "credentials";
    p.textContent = SITE.credentials.trim();
    document.querySelector(".byline").after(p);
  }

  /* ---------- elements ---------- */
  const panel = $("panel"), track = $("track"), wheel = $("wheel");
  const prevBtn = $("prev"), nextBtn = $("next");
  const mselect = $("mselect"), mprev = $("mprev"), mnext = $("mnext"), mpos = $("mpos");
  const selPos = $("sel-pos"), stripL = $("strip-l"), stripR = $("strip-r"), segs = $("segs");
  const announce = $("announce");
  const secEls = SECTIONS.map((s) => $("sec-" + s.hash));
  const LAST = SECTIONS.length - 1;
  const SOURCES_IDX = SECTIONS.findIndex((s) => s.hash === "sources");

  // label text, with an optional emphasised word (built as text nodes, never as HTML)
  function setLabel(target, s) {
    const at = s.emphasis ? s.label.lastIndexOf(s.emphasis) : -1;
    if (at < 0) { target.textContent = s.label; return; }
    target.append(s.label.slice(0, at));
    const em = document.createElement("span");
    em.className = "em";
    em.textContent = s.emphasis;
    target.append(em, s.label.slice(at + s.emphasis.length));
  }

  /* build the wheel, segments and mobile options.
     The wheel holds three copies of the list so it can loop. Only the middle copy is real:
     seven focusable tabs. The copies above and below are visual clones, hidden from
     assistive technology and left out of keyboard navigation. */
  const N = SECTIONS.length, MID = N, VMAX = 3 * N - 1;
  const nodes = [];   // all 3×N wheel items, in visual order
  const tabs = [];    // the seven real tabs
  for (let copy = 0; copy < 3; copy++) {
    SECTIONS.forEach((s, i) => {
      const real = copy === 1;
      const el = document.createElement(real ? "button" : "div");
      el.className = (real ? "tab" : "tab clone") + (s.accent === "pink" ? " tab--pink" : "");
      el.dataset.idx = String(i);
      el.dataset.v = String(copy * N + i);
      el.innerHTML = '<span class="tn" aria-hidden="true">' + pad(i + 1) + '</span><span class="tl"></span><span class="ti" aria-hidden="true">◀</span>';
      setLabel(el.querySelector(".tl"), s);
      if (real) {
        el.type = "button";
        el.id = "tab-" + s.hash;
        el.setAttribute("role", "tab");
        el.setAttribute("aria-controls", "panel");
        el.setAttribute("aria-selected", "false");
        el.tabIndex = -1;
        tabs.push(el);
      } else {
        el.setAttribute("aria-hidden", "true");
      }
      nodes.push(el);
      track.appendChild(el);
    });
  }
  SECTIONS.forEach((s, i) => {
    const seg = document.createElement("i");
    if (s.accent) seg.className = s.accent;
    segs.appendChild(seg);
    const o = document.createElement("option");
    if (s.accent) o.className = s.accent;
    o.value = String(i);
    o.textContent = s.label;   // the position (e.g. 08 / 08) is shown beside the label above
    mselect.appendChild(o);
  });
  const segEls = Array.from(segs.children);
  track.addEventListener("click", (e) => {
    const el = e.target.closest(".tab");
    if (!el || !track.contains(el)) return;
    select(+el.dataset.idx, { source: "click", virt: +el.dataset.v });
  });

  /* ---------- state ---------- */
  let cur = -1;
  let center = MID;          // index into nodes[] that the wheel is centred on
  let normTimer = 0;
  const positions = new Array(SECTIONS.length).fill(undefined);
  let returnCtx = null;
  let wheelPushTimer = 0;
  const wrap = (i) => ((i % N) + N) % N;

  const scrollerTop = () => (isDesktop() ? panel.scrollTop : window.scrollY);
  const articleDocTop = () => {
    const r = $("article").getBoundingClientRect();
    return Math.max(0, r.top + window.scrollY - (parseFloat(getComputedStyle(root).getPropertyValue("--mnav-h")) || 0) - 4);
  };
  function setScroll(y) {
    if (isDesktop()) { panel.scrollTop = y; }
    else { window.scrollTo(0, y); }
  }

  function indexFromHash(h) {
    const key = (h || "").replace(/^#/, "");
    if (!key) return 0;
    const i = SECTIONS.findIndex((s) => s.hash === key);
    return i;
  }

  function commitHash(source) {
    if (source === "pop" || source === "init") return;
    const push = () => {
      const h = "#" + SECTIONS[cur].hash;
      if (location.hash === h) return;
      try { history.pushState(null, "", h); } catch (e) { location.hash = h; }
    };
    clearTimeout(wheelPushTimer);
    if (source === "wheel") wheelPushTimer = setTimeout(push, 450);
    else push();
  }

  /* ---------- core selection (wraps: 07 → 01 and 01 → 07) ---------- */
  function select(i, opts) {
    opts = opts || {};
    i = wrap(i);
    if (i === cur && !opts.force) { commitHash(opts.source); return false; }
    const prev = cur;
    if (prev >= 0) positions[prev] = scrollerTop();
    cur = i;

    secEls.forEach((el, k) => { el.hidden = k !== cur; });
    tabs.forEach((t, k) => {
      t.setAttribute("aria-selected", k === cur ? "true" : "false");
      t.tabIndex = k === cur ? 0 : -1;
    });
    nodes.forEach((el) => el.classList.toggle("is-current", +el.dataset.idx === cur));
    segEls.forEach((s, k) => s.classList.toggle("on", k === cur));
    panel.setAttribute("aria-labelledby", tabs[cur].id);
    const posTxt = pad(cur + 1) + " / " + pad(N);
    selPos.textContent = posTxt;
    mpos.textContent = posTxt;
    stripR.textContent = "SEC " + posTxt;
    $("strip-name").textContent = SECTIONS[cur].label.toUpperCase();
    mselect.value = String(cur);
    mselect.classList.toggle("pink", SECTIONS[cur].accent === "pink");

    if (opts.source !== "cite") { clearTarget(); $("return-bar").hidden = true; returnCtx = null; }

    // scroll: explicit target, saved position, or top of the article
    if (typeof opts.scrollTo === "number") setScroll(opts.scrollTo);
    else if (positions[cur] !== undefined) setScroll(positions[cur]);
    else setScroll(isDesktop() ? 0 : Math.min(window.scrollY, articleDocTop()));

    if (cur === SURPRISE_IDX) { if (prev !== SURPRISE_IDX) confetti.start(); }
    else confetti.stop();

    if (typeof opts.virt === "number") setCenter(opts.virt);
    else moveCenter(prev, cur, opts.dir || 0);
    commitHash(opts.source);
    if (opts.source === "wheel" || opts.source === "pop" || opts.source === "return") {
      announce.textContent = "Section: " + SECTIONS[cur].label;
    }
    return true;
  }

  /* ---------- confetti: one 3 s shower each time the surprise section is entered ---------- */
  const SURPRISE_IDX = SECTIONS.findIndex((s) => s.hash === "surprise-for-adrian");
  const confetti = (() => {
    const DURATION = 3000, FADE = 600, COUNT = 110;
    const COLORS = ["#FFD400", "#FF8A24", "#58B8FF", "#FF7EDB", "#B65CFF"];
    let run = null;   // { canvas, raf }
    function stop() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      run.canvas.remove();
      run = null;
    }
    function start() {
      stop();
      if (!animated()) return;
      const canvas = document.createElement("canvas");
      canvas.className = "confetti";
      canvas.setAttribute("aria-hidden", "true");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth, H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      const parts = [];
      for (let k = 0; k < COUNT; k++) {
        const sq = Math.random() < 0.5, s = 5 + Math.random() * 6;
        parts.push({
          x: Math.random() * W, y: -20 - Math.random() * H * 0.55,
          w: sq ? s : s * 1.8, h: sq ? s : s * 0.8,
          vx: (Math.random() - 0.5) * 60, vy: 170 + Math.random() * 170,      // px per second
          sway: 18 + Math.random() * 30, phase: Math.random() * 6.28,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 7,
          c: COLORS[k % COLORS.length],
        });
      }
      const t0 = performance.now();
      let last = t0;
      run = { canvas, raf: 0 };
      run.canvas.dataset.started = String(Math.round(t0));
      const frame = (now) => {
        if (!run || run.canvas !== canvas) return;
        const t = now - t0, dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (t >= DURATION) { stop(); return; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = t > DURATION - FADE ? Math.max(0, (DURATION - t) / FADE) : 1;
        for (const p of parts) {
          p.y += p.vy * dt;
          p.x += (p.vx + Math.sin(p.phase + t / 400) * p.sway) * dt;
          p.rot += p.vr * dt;
          if (p.y > H + 20) continue;
          ctx.save();
          ctx.translate(Math.round(p.x), Math.round(p.y));
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.rot * 1.3));          // flip as it tumbles
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        run.raf = requestAnimationFrame(frame);
      };
      run.raf = requestAnimationFrame(frame);
    }
    return { start, stop, active: () => !!run };
  })();

  /* ---------- wheel layout ---------- */
  const animated = () => motionOn && !reduceMQ.matches;
  function nearestVirt(i) {
    let best = MID + i;
    for (const v of [i, MID + i, 2 * N + i]) if (Math.abs(v - center) < Math.abs(best - center)) best = v;
    return best;
  }
  // Step one item in a direction so 07 → 01 moves forward onto the clone of 01;
  // other jumps take the shortest way round.
  function moveCenter(fromIdx, toIdx, dir) {
    if (dir && wrap(center) === fromIdx) {
      let base = center;
      if (base + dir < 0 || base + dir > VMAX) { base = MID + wrap(base); center = base; layoutWheel(false); }
      setCenter(base + dir);
    } else if (wrap(center) !== toIdx) {
      setCenter(nearestVirt(toIdx));
    } else {
      layoutWheel(false);
    }
  }
  // Animate to v; if v is on a clone, silently swap to the identical real item afterwards.
  function setCenter(v) {
    center = Math.max(0, Math.min(VMAX, v));
    clearTimeout(normTimer);
    layoutWheel(animated());
    const real = MID + wrap(center);
    if (real === center) return;
    const snap = () => { center = real; layoutWheel(false); };
    if (animated()) normTimer = setTimeout(snap, 260); else snap();
  }
  function layoutWheel(animate) {
    if (cur < 0) return;
    nodes.forEach((el, j) => el.style.setProperty("--d", String(Math.min(4, Math.abs(j - center)))));
    const vpH = wheel.clientHeight;
    if (!vpH) return;
    const item = nodes[center];
    const y = vpH / 2 - (item.offsetTop + item.offsetHeight / 2);
    if (!animate) track.classList.add("snap");
    track.style.transform = "translateY(" + Math.round(y) + "px)";
    if (!animate) { void track.offsetHeight; track.classList.remove("snap"); }
  }

  /* ---------- tab keyboard (roving tabindex, manual activation, wrapping focus) ---------- */
  track.addEventListener("keydown", (e) => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0) return;
    let to = null, dir = 0;
    if (e.key === "ArrowDown") { to = wrap(k + 1); dir = 1; }
    else if (e.key === "ArrowUp") { to = wrap(k - 1); dir = -1; }
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = N - 1;
    if (to === null) return;
    e.preventDefault();
    tabs.forEach((t, j) => { t.tabIndex = j === to ? 0 : -1; });
    tabs[to].focus({ preventScroll: true });
    moveCenter(k, to, dir);
  });
  track.addEventListener("focusout", (e) => {
    if (track.contains(e.relatedTarget)) return;
    tabs.forEach((t, j) => { t.tabIndex = j === cur ? 0 : -1; });
    moveCenter(-1, cur, 0);
  });

  /* ---------- prev / next (wrap around) ---------- */
  prevBtn.addEventListener("click", () => select(cur - 1, { source: "click", dir: -1 }));
  nextBtn.addEventListener("click", () => select(cur + 1, { source: "click", dir: 1 }));
  mprev.addEventListener("click", () => select(cur - 1, { source: "click", dir: -1 }));
  mnext.addEventListener("click", () => select(cur + 1, { source: "click", dir: 1 }));
  mselect.addEventListener("change", () => select(parseInt(mselect.value, 10), { source: "click" }));

  /* ---------- localized wheel input over the selector ---------- */
  let acc = 0, lastEvt = 0, lastStep = 0, locked = false;
  wheel.parentElement.addEventListener("wheel", (e) => {
    if (!isDesktop()) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 18; else if (e.deltaMode === 2) dy *= wheel.clientHeight;
    if (Math.abs(dy) <= Math.abs(e.deltaX)) return;
    const dir = dy > 0 ? 1 : -1;
    e.preventDefault();
    const now = performance.now();
    // a pause in input, or enough time, ends the previous gesture
    if (locked && (now - lastEvt > 160 || now - lastStep > 650)) locked = false;
    lastEvt = now;
    if (locked) return;
    if (acc !== 0 && Math.sign(acc) !== dir) acc = 0;
    acc += dy;
    if (Math.abs(acc) >= 40) {
      acc = 0; lastStep = now; locked = true;
      select(cur + dir, { source: "wheel", dir });
    }
  }, { passive: false });

  /* ---------- in-article navigation links ---------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-goto]");
    if (!a) return;
    const i = SECTIONS.findIndex((s) => s.hash === a.dataset.goto);
    if (i < 0) return;
    e.preventDefault();
    select(i, { source: "link" });
    const h = secEls[i].querySelector(".sec-title");
    if (h) h.focus({ preventScroll: true });
  });

  /* ---------- citations → sources, with return ---------- */
  function scrollToRow(row) {
    const bar = $("return-bar");
    const barH = bar.hidden ? 0 : bar.offsetHeight + 16;
    if (isDesktop()) {
      const delta = row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.scrollTop = Math.max(0, panel.scrollTop + delta - barH - 12);
    } else {
      const mh = parseFloat(getComputedStyle(root).getPropertyValue("--mnav-h")) || 0;
      window.scrollTo(0, Math.max(0, row.getBoundingClientRect().top + window.scrollY - mh - barH - 12));
    }
  }
  function clearTarget() { document.querySelectorAll(".src-row.is-target").forEach((r) => r.classList.remove("is-target")); }
  panel.addEventListener("click", (e) => {
    const a = e.target.closest("a.cite");
    if (!a) return;
    e.preventDefault();
    const n = a.dataset.src;
    const row = $("src-" + n);
    if (!row) return;
    const fromIdx = cur;
    const fromScroll = scrollerTop();
    if (fromIdx !== SOURCES_IDX) returnCtx = { index: fromIdx, scroll: fromScroll, linkId: a.id };
    select(SOURCES_IDX, { source: "cite", scrollTo: positions[SOURCES_IDX] || 0 });
    clearTarget();
    row.classList.add("is-target");
    if (returnCtx) {
      $("return-bar").hidden = false;
      $("return-text").textContent = "You came from " + SECTIONS[returnCtx.index].label + ". Showing source " + n + ".";
    }
    scrollToRow(row);
    row.focus({ preventScroll: true });
  });
  $("return-btn").addEventListener("click", () => {
    if (!returnCtx) return;
    const ctx = returnCtx;
    returnCtx = null;
    $("return-bar").hidden = true;
    clearTarget();
    select(ctx.index, { source: "return", scrollTo: ctx.scroll });
    const link = $(ctx.linkId);
    if (link) link.focus({ preventScroll: true });
  });

  /* ---------- skip link: focus the article without touching the section hash ---------- */
  document.querySelector(".skip").addEventListener("click", (e) => {
    e.preventDefault();
    if (!isDesktop()) window.scrollTo(0, articleDocTop());
    panel.focus({ preventScroll: isDesktop() });
  });

  /* ---------- history ---------- */
  function onHistory() {
    clearTimeout(wheelPushTimer);
    let i = indexFromHash(location.hash);
    if (i < 0) i = 0;
    if (i !== cur) select(i, { source: "pop" });
  }
  window.addEventListener("popstate", onHistory);
  window.addEventListener("hashchange", onHistory);
  try { history.scrollRestoration = "manual"; } catch (e) { /* not supported */ }

  /* ---------- settings: effects + motion ---------- */
  const fxBtn = $("fx-toggle"), moBtn = $("motion-toggle");
  function setToggle(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.querySelector(".state").textContent = on ? "ON" : "OFF";
  }
  let fxOn = store.get(STORE_FX) !== "off";
  const storedMotion = store.get(STORE_MOTION);
  let motionOn = storedMotion ? storedMotion === "on" : !reduceMQ.matches;
  function applySettings() {
    root.classList.toggle("fx-off", !fxOn);
    root.classList.toggle("motion-off", !motionOn);
    setToggle(fxBtn, fxOn);
    setToggle(moBtn, motionOn);
    sphere.update();
    if (!animated()) confetti.stop();
  }
  fxBtn.addEventListener("click", () => { fxOn = !fxOn; store.set(STORE_FX, fxOn ? "on" : "off"); applySettings(); });
  moBtn.addEventListener("click", () => { motionOn = !motionOn; store.set(STORE_MOTION, motionOn ? "on" : "off"); applySettings(); });
  reduceMQ.addEventListener("change", () => {
    if (!store.get(STORE_MOTION)) motionOn = !reduceMQ.matches;
    applySettings();
  });

  /* ---------- wireframe sphere (canvas, projected 3D) ---------- */
  const sphere = (() => {
    const canvas = $("sphere");
    const ctx = canvas.getContext("2d");
    const PERIOD = 32000;              // ms per revolution
    const TILT = 0.42, ROLL = -0.22;   // axis tilt (rad)
    const ct = Math.cos(TILT), st = Math.sin(TILT), cr = Math.cos(ROLL), sr = Math.sin(ROLL);
    const D = Math.PI / 180;
    const lines = [];
    for (let lat = -75; lat <= 75; lat += 25) {          // parallels
      const pts = []; for (let lon = 0; lon <= 360; lon += 6) pts.push([lat * D, lon * D]); lines.push(pts);
    }
    for (let lon = 0; lon < 360; lon += 30) {            // meridians
      const pts = []; for (let lat = -90; lat <= 90; lat += 6) pts.push([lat * D, lon * D]); lines.push(pts);
    }
    let size = 0, dpr = 1, raf = 0, last = 0, angle = 0.6, running = false;

    function project(lat, lon, rot) {
      const x0 = Math.cos(lat) * Math.cos(lon + rot);
      const y0 = Math.sin(lat);
      const z0 = Math.cos(lat) * Math.sin(lon + rot);
      const y1 = y0 * ct - z0 * st, z1 = y0 * st + z0 * ct;
      const x2 = x0 * cr - y1 * sr, y2 = x0 * sr + y1 * cr;
      return [x2, y2, z1];
    }
    function draw() {
      if (!size) return;
      const W = size * dpr, R = (size / 2 - 3) * dpr, c = W / 2;
      ctx.clearRect(0, 0, W, W);
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, dpr * 0.9);
      const buckets = [[], [], [], [], []];
      for (const pts of lines) {
        let p = project(pts[0][0], pts[0][1], angle);
        for (let k = 1; k < pts.length; k++) {
          const q = project(pts[k][0], pts[k][1], angle);
          const z = (p[2] + q[2]) / 2;                    // -1 back … 1 front
          const b = Math.min(4, Math.max(0, Math.floor((z + 1) / 2 * 5)));
          buckets[b].push(c + p[0] * R, c - p[1] * R, c + q[0] * R, c - q[1] * R);
          p = q;
        }
      }
      const alphas = [0.13, 0.22, 0.4, 0.68, 0.98];
      buckets.forEach((segs, b) => {
        ctx.strokeStyle = "rgba(255,212,0," + alphas[b] + ")";
        ctx.beginPath();
        for (let k = 0; k < segs.length; k += 4) { ctx.moveTo(segs[k], segs[k + 1]); ctx.lineTo(segs[k + 2], segs[k + 3]); }
        ctx.stroke();
      });
      ctx.strokeStyle = "rgba(255,212,0,0.55)";
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    }
    function frame(t) {
      if (!running) return;
      if (t - last >= 33) {               // ~30 fps is plenty for a slow rotation
        const dt = last ? Math.min(t - last, 100) : 0;
        last = t;
        angle = (angle + dt / PERIOD * Math.PI * 2) % (Math.PI * 2);
        draw();
      }
      raf = requestAnimationFrame(frame);
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      const s = Math.round(Math.min(r.width, r.height));
      const d = Math.min(window.devicePixelRatio || 1, 2);
      if (s === size && d === dpr) return;
      size = s; dpr = d;
      canvas.width = Math.max(1, Math.round(s * d));
      canvas.height = canvas.width;
      draw();
    }
    function update() {
      const want = motionOn && !document.hidden && size > 0;
      if (want && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
      else if (!want && running) { running = false; cancelAnimationFrame(raf); draw(); }
      else if (!want) draw();
    }
    if ("ResizeObserver" in window) new ResizeObserver(() => { resize(); update(); }).observe(canvas);
    window.addEventListener("resize", () => { resize(); update(); });
    document.addEventListener("visibilitychange", update);
    return { resize, update };
  })();

  /* ---------- sticky offset for flow layout ---------- */
  const mnav = $("mobile-nav");
  function syncLayout() {
    const sticky = !isDesktop() && getComputedStyle(mnav).position === "sticky";
    root.style.setProperty("--mnav-h", sticky ? mnav.offsetHeight + "px" : "0px");
    layoutWheel(false);
  }
  if ("ResizeObserver" in window) {
    new ResizeObserver(syncLayout).observe(mnav);
    new ResizeObserver(() => layoutWheel(false)).observe(wheel);
  }
  window.addEventListener("resize", syncLayout);
  desktopMQ.addEventListener("change", syncLayout);

  /* ---------- init ---------- */
  let initial = indexFromHash(location.hash);
  if (initial < 0) {
    initial = 0;
    try { history.replaceState(null, "", "#home"); } catch (e) { /* ignore */ }
  }
  select(initial, { source: "init", force: true, scrollTo: 0 });
  applySettings();
  sphere.resize(); sphere.update();
  syncLayout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layoutWheel(false); syncLayout(); });
})();
