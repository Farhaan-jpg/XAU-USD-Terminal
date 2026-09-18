class TTLCache {
  #m = new Map();

  get(key) {
    const e = this.#m.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) {
      this.#m.delete(key);
      return null;
    }
    return e.val;
  }

  set(key, val, ttlMs) {
    if (!ttlMs || ttlMs <= 0) return;
    this.#m.set(key, { val, exp: Date.now() + ttlMs });
  }

  remove(key) {
    this.#m.delete(key);
  }

  clear() {
    this.#m.clear();
  }
}

export default new TTLCache();