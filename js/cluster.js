// 声の特徴が似ているものをまとめる（平均連結の階層クラスタリング、最近傍チェーン法）
export function cosineDist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return 1 - s;
}

// vecs: 正規化した Float32Array の配列。weights: それぞれの長さ（秒）
// 返り値: merges [{a, b, d}]（a,b は元の番号の代表）。cut() で切る。
export function linkage(vecs, weights = null) {
  const n = vecs.length;
  if (n <= 1) return { n, merges: [] };
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = cosineDist(vecs[i], vecs[j]); D[i * n + j] = d; D[j * n + i] = d; }
  const size = new Float64Array(n);
  for (let i = 0; i < n; i++) size[i] = weights ? Math.max(0.2, weights[i]) : 1;
  const active = new Uint8Array(n).fill(1);
  let activeCount = n;
  const merges = [];
  const chain = [];
  while (activeCount > 1) {
    if (!chain.length) { for (let i = 0; i < n; i++) if (active[i]) { chain.push(i); break; } }
    const a = chain[chain.length - 1];
    const prev = chain.length > 1 ? chain[chain.length - 2] : -1;
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === a || !active[j]) continue;
      const d = D[a * n + j];
      if (d < bd || (d === bd && j === prev)) { bd = d; best = j; }
    }
    if (best === prev) {
      chain.pop(); chain.pop();
      // a と prev をまとめる（a に入れる）
      const sa = size[a], sb = size[prev];
      for (let k = 0; k < n; k++) {
        if (!active[k] || k === a || k === prev) continue;
        const d = (sa * D[a * n + k] + sb * D[prev * n + k]) / (sa + sb);
        D[a * n + k] = d; D[k * n + a] = d;
      }
      size[a] = sa + sb; active[prev] = 0; activeCount--;
      merges.push({ a, b: prev, d: bd });
    } else {
      chain.push(best);
    }
  }
  merges.sort((x, y) => x.d - y.d);
  return { n, merges };
}

// しきい値または人数で切って、グループ番号（0〜）を返す
export function cut({ n, merges }, { threshold = 0.6, k = null } = {}) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  let groups = n;
  for (const m of merges) {
    if (k != null) { if (groups <= k) break; } else if (m.d > threshold) break;
    const ra = find(m.a), rb = find(m.b);
    if (ra !== rb) { parent[rb] = ra; groups--; }
  }
  const map = new Map(); const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) { const r = find(i); if (!map.has(r)) map.set(r, map.size); labels[i] = map.get(r); }
  return { labels, count: map.size };
}

export function centroids(vecs, labels, count) {
  const dim = vecs[0] ? vecs[0].length : 0;
  const cs = Array.from({ length: count }, () => new Float32Array(dim));
  for (let i = 0; i < vecs.length; i++) { const c = cs[labels[i]]; const v = vecs[i]; for (let d = 0; d < dim; d++) c[d] += v[d]; }
  for (const c of cs) { let s = 0; for (let d = 0; d < dim; d++) s += c[d] * c[d]; s = Math.sqrt(s) || 1; for (let d = 0; d < dim; d++) c[d] /= s; }
  return cs;
}
