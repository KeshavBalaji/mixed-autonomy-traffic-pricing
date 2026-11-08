// Simplified version of the paper's model (parallel roads, mixed autonomy, selfish humans, logit riders)
// Units: seconds, meters, cars/second internally.

const CAR = 5, GAP = 2, T_H = 2, T_A = 1; // car length, min gap, headways (paper's implementation details)

function makeRoad(r) {
  const d = r.km * 1000, v = r.kmh / 3.6, b = r.lanes;
  return {
    ...r, d, v, b,
    a: d / v,                  // free-flow time (s)
    hh: CAR + GAP + v * T_H,   // space per human car at speed (m)
    ha: CAR + GAP + v * T_A,   // space per AV at speed (m)
    nbar: b / (CAR + GAP),     // jam density (cars/m)
  };
}

// Capacity check: fa*ha + fh*hh <= v*b  (equivalent to f <= Fbar(alpha))
function humanRoomFree(r, fa, hh) {
  return Math.max(0, (r.v * r.b - fa * r.ha) / hh);
}

// Human flow that makes a congested road take exactly L seconds (from Eq. 3), given AV flow fa
function humansAtLatency(r, L, fa, hh) {
  const delta = (L - r.a) * r.v * r.b / (r.d * r.nbar);
  return (r.v * r.b - fa * (r.ha + delta)) / (hh + delta);
}

// Best selfish equilibrium for humans given fixed AV flows (Theorem 1 style scan).
// hhOverride lets us model a mixed selfish population for the baseline.
function humanEquilibrium(roads, fa, lamH, hhOverride) {
  const n = roads.length;
  for (let k = 0; k < n; k++) {
    const L = roads[k].a;
    let S = 0, ok = true;
    const fh = new Array(n).fill(0);
    for (let i = 0; i < k; i++) {
      const g = humansAtLatency(roads[i], L, fa[i], hhOverride ?? roads[i].hh);
      if (g < 0) { ok = false; break; }
      fh[i] = g; S += g;
    }
    if (!ok) continue;
    const room = humanRoomFree(roads[k], fa[k], hhOverride ?? roads[k].hh);
    if (lamH <= S + room + 1e-9) {
      fh[k] = Math.max(0, lamH - S);
      const lat = roads.map((r, i) => (i < k ? L : r.a));
      return { fh, lat, k, L, feasible: true };
    }
  }
  return { feasible: false };
}

// Rider population: value of time ($/min) lognormal around a median
function makeRiders(medianVOT, n = 80, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const out = [];
  for (let j = 0; j < n; j++) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(medianVOT * Math.exp(0.6 * z));
  }
  return out;
}

// Logit choice shares: options = roads + walk (last index)
function choiceShares(latSec, prices, walkMin, riders) {
  const n = latSec.length;
  const q = new Array(n + 1).fill(0);
  for (const vot of riders) {
    const r = latSec.map((t, i) => -(vot * t / 60 + prices[i]));
    r.push(-(vot * walkMin));
    const m = Math.max(...r);
    const e = r.map(x => Math.exp(x - m));
    const Z = e.reduce((A, B) => A + B, 0);
    e.forEach((x, i) => (q[i] += x / Z / riders.length));
  }
  return q;
}

function simulate(sc, prices, riders) {
  const roads = sc.roads;
  const n = roads.length;
  const lamH = sc.humans / 60, lamA = sc.avs / 60;
  let lat = roads.map(r => r.a);
  let q = choiceShares(lat, prices, sc.walkMin, riders);
  let res = null, fa = null, turnedAway = 0;
  for (let it = 0; it < 160; it++) {
    fa = q.slice(0, n).map(x => x * lamA);
    turnedAway = 0;
    fa = fa.map((f, i) => {
      const cap = 0.995 * roads[i].v * roads[i].b / roads[i].ha;
      if (f > cap) { turnedAway += f - cap; return cap; }
      return f;
    });
    res = humanEquilibrium(roads, fa, lamH);
    if (!res.feasible) break;
    lat = res.lat;
    const qn = choiceShares(lat, prices, sc.walkMin, riders);
    q = q.map((x, i) => x + 0.25 * (qn[i] - x));
  }
  if (!res || !res.feasible) return { feasible: false };
  const served = fa.reduce((A, B) => A + B, 0);
  let num = 0, den = 0;
  roads.forEach((r, i) => { const f = res.fh[i] + fa[i]; num += f * res.lat[i]; den += f; });
  const avg = den > 0 ? num / den : 0;
  // Baseline: everyone (humans + same served riders) selfish
  const tot = lamH + served;
  const beta = tot > 0 ? served / tot : 0;
  // mixed population: per-road space per car blends human/AV
  let baseL = null;
  {
    const mixRoads = roads.map(r => ({ ...r, hh: beta * r.ha + (1 - beta) * r.hh }));
    const b2 = humanEquilibrium(mixRoads, new Array(n).fill(0), tot);
    baseL = b2.feasible ? b2.L : null;
  }
  const FUEL = 0.06; // $/km, paper: c = 6e-5 USD/m
  const profit = fa.reduce((A, f, i) => A + f * (prices[i] - roads[i].km * FUEL), 0) * 60; // $/min
  return {
    feasible: true, profit,
    fh: res.fh, fa, lat: res.lat, k: res.k,
    avg, served, servedShare: lamA > 0 ? served / lamA : 0,
    walkShare: q[n], turnedAway,
    baseline: baseL,
  };
}

function objective(out, theta) {
  if (!out.feasible || out.profit < -1e-9) return Infinity;
  return out.avg / 60 - theta * out.servedShare;
}

function optimize(sc, riders, theta, start) {
  const n = sc.roads.length;
  const evalP = p => objective(simulate(sc, p, riders), theta);
  const seeds = [start, new Array(n).fill(2), new Array(n).fill(8), sc.roads.map((_, i) => 10 - 4 * i)];
  let best = null, bestJ = Infinity;
  for (const s0 of seeds) {
    let p = s0.map(x => Math.min(20, Math.max(0, x)));
    let J = evalP(p);
    for (const step of [4, 2, 1, 0.5, 0.25]) {
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < n; i++) {
          for (const dir of [-1, 1]) {
            const t = p.slice(); t[i] = Math.min(20, Math.max(0, t[i] + dir * step));
            const Jt = evalP(t);
            if (Jt < J - 1e-6) { p = t; J = Jt; improved = true; }
          }
        }
      }
    }
    if (J < bestJ) { bestJ = J; best = p; }
  }
  return best;
}
