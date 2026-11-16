/*
 * Générateur de QR code minimal, sans dépendance (octets, correction d'erreur M, versions 1 à 10).
 * Usage : QR.svg("https://exemple.fr/j/ABCD") -> chaîne SVG prête à insérer dans la page.
 */
(function (root) {
  'use strict';

  // [octets de correction par bloc, [nb blocs groupe 1, octets de données], [nb blocs groupe 2, octets de données]]
  const EC_M = {
    1: [10, [1, 16], [0, 0]],
    2: [16, [1, 28], [0, 0]],
    3: [26, [1, 44], [0, 0]],
    4: [18, [2, 32], [0, 0]],
    5: [24, [2, 43], [0, 0]],
    6: [16, [4, 27], [0, 0]],
    7: [18, [4, 31], [0, 0]],
    8: [22, [2, 38], [2, 39]],
    9: [22, [3, 36], [2, 37]],
    10: [26, [4, 43], [1, 44]],
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  /* ----- arithmétique de Reed-Solomon (corps de Galois 256) ----- */
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsGenerator(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, gen) {
    const deg = gen.length - 1;
    const res = new Array(deg).fill(0);
    for (const b of data) {
      const factor = b ^ res.shift();
      res.push(0);
      for (let i = 0; i < deg; i++) res[i] ^= gmul(gen[i + 1], factor);
    }
    return res;
  }

  /* ----- codage des données ----- */
  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const [, [n1, d1], [n2, d2]] = EC_M[v];
      const capacityBits = (n1 * d1 + n2 * d2) * 8;
      const needed = 4 + (v <= 9 ? 8 : 16) + len * 8;
      if (needed <= capacityBits) return v;
    }
    throw new Error('Texte trop long pour le QR code');
  }

  function dataCodewords(bytes, ver) {
    const [, [n1, d1], [n2, d2]] = EC_M[ver];
    const capacity = n1 * d1 + n2 * d2;
    const bits = [];
    const push = (value, count) => {
      for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      out.push(v);
    }
    for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }

  function interleave(data, ver) {
    const [ecLen, [n1, d1], [n2, d2]] = EC_M[ver];
    const gen = rsGenerator(ecLen);
    const blocks = [];
    let pos = 0;
    for (let b = 0; b < n1 + n2; b++) {
      const len = b < n1 ? d1 : d2;
      const d = data.slice(pos, pos + len);
      pos += len;
      blocks.push({ d, e: rsRemainder(d, gen) });
    }
    const out = [];
    const maxD = Math.max(d1, n2 ? d2 : 0);
    for (let i = 0; i < maxD; i++) blocks.forEach((blk) => i < blk.d.length && out.push(blk.d[i]));
    for (let i = 0; i < ecLen; i++) blocks.forEach((blk) => out.push(blk.e[i]));
    return out;
  }

  /* ----- construction de la matrice ----- */
  function make(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const ver = pickVersion(bytes.length);
    const size = ver * 4 + 17;
    const codewords = interleave(dataCodewords(bytes, ver), ver);

    const grid = () => Array.from({ length: size }, () => new Array(size).fill(0));
    const mod = grid();
    const fn = grid();
    const setFn = (x, y, v) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      mod[y][x] = v ? 1 : 0;
      fn[y][x] = 1;
    };

    // motifs de synchronisation
    for (let i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }
    // repères de position (avec leur séparateur)
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    // motifs d'alignement
    const pos = ALIGN[ver];
    const last = pos.length - 1;
    pos.forEach((cy, i) => {
      pos.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });

    // informations de format (réservées d'abord, écrites pour de bon après le choix du masque)
    const drawFormat = (g, mark, mask) => {
      const data = (0 << 3) | mask; // niveau de correction M = 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) === 1;
      const set = (x, y, v) => {
        g[y][x] = v ? 1 : 0;
        if (mark) fn[y][x] = 1;
      };
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true); // module sombre fixe
    };
    drawFormat(mod, true, 0);

    // informations de version (versions 7 et plus)
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const b = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const c = Math.floor(i / 3);
        setFn(a, c, b);
        setFn(c, a, b);
      }
    }

    // placement des données en zigzag
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bitIndex < totalBits) {
            mod[y][x] = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
        }
      }
    }

    // choix du meilleur masque
    const maskCond = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];

    function penalty(g) {
      let result = 0;
      const lines = [];
      for (let y = 0; y < size; y++) lines.push(g[y].join(''));
      for (let x = 0; x < size; x++) {
        let s = '';
        for (let y = 0; y < size; y++) s += g[y][x];
        lines.push(s);
      }
      lines.forEach((s) => {
        const runs = s.match(/0+|1+/g);
        runs.forEach((r) => {
          if (r.length >= 5) result += r.length - 2;
        });
        ['10111010000', '00001011101'].forEach((pat) => {
          let from = 0;
          for (;;) {
            const at = s.indexOf(pat, from);
            if (at < 0) break;
            result += 40;
            from = at + 1;
          }
        });
      });
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = g[y][x];
          if (c === g[y][x + 1] && c === g[y + 1][x] && c === g[y + 1][x + 1]) result += 3;
        }
      }
      let dark = 0;
      g.forEach((row) => row.forEach((c) => (dark += c)));
      const total = size * size;
      result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return result;
    }

    let best = null;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const g = mod.map((row) => row.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskCond[m](x, y)) g[y][x] ^= 1;
      drawFormat(g, false, m);
      const score = penalty(g);
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return { size, version: ver, modules: best };
  }

  function svg(text, opts) {
    const margin = opts && opts.margin != null ? opts.margin : 3;
    const qr = make(text);
    const total = qr.size + margin * 2;
    let d = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += 'M' + (x + margin) + ',' + (y + margin) + 'h1v1h-1z';
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>'
    );
  }

  root.QR = { make, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.QR;
})(typeof window !== 'undefined' ? window : globalThis);
