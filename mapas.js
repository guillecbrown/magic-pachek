// =====================================================================
//  MAGIC PACHEK - escenarios vistos desde arriba y geometría del tablero
//
//  El tablero es una cuadrícula de casillas de 5 pies. Cada casilla tiene
//  un terreno:
//    suelo · puente · alfombra       se camina normal
//    barro · agua · escombros · maleza   terreno difícil (cuesta el doble)
//    abismo                          solo se cruza volando; no tapa la vista
//    muro · arbol · roca · pilar · tienda · fuego · trono   bloquean el paso
//                                    (muro, arbol, roca, pilar y tienda
//                                    también tapan la vista)
//  Distancias como en 5e con la regla simple: las diagonales cuentan 5 pies.
//  Las criaturas grandes ocupan 2x2, las enormes 3x3, las gargantuescas 4x4.
// =====================================================================

const TERRENOS = {
  suelo:     { paso: 1 }, puente: { paso: 1 }, alfombra: { paso: 1 },
  barro:     { paso: 2, nombre: 'Barro' }, agua: { paso: 2, nombre: 'Agua', nadable: true },
  escombros: { paso: 2, nombre: 'Escombros' }, maleza: { paso: 2, nombre: 'Maleza' },
  abismo:    { paso: 0, vuelo: true, nombre: 'Abismo' },
  muro:      { paso: 0, tapa: true }, arbol: { paso: 0, tapa: true }, roca: { paso: 0, tapa: true },
  pilar:     { paso: 0, tapa: true }, tienda: { paso: 0, tapa: true }, fuego: { paso: 0 }, trono: { paso: 0 },
};

// Generador pseudoaleatorio con semilla (el mismo mapa se dibuja igual siempre).
function rngSemilla(s) {
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const Mapas = {
  ANCHO: 18, ALTO: 12,

  // ------------------------------------------------------------ creación
  generar(tema, semilla = Math.floor(Math.random() * 1e9)) {
    const r = rngSemilla(semilla);
    const W = Mapas.ANCHO, Hh = Mapas.ALTO;
    const c = Array.from({ length: Hh }, () => Array(W).fill('suelo'));
    const pon = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < Hh) c[y][x] = t; };
    const mancha = (cx, cy, rad, t, prob = 1) => {
      for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad + 0.5 && r() < prob) pon(x, y, t);
    };
    const zonaLibre = x => x <= 2 || x >= W - 4;   // las zonas de inicio quedan despejadas
    let piso = 'tierra';
    if (tema === 'camino') {
      piso = 'pasto';
      for (let i = 0; i < 18; i++) { const x = 3 + Math.floor(r() * (W - 7)), y = Math.floor(r() * Hh); if (Math.abs(y - Hh / 2) > 1.5) pon(x, y, r() < 0.75 ? 'arbol' : 'roca'); }
      for (let i = 0; i < 8; i++) mancha(3 + Math.floor(r() * (W - 7)), Math.floor(r() * Hh), 1, 'maleza', 0.6);
    } else if (tema === 'pantano') {
      piso = 'lodo';
      for (let i = 0; i < 6; i++) mancha(3 + Math.floor(r() * (W - 7)), Math.floor(r() * Hh), 1 + Math.floor(r() * 2), 'agua', 0.85);
      for (let i = 0; i < 7; i++) mancha(2 + Math.floor(r() * (W - 4)), Math.floor(r() * Hh), 1, 'barro', 0.7);
      for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(r() * (W - 7)), y = Math.floor(r() * Hh); if (c[y][x] === 'suelo') pon(x, y, 'arbol'); }
    } else if (tema === 'puente') {
      piso = 'piedra';
      // Puente de 4 casillas: lo cruzan hasta las criaturas gargantuescas.
      const y0 = 3 + Math.floor(r() * 3);
      for (let y = 0; y < Hh; y++) for (let x = 6; x <= 11; x++) pon(x, y, y >= y0 && y <= y0 + 3 ? 'puente' : 'abismo');
      for (let i = 0; i < 6; i++) { const x = r() < 0.5 ? 3 + Math.floor(r() * 3) : 12 + Math.floor(r() * 2), y = Math.floor(r() * Hh); pon(x, y, r() < 0.5 ? 'escombros' : 'roca'); }
    } else if (tema === 'campamento') {
      piso = 'tierra';
      for (let i = 0; i < 4; i++) { const x = 4 + Math.floor(r() * (W - 9)), y = Math.floor(r() * (Hh - 1)); pon(x, y, 'tienda'); pon(x + 1, y, 'tienda'); pon(x, y + 1, 'tienda'); pon(x + 1, y + 1, 'tienda'); }
      pon(Math.floor(W / 2), Math.floor(Hh / 2), 'fuego');
      for (let y = 0; y < Hh; y++) if (y < Hh / 2 - 2 || y > Hh / 2 + 1) pon(W - 5, y, r() < 0.8 ? 'muro' : 'suelo');
      for (let i = 0; i < 5; i++) mancha(3 + Math.floor(r() * (W - 7)), Math.floor(r() * Hh), 1, 'barro', 0.5);
    } else if (tema === 'trono') {
      piso = 'losas';
      for (let x = 0; x < W; x++) { pon(x, 0, 'muro'); pon(x, Hh - 1, 'muro'); }
      for (let y = 0; y < Hh; y++) { pon(0, y, 'muro'); pon(W - 1, y, 'muro'); }
      for (let x = 1; x < W - 1; x++) for (let y = 5; y <= 6; y++) pon(x, y, 'alfombra');
      for (let x = 4; x < W - 3; x += 3) { pon(x, 2, 'pilar'); pon(x, Hh - 3, 'pilar'); }
      pon(W - 2, 5, 'trono'); pon(W - 2, 6, 'trono');
      for (let i = 0; i < 4; i++) mancha(3 + Math.floor(r() * (W - 7)), 1 + Math.floor(r() * (Hh - 2)), 1, 'escombros', 0.4);
      for (let y = 1; y < Hh - 1; y++) if (c[y][1] === 'muro') pon(1, y, 'suelo');
    } else {
      // Mazmorra: salas unidas por pasillos, todo lo demás es roca.
      piso = 'losas';
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) c[y][x] = 'muro';
      // Sala de entrada (héroes), 1 o 2 salas intermedias y la sala de los monstruos.
      const salas = [{ x: 1, y: 2 + Math.floor(r() * 3), w: 5, h: 6 }];
      const medias = 1 + Math.floor(r() * 2);
      for (let i = 1; i <= medias; i++) {
        const w = 3 + Math.floor(r() * 2), h = 4 + Math.floor(r() * 4);
        const x = Math.round(6 + (i - 0.5) * (W - 13) / medias - w / 2);
        salas.push({ x: Math.max(6, Math.min(W - 8 - w, x)), y: 1 + Math.floor(r() * (Hh - h - 1)), w, h });
      }
      salas.push({ x: W - 7, y: 1 + Math.floor(r() * (Hh - 8)), w: 6, h: 7 });
      salas.forEach(s => { for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) pon(x, y, 'suelo'); });
      for (let i = 1; i < salas.length; i++) {
        const a = salas[i - 1], b = salas[i];
        let x = a.x + Math.floor(a.w / 2), y = a.y + Math.floor(a.h / 2);
        const bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2);
        // Pasillos de 3 casillas: pasan las criaturas enormes.
        while (x !== bx) { for (let k = -1; k <= 1; k++) pon(x, y + k, 'suelo'); x += Math.sign(bx - x); }
        while (y !== by) { for (let k = -1; k <= 1; k++) pon(x + k, y, 'suelo'); y += Math.sign(by - y); }
        for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) pon(x + k, y + j, 'suelo');
      }
      for (let i = 0; i < 6; i++) { const x = 2 + Math.floor(r() * (W - 4)), y = 1 + Math.floor(r() * (Hh - 2)); if (c[y][x] === 'suelo' && !zonaLibre(x)) pon(x, y, r() < 0.5 ? 'escombros' : 'pilar'); }
    }
    // Las zonas de inicio siempre quedan transitables.
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if ((x <= 2 || x >= W - 4) && (TERRENOS[c[y][x]].paso === 0) && tema !== 'mazmorra' && tema !== 'trono' && tema !== 'puente') c[y][x] = 'suelo';
    }
    if (tema === 'trono') for (let y = 1; y < Hh - 1; y++) { if (c[y][1] !== 'suelo' && c[y][1] !== 'alfombra') c[y][1] = 'suelo'; }
    return { tema, piso, semilla, ancho: W, alto: Hh, c };
  },

  terreno(m, x, y) { return x < 0 || y < 0 || x >= m.ancho || y >= m.alto ? 'muro' : m.c[y][x]; },

  // ---------------------------------------------------------- criaturas
  tam: u => u.tam || 1,
  celdas(u, x = u.x, y = u.y) {
    const t = Mapas.tam(u), out = [];
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) out.push([x + dx, y + dy]);
    return out;
  },
  centro(u, x = u.x, y = u.y) { const t = Mapas.tam(u); return [x + t / 2, y + t / 2]; },
  // Distancia en casillas entre dos criaturas (o criatura y casilla {x, y, tam:1}).
  dist(a, b) {
    const ta = Mapas.tam(a), tb = Mapas.tam(b);
    const dx = Math.max(0, a.x - (b.x + tb - 1), b.x - (a.x + ta - 1));
    const dy = Math.max(0, a.y - (b.y + tb - 1), b.y - (a.y + ta - 1));
    return Math.max(dx, dy);
  },
  pies(a, b) { return Mapas.dist(a, b) * 5; },

  // ¿Hay línea de visión entre dos puntos (centros de casilla)?
  vista(m, x0, y0, x1, y1) {
    const pasos = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2);
    for (let i = 1; i < pasos; i++) {
      const x = Math.floor(x0 + (x1 - x0) * i / pasos), y = Math.floor(y0 + (y1 - y0) * i / pasos);
      if (TERRENOS[Mapas.terreno(m, x, y)].tapa) return false;
    }
    return true;
  },
  // Visión entre criaturas: basta con que algún par de casillas se vea.
  seVen(m, a, b) {
    const [ax, ay] = Mapas.centro(a), [bx, by] = Mapas.centro(b);
    if (Mapas.vista(m, ax, ay, bx, by)) return true;
    return Mapas.celdas(a).some(([x0, y0]) => Mapas.celdas(b).some(([x1, y1]) => Mapas.vista(m, x0 + 0.5, y0 + 0.5, x1 + 0.5, y1 + 0.5)));
  },

  // ------------------------------------------------------------- movimiento
  // ¿Puede u pararse con su esquina en (x, y)? ocupado(x, y) -> criatura o null.
  cabe(m, u, x, y, ocupado, terminar) {
    for (const [cx, cy] of Mapas.celdas(u, x, y)) {
      const t = TERRENOS[Mapas.terreno(m, cx, cy)];
      if (!t) return false;
      if (t.paso === 0 && !(t.vuelo && Mapas.vuela(u))) return false;
      const o = ocupado(cx, cy);
      if (o && o !== u && (terminar || o.bando !== u.bando)) return false;
    }
    return true;
  },
  vuela: u => !!(u.vel && u.vel.vuela),
  costo(m, u, x, y) {
    let c = 1;
    for (const [cx, cy] of Mapas.celdas(u, x, y)) {
      const t = TERRENOS[Mapas.terreno(m, cx, cy)];
      if (t.paso === 2 && !Mapas.vuela(u) && !(t.nadable && u.vel && u.vel.nada)) c = 2;
    }
    return c;
  },
  // Casillas alcanzables con 'pasos' casillas de movimiento: Map 'x,y' -> { costo, prev }.
  alcanzables(m, u, pasos, ocupado) {
    // 'eu' (largo real del trazo) solo desempata: entre caminos del mismo costo gana el más recto.
    const res = new Map([[`${u.x},${u.y}`, { costo: 0, eu: 0, prev: null, x: u.x, y: u.y }]]);
    const cola = [[u.x, u.y, 0, 0]];
    while (cola.length) {
      cola.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
      const [x, y, c0, e0] = cola.shift();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!Mapas.cabe(m, u, nx, ny, ocupado, false)) continue;
        const c = c0 + Mapas.costo(m, u, nx, ny);
        if (c > pasos) continue;
        const e = e0 + (dx && dy ? 1.414 : 1);
        const k = `${nx},${ny}`;
        const ya = res.get(k);
        if (ya && (ya.costo < c || ya.costo === c && ya.eu <= e + 1e-9)) continue;
        res.set(k, { costo: c, eu: e, prev: `${x},${y}`, x: nx, y: ny });
        cola.push([nx, ny, c, e]);
      }
    }
    // Solo sirven como destino las casillas donde puede terminar.
    for (const [k, v] of res) if (k !== `${u.x},${u.y}` && !Mapas.cabe(m, u, v.x, v.y, ocupado, true)) v.paso = true;
    return res;
  },
  camino(mapaAlc, x, y) {
    const out = [];
    let k = `${x},${y}`;
    while (k) { const v = mapaAlc.get(k); if (!v) break; out.unshift([v.x, v.y]); k = v.prev; }
    return out;
  },

  // ------------------------------------------------------------- áreas
  // Devuelve un Set de 'x,y'. desde: criatura que lanza; punto: {x, y}.
  area(m, forma, tamPies, desde, punto) {
    const out = new Set();
    const R = tamPies / 5;
    const [ox, oy] = desde ? Mapas.centro(desde) : [punto.x + 0.5, punto.y + 0.5];
    for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      let dentro = false;
      if (forma === 'radio') dentro = Math.hypot(cx - punto.x - 0.5, cy - punto.y - 0.5) <= R + 0.01;
      else if (forma === 'cubo') dentro = Math.abs(x - punto.x) <= Math.floor(R / 2) && Math.abs(y - punto.y) <= Math.floor(R / 2);
      else if (forma === 'aura') dentro = Mapas.dist(desde, { x, y }) <= R && !Mapas.celdas(desde).some(([a, b]) => a === x && b === y);
      else {
        const vx = punto.x + 0.5 - ox, vy = punto.y + 0.5 - oy, L = Math.hypot(vx, vy) || 1;
        const px = cx - ox, py = cy - oy, d = Math.hypot(px, py);
        const proy = (px * vx + py * vy) / L;
        if (forma === 'cono') dentro = d > 0.5 && proy > 0 && proy <= R + 0.5 && Math.abs(Math.atan2(px * vy - py * vx, px * vx + py * vy)) <= 0.47;
        if (forma === 'linea') dentro = proy > 0.3 && proy <= R + 0.5 && Math.abs(px * vy - py * vx) / L <= 0.55;
      }
      if (!dentro) continue;
      // La pared corta el área (punto de origen sin visión a la casilla).
      const [sx, sy] = forma === 'radio' || forma === 'cubo' ? [punto.x + 0.5, punto.y + 0.5] : [ox, oy];
      if (TERRENOS[m.c[y][x]].tapa || !Mapas.vista(m, sx, sy, cx, cy)) continue;
      out.add(`${x},${y}`);
    }
    return out;
  },
  enArea(u, set) { return Mapas.celdas(u).some(([x, y]) => set.has(`${x},${y}`)); },

  // Coloca criaturas en una franja (lado 'izq' o 'der'). Las grandes primero.
  colocar(m, unidades, lado, ocupadoBase) {
    const orden = unidades.slice().sort((a, b) => Mapas.tam(b) - Mapas.tam(a));
    // Las que ya se colocaron en esta tanda también ocupan lugar.
    const puestas = [];
    const ocupado = (x, y) => ocupadoBase(x, y) || puestas.find(p => Mapas.celdas(p).some(([a, b]) => a === x && b === y)) || null;
    for (const u of orden) {
      const libres = [];
      for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) {
        if (!Mapas.cabe(m, u, x, y, ocupado, true)) continue;
        // El grupo cerca del borde izquierdo; los monstruos a unos 40 pies de ellos.
        const borde = lado === 'izq' ? x : Math.abs(x + Mapas.tam(u) - (m.ancho - 6));
        libres.push({ x, y, p: borde * 3 + Math.abs(y + Mapas.tam(u) / 2 - m.alto / 2) * 0.6 + Math.random() * 2 });
      }
      libres.sort((a, b) => a.p - b.p);
      const s = libres[0] || { x: lado === 'izq' ? 0 : m.ancho - 1, y: 0 };
      u.x = s.x; u.y = s.y;
      puestas.push(u);
    }
  },

  // ------------------------------------------------------------- dibujo
  // Dibuja el escenario en un canvas y devuelve una imagen (dataURL).
  dibujar(m, px = 48) {
    const cv = document.createElement('canvas');
    cv.width = m.ancho * px; cv.height = m.alto * px;
    const g = cv.getContext('2d');
    const r = rngSemilla(m.semilla + 7);
    const PISO = { pasto: ['#3f5a2a', '#4a6830'], lodo: ['#4a4430', '#554d36'], piedra: ['#5a5650', '#66615a'], tierra: ['#6b5638', '#77603f'], losas: ['#5e5a55', '#6a655f'] };
    const [p1, p2] = PISO[m.piso] || PISO.tierra;
    const tono = (base, v) => { const n = parseInt(base.slice(1), 16); const f = c => Math.max(0, Math.min(255, c + v)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
    for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) {
      const X = x * px, Y = y * px, t = m.c[y][x];
      g.fillStyle = tono((x + y) % 2 ? p1 : p2, Math.floor(r() * 16 - 8)); g.fillRect(X, Y, px, px);
      if (m.piso === 'losas' || m.piso === 'piedra') { g.strokeStyle = '#0003'; g.strokeRect(X + 1, Y + 1, px - 2, px - 2); }
      if (m.piso === 'pasto') for (let i = 0; i < 5; i++) { g.fillStyle = '#5c7d3a88'; g.fillRect(X + r() * px, Y + r() * px, 2, 5); }
    }
    const circulo = (X, Y, rad, c1, c2) => { const gr = g.createRadialGradient(X - rad / 3, Y - rad / 3, rad / 6, X, Y, rad); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, rad, 0, Math.PI * 2); g.fill(); };
    for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) {
      const X = x * px, Y = y * px, t = m.c[y][x], cx = X + px / 2, cy = Y + px / 2;
      if (t === 'muro') {
        g.fillStyle = tono('#151210', Math.floor(r() * 8)); g.fillRect(X, Y, px, px);
        g.fillStyle = '#2a241f'; for (let i = 0; i < 3; i++) g.fillRect(X + (i % 2) * px / 2 + 2, Y + i * px / 3 + 2, px / 2 - 4, px / 3 - 4);
        // Sombra sobre el piso vecino.
        g.fillStyle = '#0006';
        if (y + 1 < m.alto && TERRENOS[m.c[y + 1][x]].paso) g.fillRect(X, Y + px, px, px / 6);
        if (x + 1 < m.ancho && TERRENOS[m.c[y][x + 1]].paso) g.fillRect(X + px, Y, px / 8, px);
      } else if (t === 'agua') {
        g.fillStyle = tono('#2d5560', Math.floor(r() * 12)); g.fillRect(X, Y, px, px);
        g.strokeStyle = '#7fb3bd55'; g.beginPath(); g.arc(cx + r() * 10 - 5, cy, px / 5, 0, Math.PI); g.stroke();
      } else if (t === 'barro') {
        g.fillStyle = '#3d3020cc'; g.fillRect(X, Y, px, px);
        g.fillStyle = '#2a2016aa'; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(X + r() * px, Y + r() * px, 6, 3, 0, 0, Math.PI * 2); g.fill(); }
      } else if (t === 'maleza') {
        g.strokeStyle = '#7a9a4a'; for (let i = 0; i < 7; i++) { const a = X + r() * px, b = Y + px - r() * px / 3; g.beginPath(); g.moveTo(a, b); g.lineTo(a + r() * 6 - 3, b - px / 2.5); g.stroke(); }
      } else if (t === 'escombros') {
        for (let i = 0; i < 5; i++) circulo(X + r() * px, Y + r() * px, 3 + r() * 5, '#9a948a', '#4a4540');
      } else if (t === 'abismo') {
        const gr = g.createLinearGradient(X, Y, X, Y + px); gr.addColorStop(0, '#0b0908'); gr.addColorStop(1, '#151110'); g.fillStyle = gr; g.fillRect(X, Y, px, px);
      } else if (t === 'puente') {
        g.fillStyle = '#6b4a2a'; g.fillRect(X, Y, px, px);
        g.strokeStyle = '#3a2614'; for (let i = 0; i < px; i += 8) { g.beginPath(); g.moveTo(X + i, Y); g.lineTo(X + i, Y + px); g.stroke(); }
      } else if (t === 'alfombra') {
        g.fillStyle = '#7a1e1e'; g.fillRect(X, Y, px, px); g.fillStyle = '#c9a24a55'; g.fillRect(X, Y + 3, px, 2); g.fillRect(X, Y + px - 5, px, 2);
      } else if (t === 'arbol') {
        g.fillStyle = '#0005'; g.beginPath(); g.ellipse(cx + 5, cy + 6, px / 2, px / 2.6, 0, 0, Math.PI * 2); g.fill();
        circulo(cx, cy, px * 0.55, m.tema === 'pantano' ? '#5d6b3a' : '#4f8a3a', m.tema === 'pantano' ? '#2b3018' : '#1f3a18');
      } else if (t === 'roca') {
        circulo(cx, cy, px * 0.42, '#a39d93', '#4a453f');
      } else if (t === 'pilar') {
        g.fillStyle = '#0006'; g.beginPath(); g.arc(cx + 4, cy + 5, px * 0.4, 0, Math.PI * 2); g.fill();
        circulo(cx, cy, px * 0.4, '#d8d0c0', '#6a645a');
      } else if (t === 'tienda') {
        g.fillStyle = '#8a3b22'; g.fillRect(X + 1, Y + 1, px - 2, px - 2);
        g.strokeStyle = '#5a2414'; g.beginPath(); g.moveTo(X, Y); g.lineTo(X + px, Y + px); g.moveTo(X + px, Y); g.lineTo(X, Y + px); g.stroke();
      } else if (t === 'fuego') {
        circulo(cx, cy, px * 0.45, '#ffe08a', '#c0391b'); circulo(cx, cy, px * 0.2, '#fff6c8', '#ffb030');
      } else if (t === 'trono') {
        g.fillStyle = '#c9a24a'; g.fillRect(X + 6, Y + 4, px - 12, px - 8); g.fillStyle = '#7a1e1e'; g.fillRect(X + 12, Y + 10, px - 24, px - 20);
      }
    }
    // Bordes del abismo y cuadrícula.
    g.strokeStyle = '#0000002a'; g.lineWidth = 1;
    for (let x = 0; x <= m.ancho; x++) { g.beginPath(); g.moveTo(x * px + 0.5, 0); g.lineTo(x * px + 0.5, m.alto * px); g.stroke(); }
    for (let y = 0; y <= m.alto; y++) { g.beginPath(); g.moveTo(0, y * px + 0.5); g.lineTo(m.ancho * px, y * px + 0.5); g.stroke(); }
    return cv.toDataURL('image/jpeg', 0.85);
  },
};
