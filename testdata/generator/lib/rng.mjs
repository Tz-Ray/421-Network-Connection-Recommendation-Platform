// Seeded, deterministic PRNG (cyrb128 hash -> sfc32). Every consumer takes its
// own labelled stream so adding draws in one phase never shifts another phase.

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  constructor(seed, label) {
    [this.a, this.b, this.c, this.d] = cyrb128(`${seed}|${label}`);
    for (let i = 0; i < 20; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next() {
    let a = this.a >>> 0, b = this.b >>> 0, c = this.c >>> 0, d = this.d >>> 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  uniform(lo, hi) {
    return lo + this.next() * (hi - lo);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    if (!arr.length) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  normal() {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  lognormal(mu, sigma) {
    return Math.exp(mu + sigma * this.normal());
  }

  expo(mean) {
    let u = 0;
    while (u === 0) u = this.next();
    return -Math.log(u) * mean;
  }

  /** One item by weight; `weights` is an array parallel to `items` or a fn. */
  weighted(items, weights) {
    const w = typeof weights === 'function' ? items.map(weights) : weights;
    let total = 0;
    for (const x of w) total += x > 0 ? x : 0;
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      const x = w[i] > 0 ? w[i] : 0;
      if (r < x) return items[i];
      r -= x;
    }
    return items[items.length - 1];
  }

  /** Key of an object map {key: weight}, iterated in insertion order. */
  weightedKey(map) {
    const keys = Object.keys(map);
    return this.weighted(keys, keys.map((k) => map[k]));
  }

  /**
   * k items without replacement, probability proportional to weight
   * (Efraimidis-Spirakis). Returned in draw order (highest key first).
   */
  sampleWeighted(items, k, weightFn) {
    if (k <= 0) return [];
    const keyed = [];
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i]);
      if (!(w > 0)) continue;
      let u = 0;
      while (u === 0) u = this.next();
      keyed.push({ key: Math.log(u) / w, i });
    }
    keyed.sort((x, y) => (y.key - x.key) || (x.i - y.i));
    return keyed.slice(0, k).map((e) => items[e.i]);
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  hex(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }

  base64ish(n) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < n; i++) s += abc[Math.floor(this.next() * abc.length)];
    return s;
  }
}
