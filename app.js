const PRESETS = {
  shines: {
    desc: "Two short roads congest while a long road has room to spare.",
    roads: {
      3: [{ km: 4, kmh: 40, lanes: 1 }, { km: 6, kmh: 50, lanes: 1 }, { km: 14, kmh: 70, lanes: 2 }],
      4: [{ km: 4, kmh: 40, lanes: 1 }, { km: 6, kmh: 50, lanes: 1 }, { km: 9, kmh: 60, lanes: 1 }, { km: 14, kmh: 70, lanes: 2 }],
    },
    humans: 30, avs: 42, vot: 24, walkMin: 45, price: 6,
  },
  little: {
    desc: "Traffic is light, so the fastest road can carry almost everyone.",
    roads: {
      3: [{ km: 5, kmh: 50, lanes: 2 }, { km: 7, kmh: 60, lanes: 1 }, { km: 10, kmh: 70, lanes: 1 }],
      4: [{ km: 5, kmh: 50, lanes: 2 }, { km: 7, kmh: 60, lanes: 1 }, { km: 8, kmh: 60, lanes: 1 }, { km: 10, kmh: 70, lanes: 1 }],
    },
    humans: 12, avs: 12, vot: 24, walkMin: 50, price: 6,
  },
  walks: {
    desc: "Trips are short, so walking competes with paying for a ride.",
    roads: {
      3: [{ km: 1.2, kmh: 30, lanes: 1 }, { km: 1.8, kmh: 40, lanes: 1 }, { km: 2.4, kmh: 50, lanes: 1 }],
      4: [{ km: 1.2, kmh: 30, lanes: 1 }, { km: 1.8, kmh: 40, lanes: 1 }, { km: 2.1, kmh: 45, lanes: 1 }, { km: 2.4, kmh: 50, lanes: 1 }],
    },
    humans: 6, avs: 20, vot: 24, walkMin: 14, price: 8,
  },
};

const $ = id => document.getElementById(id);
const state = { preset: "shines", nroads: 3, prices: [6, 6, 6], humans: 30, avs: 42, vot: 24, theta: 5 };
let scenario, riders, out;

function buildScenario() {
  const p = PRESETS[state.preset];
  scenario = { roads: p.roads[state.nroads].map(makeRoad), humans: state.humans, avs: state.avs, walkMin: p.walkMin };
  riders = makeRiders(state.vot / 60);
}

/* ---------- Road drawing ---------- */
const NS = "http://www.w3.org/2000/svg";
const svg = $("roads");
const X0 = 70, X1 = 930;
// Arc heights per road count; 4 roads need a taller drawing so each sign clears the road above
const LAYOUT = { 3: { Y: 392, H: 430, heights: [26, 150, 290] }, 4: { Y: 432, H: 470, heights: [26, 124, 222, 320] } };
let Y = LAYOUT[3].Y, HEIGHTS = LAYOUT[3].heights;
const roadEls = [];

function arcPath(h) {
  return `M ${X0} ${Y} C ${X0 + 40} ${Y - h * 1.33}, ${X1 - 40} ${Y - h * 1.33}, ${X1} ${Y}`;
}
function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  (parent || svg).appendChild(e);
  return e;
}
function drawRoads() {
  ({ Y, heights: HEIGHTS } = LAYOUT[state.nroads]);
  svg.setAttribute("viewBox", `0 0 1000 ${LAYOUT[state.nroads].H}`);
  $("roadfield").setAttribute("aria-label", `${state.nroads === 4 ? "Four" : "Three"} parallel roads between the same start and end, with cars flowing on each`);
  svg.innerHTML = "";
  roadEls.length = 0;
  // end plazas
  el("circle", { cx: X0, cy: Y, r: 16, fill: "#2B2B2B" });
  el("circle", { cx: X1, cy: Y, r: 16, fill: "#2B2B2B" });
  const tS = el("text", { x: X0, y: Y + 34, "text-anchor": "middle", class: "map-label", "font-size": 15, "font-weight": 600 }); tS.textContent = "Start";
  const tE = el("text", { x: X1, y: Y + 34, "text-anchor": "middle", class: "map-label", "font-size": 15, "font-weight": 600 }); tE.textContent = "Downtown";
  HEIGHTS.forEach((h, i) => {
    const d = arcPath(h);
    const edge = el("path", { d, fill: "none", stroke: "#6E8B3D", "stroke-width": 30, "stroke-linecap": "round" });
    el("path", { d, fill: "none", stroke: "#353535", "stroke-width": 22, "stroke-linecap": "round" });
    el("path", { d, fill: "none", stroke: "#BDBDBD", "stroke-width": 1.6, "stroke-dasharray": "10 12", opacity: 0.75 });
    const path = el("path", { d, fill: "none", stroke: "none" });
    const g = el("g", {});
    roadEls.push({ edge, path, len: 0, dotsG: g, dots: [] });
  });
  // sign plates on top
  HEIGHTS.forEach((h, i) => {
    const mid = roadEls[i].path.getPointAtLength(roadEls[i].path.getTotalLength() / 2);
    const w = 176, hgt = 58;
    const g = el("g", { transform: `translate(${mid.x - w / 2}, ${mid.y - hgt - 22})` });
    el("rect", { width: w, height: hgt, rx: 7, fill: "#1F1E1D", stroke: "#FFFFFF", "stroke-width": 2 }, g);
    const t1 = el("text", { x: 10, y: 22, fill: "#FFFFFF", "font-size": 15, "font-weight": 600 }, g);
    const t2 = el("text", { x: 10, y: 46, fill: "#FFFFFF", "font-size": 19, "font-weight": 600 }, g);
    const t3 = el("text", { x: w - 10, y: 46, fill: "#E9B65A", "font-size": 19, "font-weight": 600, "text-anchor": "end" }, g);
    const t4 = el("text", { x: w - 10, y: 22, fill: "#C8C8C8", "font-size": 13, "font-weight": 600, "text-anchor": "end" }, g);
    Object.assign(roadEls[i], { plateName: t1, plateTime: t2, platePrice: t3, plateState: t4 });
    t1.textContent = `Road ${i + 1}`;
  });
  roadEls.forEach(r => (r.len = r.path.getTotalLength()));
}

function mix(c1, c2, t) {
  const a = c1.match(/\w\w/g).map(x => parseInt(x, 16)), b = c2.match(/\w\w/g).map(x => parseInt(x, 16));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/* ---------- Animated cars ---------- */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const JAM_SPACING_PX = 12;   // dot spacing on screen when a road is bumper-to-bumper
const PX_PER_KMH = 2;        // on-screen dot speed: 70 km/h ~ 140 px/s
let lastT = performance.now();

// Dots reflect real density: cars on road = flow x travel time; density = that / road length.
// Drawn relative to jam density, so a congested road looks packed and a quiet road looks sparse.
function targetDots(i) {
  if (!out || !out.feasible) return { n: 0, avShare: 0 };
  const r = scenario.roads[i];
  const f = out.fh[i] + out.fa[i];
  const density = f * out.lat[i] / r.d;          // cars per meter (all lanes)
  const fill = Math.min(1, density / r.nbar);    // 0 = empty, 1 = bumper-to-bumper
  const n = Math.round(fill * roadEls[i].len / JAM_SPACING_PX);
  return { n, avShare: f > 0 ? out.fa[i] / f : 0 };
}

function syncDots() {
  roadEls.forEach((r, i) => {
    const { n, avShare } = targetDots(i);
    while (r.dots.length < n) {
      const c = el("circle", { r: 5.2, stroke: "#1F1F1F", "stroke-width": 1.2 }, r.dotsG);
      r.dots.push({ c, t: Math.random(), av: Math.random() < avShare });
    }
    while (r.dots.length > n) r.dots.pop().c.remove();
    r.dots.sort((a, b) => a.t - b.t);
    const off = r.dots.length ? r.dots[0].t : 0;
    r.dots.forEach((d, k) => (d.t = (off + k / Math.max(1, n)) % 1));
    if (reduceMotion) r.dots.forEach((d, k) => (d.t = (k + 0.5) / Math.max(1, n)));
    r.dots.forEach((d, k) => (d.av = Math.floor((k + 1) * avShare + 0.5) > Math.floor(k * avShare + 0.5)));
    r.dots.forEach(d => d.c.setAttribute("fill", d.av ? "#E2A53A" : "#FFFFFF"));
    placeDots(r);
  });
}
function placeDots(r) {
  r.dots.forEach(d => {
    const p = r.path.getPointAtLength(d.t * r.len);
    d.c.setAttribute("cx", p.x.toFixed(1));
    d.c.setAttribute("cy", p.y.toFixed(1));
  });
}
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (out && out.feasible && !reduceMotion) {
    roadEls.forEach((r, i) => {
      // Dots move at the road's real speed (length / travel time), so jams visibly crawl
      const kmh = scenario.roads[i].km / (out.lat[i] / 3600);
      const step = dt * kmh * PX_PER_KMH / r.len;
      r.dots.forEach(d => { d.t += step; if (d.t > 1) d.t -= 1; });
      placeDots(r);
    });
  }
  requestAnimationFrame(frame);
}

/* ---------- Rendering ---------- */
const fmtMin = s => (s / 60).toFixed(1);
const money = x => "$" + x.toFixed(2);

function buildPriceControls() {
  const box = $("priceCtls");
  box.innerHTML = "<h3>Ride price per route</h3>";
  state.prices.forEach((p, i) => {
    const r = scenario.roads[i];
    const div = document.createElement("div");
    div.className = "ctl";
    div.innerHTML = `
      <label for="price${i}"><span class="road-tag">${i + 1}</span>Road ${i + 1}</label><output id="price${i}Out"></output>
      <input type="range" id="price${i}" min="0" max="20" step="0.25" value="${p}">
      <small>${r.km} km at ${r.kmh} km/h, ${r.lanes} lane${r.lanes > 1 ? "s" : ""}; ${fmtMin(r.a)} min when empty</small>`;
    box.appendChild(div);
    div.querySelector("input").addEventListener("input", e => {
      state.prices[i] = +e.target.value;
      $("optStatus").textContent = "";
      update();
    });
  });
}

function syncInputs() {
  state.prices.forEach((p, i) => { $("price" + i).value = p; $("price" + i + "Out").textContent = money(p); });
  $("humans").value = state.humans; $("humansOut").textContent = state.humans + " / min";
  $("avs").value = state.avs; $("avsOut").textContent = state.avs + " / min";
  $("vot").value = state.vot; $("votOut").textContent = "$" + state.vot + " / hr";
  $("theta").value = state.theta; $("thetaOut").textContent = state.theta + " min";
}

function renderRoads() {
  roadEls.forEach((r, i) => {
    r.platePrice.textContent = money(state.prices[i]);
    if (!out.feasible) { r.plateTime.textContent = "—"; r.plateState.textContent = ""; r.edge.setAttribute("stroke", "#9A9A9A"); return; }
    const lat = out.lat[i], a = scenario.roads[i].a;
    const congested = lat > a + 0.5;
    r.plateTime.textContent = fmtMin(lat) + " min";
    const sev = Math.min(1, (lat / a - 1) / 0.8);
    r.edge.setAttribute("stroke", congested ? mix("D98C74", "9E3A22", sev) : "#6E8B3D");
    r.plateState.textContent = congested ? "congested" : "flowing";
  });
}

function renderResults() {
  const box = $("results");
  if (!out.feasible) {
    box.innerHTML = `<p class="warn">Traffic can’t settle at these prices: too many riders crowd onto one road that can’t hold them alongside the human drivers. Spread the prices out, or lower the number of drivers or riders.</p>`;
    $("walkers").innerHTML = "";
    return;
  }
  const avg = out.avg, base = out.baseline;
  const served = out.served * 60, want = state.avs;
  const walking = Math.max(0, want - served);
  let deltaHtml = "", baseRow = "";
  const maxV = Math.max(avg, base || 0) * 1.08 || 1;
  if (base) {
    const pct = (base - avg) / base * 100;
    if (Math.abs(pct) < 0.5) deltaHtml = `<span class="delta">same as everyone taking the fastest road</span>`;
    else if (pct > 0) deltaHtml = `<span class="delta good">${pct.toFixed(0)}% faster than selfish routing</span>`;
    else deltaHtml = `<span class="delta bad">${(-pct).toFixed(0)}% slower than selfish routing</span>`;
    baseRow = `<div class="bar-row"><span>Everyone takes the fastest road</span><div class="bar"><i style="width:${base / maxV * 100}%;background:var(--muted)"></i></div><b>${fmtMin(base)} min</b></div>`;
  } else {
    baseRow = `<div class="bar-row"><span>Selfish baseline</span><span>can’t fit this many cars</span><b></b></div>`;
  }
  box.innerHTML = `
    <div class="headline"><span class="big">${fmtMin(avg)} min</span>${deltaHtml}</div>
    <div class="bars">
      <div class="bar-row"><span>With your prices</span><div class="bar"><i style="width:${avg / maxV * 100}%;background:var(--sign)"></i></div><b>${fmtMin(avg)} min</b></div>
      ${baseRow}
    </div>
    <dl class="stats">
      <dt>Riders served</dt><dd>${served.toFixed(0)} of ${want} / min</dd>
      <dt>Walking instead</dt><dd>${walking.toFixed(0)} / min</dd>
      <dt>Ride service profit after fuel</dt><dd>${out.profit < 0 ? "−" : ""}${money(Math.abs(out.profit))} / min</dd>
    </dl>`;
  $("walkers").innerHTML = walking >= 0.5 ? `<strong>${walking.toFixed(0)}</strong> riders / min walking` : "";
}

function update() {
  buildScenario();
  out = simulate(scenario, state.prices, riders);
  syncInputs();
  renderRoads();
  renderResults();
  syncDots();
}

function loadPreset(name) {
  const p = PRESETS[name];
  Object.assign(state, { preset: name, prices: new Array(state.nroads).fill(p.price), humans: p.humans, avs: p.avs, vot: p.vot });
  $("presetDesc").textContent = p.desc;
  $("optStatus").textContent = "";
  buildScenario();
  buildPriceControls();
  roadEls.forEach(r => { r.dots.forEach(d => d.c.remove()); r.dots = []; });
  update();
}

/* ---------- Events ---------- */
$("preset").addEventListener("change", e => loadPreset(e.target.value));
$("nroads").addEventListener("change", e => { state.nroads = +e.target.value; drawRoads(); loadPreset(state.preset); });
[["humans", "humans"], ["avs", "avs"], ["vot", "vot"], ["theta", "theta"]].forEach(([id, key]) =>
  $(id).addEventListener("input", e => { state[key] = +e.target.value; if (key !== "theta") $("optStatus").textContent = ""; update(); }));

$("optBtn").addEventListener("click", () => {
  const btn = $("optBtn");
  btn.disabled = true; btn.textContent = "Optimizing…";
  $("optStatus").textContent = "";
  setTimeout(() => {
    const before = out.feasible ? out.avg : null;
    const best = optimize(scenario, riders, state.theta, state.prices);
    btn.disabled = false; btn.textContent = "Optimize prices";
    if (!best) { $("optStatus").textContent = "No prices fit these roads and the fuel-cost rule. Lower demand and try again."; return; }
    state.prices = best;
    update();
    $("optStatus").textContent = `Prices set to ${best.map(money).join(", ")} for roads 1 to ${best.length}. Served ${(out.servedShare * 100).toFixed(0)}% of riders.`;
  }, 30);
});

drawRoads();
loadPreset("shines");
requestAnimationFrame(frame);
