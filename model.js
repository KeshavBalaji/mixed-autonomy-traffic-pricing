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
  // Paper Sec. IV-A: a road no faster and no cheaper than another (and worse on one) is never chosen
  const dominated = latSec.map((ti, i) => latSec.some((tj, j) => j !== i && (
    (prices[i] > prices[j] + 0.001 && ti >= tj - 1) ||
    (prices[i] >= prices[j] - 0.001 && ti > tj + 1))));
  for (const vot of riders) {
    const r = latSec.map((t, i) => dominated[i] ? -Infinity : -(vot * t / 60 + prices[i]));
    r.push(-(vot * walkMin));
    const m = Math.max(...r);
    const e = r.map(x => Math.exp(x - m));
    const Z = e.reduce((A, B) => A + B, 0);
    e.forEach((x, i) => (q[i] += x / Z / riders.length));
  }
  return q;
}

// Direct solve of the paper's constraints (14)-(19). Roads 1..k share travel time L (humans
// use them, selfishly); roads after k run empty of humans at free-flow time. The first k
// with a solution, and the lowest L within it, is the best selfish outcome.
function solveEquilibrium(roads, prices, walkMin, riders, lamH, lamA) {
  const n = roads.length;
  for (let k = 0; k < n; k++) {
    // Everything that depends on L. Returns null if L breaks a constraint.
    const at = (L, roadKFree) => {
      const lat = roads.map((r, i) => (i <= k ? L : r.a));
      const q = choiceShares(lat, prices, walkMin, riders);
      const fa = q.slice(0, n).map(x => x * lamA);
      for (let i = k + 1; i < n; i++) if (fa[i] * roads[i].ha > roads[i].v * roads[i].b) return null; // AV capacity
      const fh = new Array(n).fill(0);
      let room = 0;
      for (let i = 0; i <= k; i++) {
        const r = roads[i];
        if (i === k && roadKFree) {
          const free = (r.v * r.b - fa[i] * r.ha) / r.hh;   // free-flow room left for humans
          if (free < 0) return null;
          fh[i] = free;
        } else {
          const g = humansAtLatency(r, L, fa[i], r.hh);
          if (g < 0) return null;
          fh[i] = g;
        }
        room += fh[i];
      }
      return { lat, q, fa, fh, room };
    };
    const done = (s, L) => ({ ...s, k, L });

    // Road k free-flowing at L = a_k: humans on roads before k are pinned; road k takes the rest.
    const ak = roads[k].a;
    const free = at(ak, true);
    if (free) {
      const before = free.room - free.fh[k];
      if (before <= lamH + 1e-12 && lamH <= free.room + 1e-12) {
        free.fh[k] = Math.max(0, lamH - before);
        return done(free, ak);
      }
    }

    // Road k congested: find L in (a_k, a_{k+1}) where the room for humans equals human demand.
    const hi = k + 1 < n ? roads[k + 1].a : ak * 10;
    const gap = L => { const s = at(L, false); return s ? s.room - lamH : NaN; };
    const STEPS = 40;
    let lo = ak, glo = gap(ak);
    for (let j = 1; j <= STEPS; j++) {
      const L = ak + (hi - ak) * j / STEPS, g = gap(L);
      if (Number.isFinite(glo) && Number.isFinite(g) && Math.sign(glo) !== Math.sign(g)) {
        let a = lo, b = L, ga = glo, ok = true;
        for (let it = 0; it < 50; it++) {
          const m = (a + b) / 2, gm = gap(m);
          if (!Number.isFinite(gm)) { ok = false; break; }
          if (Math.sign(gm) === Math.sign(ga)) { a = m; ga = gm; } else b = m;
        }
        // Accept only a true root: a sign change can also come from rider shares jumping
        // (dominance switching on), which isn't a consistent outcome.
        const s = ok && at(b, false);
        if (s && Math.abs(s.room - lamH) < 1e-6) return done(s, b);
      }
      lo = L; glo = g;
    }
  }
  return null;
}

// Best-case selfish outcome (paper's BNE1), exact. Humans and AVs both pick the fastest road,
// and we choose the best split of the AV flow. A selfish outcome sits at some L = a_k: roads
// before k congested at a_k, road k free-flowing, later roads empty (slower, so no AVs there).
// For road i <= k, each AV displaces r_i humans (r_i = AV space / human space at that time):
//   U = humans that fit (roads < k congested + road k's free room) = C - sum_{i<=k} fa_i r_i
//   B = humans needed to make roads < k congested at a_k            = C' - sum_{i<k} fa_i r_i
// A split works iff B <= lamH <= U. U and B are linear in the split, and U >= B for every split,
// so some split works iff max U >= lamH and min B <= lamH (walk between the two splits until
// B = lamH; there U >= B = lamH). Both extremes are greedy fills. Returns L (s) or null.
function selfishBaseline(roads, lamH, lamAV) {
  for (let k = 0; k < roads.length; k++) {
    const L = roads[k].a;
    const rs = roads.slice(0, k + 1).map((r, i) => {
      const delta = i < k ? (L - r.a) * r.v * r.b / (r.d * r.nbar) : 0;   // 0 on free road k
      return { i, c: r.v * r.b / (r.hh + delta), ratio: (r.ha + delta) / (r.hh + delta), cap: r.v * r.b / (r.ha + delta) };
    });
    // Greedy: place lamAV onto roads in the given order, up to each road's AV capacity
    const fill = order => {
      let left = lamAV; const fa = new Array(k + 1).fill(0);
      for (const s of order) { const x = Math.min(left, s.cap); fa[s.i] = x; left -= x; }
      return left > 1e-12 ? null : fa;
    };
    const U = fa => rs.reduce((A, s) => A + s.c - fa[s.i] * s.ratio, 0);
    const B = fa => rs.reduce((A, s) => (s.i < k ? A + s.c - fa[s.i] * s.ratio : A), 0);
    const faMaxU = fill([...rs].sort((x, y) => x.ratio - y.ratio));        // least displacement first
    if (!faMaxU || U(faMaxU) < lamH - 1e-12) continue;
    const faMinB = fill([...rs.slice(0, k)].sort((x, y) => y.ratio - x.ratio).concat(rs[k]));
    if (faMinB && B(faMinB) <= lamH + 1e-12) return L;
  }
  return null;
}

function simulate(sc, prices, riders, withBaseline = true) {
  const roads = sc.roads;
  const n = roads.length;
  const lamH = sc.humans / 60, lamA = sc.avs / 60;
  const res = solveEquilibrium(roads, prices, sc.walkMin, riders, lamH, lamA);
  if (!res) return { feasible: false };   // no consistent outcome at these prices
  const { fa, q } = res, turnedAway = 0;
  const served = fa.reduce((A, B) => A + B, 0);
  let num = 0, den = 0;
  roads.forEach((r, i) => { const f = res.fh[i] + fa[i]; num += f * res.lat[i]; den += f; });
  const avg = den > 0 ? num / den : 0;
  // Baseline: the same humans and served riders, everyone selfish (best case over AV splits)
  const baseL = withBaseline ? selfishBaseline(roads, lamH, served) : undefined;
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
  const evalP = p => objective(simulate(sc, p, riders, false), theta);
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
