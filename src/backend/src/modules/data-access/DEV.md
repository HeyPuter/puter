## Development for `data-access` module

This document will contain notes, documentation, and snippets written
while developing the `data-access` module replacements for what was
formerly handled by EntityStoreService and OM (Object Mapping).

### App List Test Code

This code is used to test listing apps with one of the available
CRUD-implementing drivers.

```javascript
await (async () => {
    const resp = await fetch('http://api.puter.localhost:4100/drivers/call', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${puter.authToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            args: { predicate: ['user-can-edit'] },
            driver: 'es:app',
            interface: 'puter-apps',
            method: 'select',
        }),
    })
    return (await resp.json()).result;
})();
```

### AI-Generated Compare Function

I asked an LLM to find me a javascript object compare function
that I can paste in developer tools and it started generating
one from scratch. To my surprise it worked just fine, so I'm pasting
this here for the time being for convenience:

```javascript
(() => {
  // Deep compare + diff reporter for DevTools (no deps)
  // Usage:
  //   const r = deepCompare(a, b);
  //   console.log(r.pass, r.message);
  //   r.print(); // pretty console output
  // Options:
  //   deepCompare(a,b,{ showSame:false, maxDiffs:200, sortKeys:true })

  function deepCompare(a, b, opts = {}) {
    const options = {
      showSame: false,   // include "same" entries in the diff list
      maxDiffs: 200,     // cap diffs so you don't nuke your console
      sortKeys: true,    // stable key ordering when iterating plain objects
      ...opts,
    };

    const diffs = [];
    const seenPairs = new WeakMap(); // a -> WeakMap(b -> true)

    const isObjectLike = (v) => v !== null && (typeof v === "object" || typeof v === "function");
    const tagOf = (v) => Object.prototype.toString.call(v); // "[object X]"
    const isPlainObject = (v) => {
      if (tagOf(v) !== "[object Object]") return false;
      const proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    };

    const typeLabel = (v) => {
      if (v === null) return "null";
      const t = typeof v;
      if (t !== "object") return t;
      return tagOf(v).slice(8, -1);
    };

    const formatVal = (v) => {
      // Safe-ish inline formatter for messages (keeps things short)
      try {
        if (typeof v === "string") return JSON.stringify(v.length > 120 ? v.slice(0, 117) + "…" : v);
        if (typeof v === "number" && Object.is(v, -0)) return "-0";
        if (typeof v === "bigint") return `${v}n`;
        if (typeof v === "symbol") return v.toString();
        if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
        if (v instanceof Date) return isNaN(v.getTime()) ? "Invalid Date" : `Date(${v.toISOString()})`;
        if (v instanceof RegExp) return v.toString();
        if (v instanceof Map) return `Map(${v.size})`;
        if (v instanceof Set) return `Set(${v.size})`;
        if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return `${v.constructor.name}(${v.length})`;
        if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`;
        if (v && v.constructor && v.constructor !== Object) return `${v.constructor.name}{…}`;
        if (Array.isArray(v)) return `Array(${v.length})`;
        if (isPlainObject(v)) return "Object{…}";
        return `${typeLabel(v)}{…}`;
      } catch {
        return "[Unformattable]";
      }
    };

    const pathToString = (path) => {
      if (!path.length) return "(root)";
      let s = "";
      for (const p of path) {
        if (typeof p === "number") s += `[${p}]`;
        else if (typeof p === "string") {
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) s += (s ? "." : "") + p;
          else s += `[${JSON.stringify(p)}]`;
        } else if (typeof p === "symbol") s += `[${p.toString()}]`;
        else s += `[${String(p)}]`;
      }
      return s;
    };

    const pushDiff = (kind, path, left, right, extra) => {
      if (diffs.length >= options.maxDiffs) return;
      diffs.push({
        kind, // "type" | "value" | "missing-left" | "missing-right" | "prototype" | "keys" | ...
        path: [...path],
        left,
        right,
        extra,
      });
    };

    const markSeen = (x, y) => {
      if (!isObjectLike(x) || !isObjectLike(y)) return false;
      let inner = seenPairs.get(x);
      if (!inner) {
        inner = new WeakMap();
        seenPairs.set(x, inner);
      }
      if (inner.get(y)) return true;
      inner.set(y, true);
      return false;
    };

    const sameValueZero = (x, y) => Object.is(x, y); // handles NaN, -0

    const compareArrays = (x, y, path) => {
      if (x.length !== y.length) pushDiff("value", [...path, "length"], x.length, y.length, "array length mismatch");
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) {
        if (i >= x.length) pushDiff("missing-left", [...path, i], undefined, y[i], "missing index in left");
        else if (i >= y.length) pushDiff("missing-right", [...path, i], x[i], undefined, "missing index in right");
        else walk(x[i], y[i], [...path, i]);
        if (diffs.length >= options.maxDiffs) return;
      }
    };

    const compareTypedArrays = (x, y, path) => {
      if (x.constructor !== y.constructor) {
        pushDiff("type", path, x.constructor?.name, y.constructor?.name, "typed array class mismatch");
        return;
      }
      if (x.length !== y.length) pushDiff("value", [...path, "length"], x.length, y.length, "typed array length mismatch");
      const n = Math.min(x.length, y.length);
      for (let i = 0; i < n; i++) {
        if (!sameValueZero(x[i], y[i])) pushDiff("value", [...path, i], x[i], y[i], "typed array element mismatch");
        if (diffs.length >= options.maxDiffs) return;
      }
    };

    const compareArrayBuffer = (x, y, path) => {
      if (x.byteLength !== y.byteLength) {
        pushDiff("value", [...path, "byteLength"], x.byteLength, y.byteLength, "ArrayBuffer byteLength mismatch");
        return;
      }
      const a8 = new Uint8Array(x);
      const b8 = new Uint8Array(y);
      for (let i = 0; i < a8.length; i++) {
        if (a8[i] !== b8[i]) {
          pushDiff("value", [...path, i], a8[i], b8[i], "ArrayBuffer byte mismatch");
          if (diffs.length >= options.maxDiffs) return;
        }
      }
    };

    const compareDates = (x, y, path) => {
      const tx = x.getTime();
      const ty = y.getTime();
      if (!sameValueZero(tx, ty)) pushDiff("value", path, x, y, "Date mismatch");
    };

    const compareRegex = (x, y, path) => {
      if (x.source !== y.source || x.flags !== y.flags) pushDiff("value", path, x, y, "RegExp mismatch");
    };

    const compareMaps = (x, y, path) => {
      if (x.size !== y.size) pushDiff("value", [...path, "size"], x.size, y.size, "Map size mismatch");

      // Map key equality is identity-based; here we:
      // 1) try direct key lookup for primitive keys
      // 2) for object keys, we require the *same object reference* exists as key in the other map
      // (test frameworks do similar unless they do expensive key deep-matching)
      for (const [k, xv] of x.entries()) {
        if (!y.has(k)) {
          pushDiff("missing-right", [...path, `MapKey(${formatVal(k)})`], xv, undefined, "Map missing key on right");
          continue;
        }
        walk(xv, y.get(k), [...path, `MapKey(${formatVal(k)})`]);
        if (diffs.length >= options.maxDiffs) return;
      }

      for (const [k, yv] of y.entries()) {
        if (!x.has(k)) {
          pushDiff("missing-left", [...path, `MapKey(${formatVal(k)})`], undefined, yv, "Map missing key on left");
          if (diffs.length >= options.maxDiffs) return;
        }
      }
    };

    const compareSets = (x, y, path) => {
      if (x.size !== y.size) pushDiff("value", [...path, "size"], x.size, y.size, "Set size mismatch");

      // Same logic: membership is identity for object values.
      for (const v of x.values()) {
        if (!y.has(v)) pushDiff("missing-right", [...path, `SetVal(${formatVal(v)})`], v, undefined, "Set missing value on right");
        if (diffs.length >= options.maxDiffs) return;
      }
      for (const v of y.values()) {
        if (!x.has(v)) pushDiff("missing-left", [...path, `SetVal(${formatVal(v)})`], undefined, v, "Set missing value on left");
        if (diffs.length >= options.maxDiffs) return;
      }
    };

    const comparePlainObjects = (x, y, path) => {
      // Compare prototypes (handy when something is class instance vs plain object)
      const px = Object.getPrototypeOf(x);
      const py = Object.getPrototypeOf(y);
      if (px !== py) pushDiff("prototype", path, px?.constructor?.name || px, py?.constructor?.name || py, "Prototype mismatch");

      const keysX = Reflect.ownKeys(x);
      const keysY = Reflect.ownKeys(y);

      const norm = (ks) => {
        // Sort only string keys for stability; keep symbols in original order
        if (!options.sortKeys) return ks;
        const str = ks.filter(k => typeof k === "string").sort();
        const sym = ks.filter(k => typeof k === "symbol");
        const numLike = []; // keep numeric-looking strings in numeric order if you want; leaving out to stay simple
        // We'll just do lexical sort for strings; okay for devtools output.
        return [...str, ...sym];
      };

      const kx = norm(keysX);
      const ky = norm(keysY);

      const setY = new Set(keysY);
      const setX = new Set(keysX);

      for (const k of kx) {
        if (!setY.has(k)) {
          pushDiff("missing-right", [...path, k], x[k], undefined, "Missing property on right");
        } else {
          walk(x[k], y[k], [...path, k]);
        }
        if (diffs.length >= options.maxDiffs) return;
      }
      for (const k of ky) {
        if (!setX.has(k)) {
          pushDiff("missing-left", [...path, k], undefined, y[k], "Missing property on left");
          if (diffs.length >= options.maxDiffs) return;
        }
      }
    };

    function walk(x, y, path) {
      if (diffs.length >= options.maxDiffs) return;

      if (sameValueZero(x, y)) {
        if (options.showSame) pushDiff("same", path, x, y);
        return;
      }

      const tx = typeLabel(x);
      const ty = typeLabel(y);
      if (tx !== ty) {
        pushDiff("type", path, tx, ty, "Type mismatch");
        return;
      }

      // Circular / repeated references
      if (markSeen(x, y)) return;

      // Per-type comparisons
      if (Array.isArray(x)) return compareArrays(x, y, path);

      if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return compareTypedArrays(x, y, path);
      if (x instanceof ArrayBuffer) return compareArrayBuffer(x, y, path);

      if (x instanceof Date) return compareDates(x, y, path);
      if (x instanceof RegExp) return compareRegex(x, y, path);
      if (x instanceof Map) return compareMaps(x, y, path);
      if (x instanceof Set) return compareSets(x, y, path);

      // Functions: compare by reference already failed; treat as value mismatch
      if (typeof x === "function") {
        pushDiff("value", path, x, y, "Function reference mismatch");
        return;
      }

      // Objects (including class instances): compare own keys + nested values.
      if (isObjectLike(x)) return comparePlainObjects(x, y, path);

      // Primitives (should have been caught by Object.is earlier)
      pushDiff("value", path, x, y, "Value mismatch");
    }

    walk(a, b, []);

    const pass = diffs.length === 0;

    const message = pass
      ? "✅ Values are deeply equal."
      : buildMessage(diffs, options);

    function buildMessage(diffs, options) {
      const lines = [];
      lines.push(`❌ Values differ (${diffs.length}${diffs.length >= options.maxDiffs ? "+" : ""} diff${diffs.length === 1 ? "" : "s"}):`);
      for (let i = 0; i < diffs.length; i++) {
        const d = diffs[i];
        const p = pathToString(d.path);
        const left = formatVal(d.left);
        const right = formatVal(d.right);
        const label = d.kind.padEnd(14, " ");
        const extra = d.extra ? ` — ${d.extra}` : "";
        lines.push(`${String(i + 1).padStart(3, " ")}. ${label} ${p}${extra}`);
        lines.push(`     left : ${left}`);
        lines.push(`     right: ${right}`);
      }
      if (diffs.length >= options.maxDiffs) {
        lines.push(`… (diffs capped at maxDiffs=${options.maxDiffs})`);
      }
      return lines.join("\n");
    }

    function print() {
      if (pass) {
        console.log("%c✅ deepCompare: PASS", "font-weight:bold");
        return;
      }
      console.groupCollapsed(`%c❌ deepCompare: FAIL (${diffs.length}${diffs.length >= options.maxDiffs ? "+" : ""})`, "font-weight:bold");
      console.log(message);

      // Also log a structured table for quick scanning
      const table = diffs.map((d) => ({
        kind: d.kind,
        path: pathToString(d.path),
        left: formatVal(d.left),
        right: formatVal(d.right),
        note: d.extra || "",
      }));
      try { console.table(table); } catch {}
      console.groupEnd();
    }

    return { pass, diffs, message, print };
  }

  // Expose globally for DevTools convenience
  window.deepCompare = deepCompare;
  console.log("deepCompare installed. Usage: deepCompare(a,b).print()");
})();

```