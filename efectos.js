// Efectos visuales de combate: partículas dibujadas en un lienzo sobre el
// tablero y pequeñas animaciones de las fichas (estocada, retroceso, esquive).
// No usa imágenes. Las promesas se resuelven con setTimeout, no con el dibujo,
// para que el juego nunca se quede esperando si la pestaña está oculta.

// [color del centro, color del borde] por tipo de daño.
const FX_COLOR = {
  fuego: ['#ffe08a', '#ff5a1f'], frío: ['#f2fdff', '#6fcbff'], relámpago: ['#fffde0', '#ffe14a'], trueno: ['#f3edff', '#a98cff'],
  ácido: ['#f0ffb0', '#7fd12a'], veneno: ['#d8ff9a', '#3fa52a'], necrótico: ['#d9b8ff', '#6a2aa0'], radiante: ['#fffdf0', '#ffd24a'],
  psíquico: ['#ffe0f6', '#ff4fc0'], fuerza: ['#eef0ff', '#7f8cff'],
  cortante: ['#ffffff', '#cfd8e2'], perforante: ['#ffffff', '#cfd8e2'], contundente: ['#fff4dc', '#e0b878'],
  cura: ['#eaffec', '#4fd36a'], magia: ['#fff3c8', '#e0a83a'],
};
const FX_FISICO = ['cortante', 'perforante', 'contundente'];

const Fx = {
  parts: [], cv: null, cx: null, activo: false, ultimo: 0, cacheHab: {},

  // ------------------------------------------------------------ utilidades
  ritmo: () => Math.max(0.45, UI.velocidad() / 650),
  // Tamaño de los efectos según el tamaño de las casillas (50 px = 1).
  escala: () => Math.min(2.2, Math.max(0.8, (ui.cel || 50) / 50)),
  colores: tipo => FX_COLOR[tipo] || FX_COLOR.magia,
  ficha: u => u && document.querySelector(`.ficha-t[data-uid="${u.uid}"]`),
  centro(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; },
  celda(x, y) {
    const t = document.getElementById('tablero');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left + (x + 0.5) * ui.cel, y: r.top + (y + 0.5) * ui.cel };
  },
  apagado: () => document.hidden || !document.getElementById('tablero'),
  azar: (a, b) => a + Math.random() * (b - a),
  // Primer tipo de daño de unas partes de dado ('2d6 fuego' o [{tipo}]).
  tipoDe(partes) {
    if (!partes) return null;
    const p = typeof partes === 'string' ? Dado.leer(partes) : partes;
    return (p[0] && p[0].tipo) || null;
  },
  // Qué hace una habilidad, leído de su código: tipo de daño, si cura, si tira ataque.
  habilidad(a) {
    if (Fx.cacheHab[a.id]) return Fx.cacheHab[a.id];
    const src = String(a.efecto);
    const m = src.match(/(fuego|frío|relámpago|trueno|ácido|veneno|necrótico|radiante|psíquico|fuerza)/);
    const cura = /\b(H|J)\.curar\(/.test(src);
    return (Fx.cacheHab[a.id] = { tipo: m ? m[1] : cura ? 'cura' : 'magia', cura, ataca: /J\.ataque\(|H\.arma\(|H\.ataqueConjuro\(/.test(src) });
  },

  // ------------------------------------------------------------ lienzo
  lienzo() {
    if (!Fx.cv) {
      Fx.cv = document.createElement('canvas'); Fx.cv.id = 'fx';
      document.body.appendChild(Fx.cv);
      Fx.cx = Fx.cv.getContext('2d');
      const ajustar = () => {
        const k = window.devicePixelRatio || 1;
        Fx.cv.width = innerWidth * k; Fx.cv.height = innerHeight * k;
        Fx.cx.setTransform(k, 0, 0, k, 0, 0);
      };
      addEventListener('resize', ajustar); ajustar();
    }
    return Fx.cx;
  },
  agregar(p) {
    Fx.lienzo();
    p.t = -(p.retraso || 0);
    Fx.parts.push(p);
    if (!Fx.activo) { Fx.activo = true; Fx.ultimo = performance.now(); requestAnimationFrame(Fx.cuadro); }
  },
  cuadro(ahora) {
    const dt = Math.min(60, ahora - Fx.ultimo); Fx.ultimo = ahora;
    const c = Fx.cx;
    c.clearRect(0, 0, innerWidth, innerHeight);
    Fx.parts = Fx.parts.filter(p => (p.t += dt) < p.vida);
    for (const p of Fx.parts) if (p.t >= 0) Fx.dibujar(c, p, dt);
    if (Fx.parts.length) requestAnimationFrame(Fx.cuadro);
    else { Fx.activo = false; c.clearRect(0, 0, innerWidth, innerHeight); }
  },
  dibujar(c, p, dt) {
    const k = p.t / p.vida, vivo = 1 - k;
    if (p.mover) p.mover(p, k, dt);
    else {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      const fr = Math.pow(p.roce || 0.996, dt); p.vx *= fr; p.vy *= fr;
    }
    c.save();
    c.globalCompositeOperation = p.forma === 'humo' ? 'source-over' : 'lighter';
    if (p.forma === 'chispa') {
      c.globalAlpha = vivo; c.strokeStyle = p.color; c.lineWidth = p.tam; c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x - p.vx * 28, p.y - p.vy * 28); c.lineTo(p.x, p.y); c.stroke();
    } else if (p.forma === 'brillo') {
      const r = p.tam * (p.crece ? 0.4 + k : 1 - k * 0.5);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, p.color); g.addColorStop(0.35, p.borde || p.color); g.addColorStop(1, 'transparent');
      c.globalAlpha = vivo * (p.alfa || 1); c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    } else if (p.forma === 'humo') {
      const r = p.tam * (0.5 + k);
      c.globalAlpha = vivo * (p.alfa || 0.35); c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    } else if (p.forma === 'anillo') {
      const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 2));
      c.globalAlpha = vivo; c.strokeStyle = p.color; c.lineWidth = Math.max(0.5, p.tam * vivo);
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
    } else if (p.forma === 'corte') {
      // Arco de un tajo: se traza en el primer 35 % y luego se desvanece.
      const traz = Math.min(1, k / 0.35), a0 = p.ang - 1.25, a1 = a0 + 2.5 * traz;
      c.globalAlpha = k < 0.35 ? 1 : (1 - k) / 0.65;
      c.lineCap = 'round';
      c.strokeStyle = p.borde; c.lineWidth = p.tam * 2.2;
      c.beginPath(); c.arc(p.x, p.y, p.r, a0, a1); c.stroke();
      c.strokeStyle = p.color; c.lineWidth = p.tam;
      c.beginPath(); c.arc(p.x, p.y, p.r, a0, a1); c.stroke();
    } else if (p.forma === 'flecha') {
      c.globalCompositeOperation = 'source-over';
      c.translate(p.x, p.y); c.rotate(p.ang); c.scale(p.esc || 1, p.esc || 1);
      c.strokeStyle = '#e9dcc0'; c.lineWidth = 2.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(4, 0); c.stroke();
      c.fillStyle = '#d8dde4'; c.beginPath(); c.moveTo(10, 0); c.lineTo(1, -4.5); c.lineTo(1, 4.5); c.fill();
      c.fillStyle = '#c8573a'; c.beginPath(); c.moveTo(-22, 0); c.lineTo(-27, -5); c.lineTo(-17, 0); c.lineTo(-27, 5); c.fill();
    }
    c.restore();
  },

  // ------------------------------------------------------------ piezas
  chispas(x, y, n, colores, o = {}) {
    const e = Fx.escala();
    for (let i = 0; i < n; i++) {
      const ang = o.ang !== undefined ? o.ang + Fx.azar(-o.abre, o.abre) : Fx.azar(0, Math.PI * 2);
      const v = Fx.azar(o.vmin || 0.12, o.vmax || 0.42) * e;
      Fx.agregar({ forma: 'chispa', x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, grav: o.grav || 0, roce: 0.993,
        color: colores[i % colores.length], tam: Fx.azar(1.2, o.tam || 2.6) * e, vida: Fx.azar(260, o.vida || 560), retraso: o.retraso });
    }
  },
  brillo(x, y, tam, colores, vida = 320, o = {}) {
    Fx.agregar(Object.assign({ forma: 'brillo', x, y, vx: 0, vy: 0, tam, color: colores[0], borde: colores[1], vida }, o));
  },
  anillo(x, y, r0, r1, color, vida = 420, retraso = 0) {
    Fx.agregar({ forma: 'anillo', x, y, r0, r1, color, tam: 4, vida, retraso });
  },
  humo(x, y, n, color, o = {}) {
    const e = Fx.escala();
    for (let i = 0; i < n; i++) Fx.agregar({ forma: 'humo', x: x + Fx.azar(-8, 8), y: y + Fx.azar(-8, 8), vx: Fx.azar(-0.03, 0.03), vy: Fx.azar(-0.06, -0.02),
      tam: Fx.azar(8, o.tam || 16) * e, color, alfa: o.alfa || 0.3, vida: Fx.azar(500, 900), retraso: o.retraso });
  },

  // Impacto según el tipo de daño. fuerza: 1 normal, 2 crítico.
  estallido(x, y, tipo, fuerza = 1, retraso = 0) {
    const col = Fx.colores(tipo), n = Math.round(12 * fuerza), e = Fx.escala();
    Fx.brillo(x, y, 34 * fuerza * e, col, 300, { retraso, crece: true });
    if (FX_FISICO.includes(tipo)) {
      Fx.chispas(x, y, n, ['#ffffff', '#ffe2a8', '#ffb35a'], { retraso, vmax: 0.5 });
      Fx.chispas(x, y, Math.round(5 * fuerza), ['#d8402e', '#a3261b'], { retraso, grav: 0.0012, vida: 500 });
    } else if (tipo === 'fuego') {
      Fx.chispas(x, y, n, col.concat('#ff9a3a'), { retraso, grav: -0.0006, vida: 700 });
      Fx.humo(x, y, Math.round(3 * fuerza), '#3a2a22', { retraso });
    } else if (tipo === 'frío') {
      Fx.chispas(x, y, n, ['#ffffff', '#bfeaff'], { retraso, vmin: 0.08, vmax: 0.3, tam: 3, vida: 650 });
    } else if (tipo === 'relámpago') {
      Fx.chispas(x, y, n + 6, ['#ffffff', '#fff27a', '#9fdcff'], { retraso, vmin: 0.3, vmax: 0.7, vida: 260 });
    } else if (tipo === 'ácido' || tipo === 'veneno') {
      Fx.chispas(x, y, n, col, { retraso, grav: 0.0012, vmin: 0.1, vmax: 0.32, tam: 3.2, vida: 600 });
      Fx.humo(x, y, 3, tipo === 'ácido' ? '#5f8f1a' : '#2f6a22', { retraso, alfa: 0.25 });
    } else if (tipo === 'necrótico') {
      Fx.humo(x, y, Math.round(5 * fuerza), '#2a0f3a', { retraso, alfa: 0.45, tam: 20 });
      Fx.chispas(x, y, n, col, { retraso, grav: -0.0005, vida: 700 });
    } else {
      Fx.chispas(x, y, n, col, { retraso });
      Fx.anillo(x, y, 6, 40 * fuerza * e, col[1], 420, retraso);
    }
    if (fuerza > 1.5) Fx.anillo(x, y, 10, 70 * e, '#fff3c8', 480, retraso);
  },
  corte(x, y, ang, tipo, crit) {
    const col = FX_FISICO.includes(tipo) ? ['#ffffff', '#9fb6d0'] : Fx.colores(tipo);
    Fx.agregar({ forma: 'corte', x: x - Math.cos(ang) * 6, y: y - Math.sin(ang) * 6, vx: 0, vy: 0, ang: ang + Math.PI / 2,
      r: (crit ? 34 : 26) * Fx.escala(), tam: (crit ? 5 : 3.5) * Fx.escala(), color: col[0], borde: col[1], vida: 380 });
  },
  // Destellos que suben: curación (verde) o bendición (dorado).
  bendicion(x, y, cura) {
    const col = cura ? FX_COLOR.cura : FX_COLOR.radiante, e = Fx.escala();
    Fx.brillo(x, y, 40 * e, col, 520, { alfa: 0.7, crece: true });
    for (let i = 0; i < 16; i++) Fx.agregar({ forma: 'brillo', x: x + Fx.azar(-22, 22) * e, y: y + Fx.azar(-6, 22) * e, vx: Fx.azar(-0.01, 0.01), vy: Fx.azar(-0.09, -0.04) * e,
      tam: Fx.azar(4, 8) * e, color: col[0], borde: col[1], vida: Fx.azar(500, 900), retraso: Fx.azar(0, 220) });
  },
  // Área: un destello por casilla, que se propaga desde el centro.
  area(celdas, tipo, centro) {
    const col = Fx.colores(tipo);
    const pts = [...celdas].map(k => { const [x, y] = k.split(',').map(Number); return Fx.celda(x, y); }).filter(Boolean);
    const paso = pts.length > 60 ? 2 : 1;
    pts.forEach((p, i) => {
      const retraso = Math.hypot(p.x - centro.x, p.y - centro.y) * 1.1;
      Fx.brillo(p.x, p.y, ui.cel * 0.75, col, 420, { retraso, alfa: 0.55, crece: true });
      if (i % paso === 0) Fx.chispas(p.x, p.y, 2, col, { retraso, vmax: 0.2, vida: 420 });
      if (tipo === 'fuego' && i % 3 === 0) Fx.humo(p.x, p.y, 1, '#3a2a22', { retraso });
      if (tipo === 'necrótico' && i % 2 === 0) Fx.humo(p.x, p.y, 1, '#2a0f3a', { retraso, alfa: 0.4 });
    });
  },

  // Proyectil de a a b en ms. fisico: flecha; si no, orbe con estela. pasa: falla y sigue de largo.
  proyectil(a, b, tipo, fisico, ms, pasa) {
    const col = Fx.colores(tipo), e = Fx.escala();
    const dx = b.x - a.x, dy = b.y - a.y, ang = Math.atan2(dy, dx);
    const fin = pasa ? { x: b.x + dx * 0.35 + Math.cos(ang + 1.57) * 24, y: b.y + dy * 0.35 + Math.sin(ang + 1.57) * 24 } : b;
    const largo = pasa ? 1.35 : 1;
    Fx.agregar({ forma: fisico ? 'flecha' : 'brillo', x: a.x, y: a.y, ang, tam: 11 * e, esc: e, color: col[0], borde: col[1], vida: ms * largo,
      mover(p, k) {
        const e = k * largo;
        p.x = a.x + (fin.x - a.x) * k; p.y = a.y + (fin.y - a.y) * k - Math.sin(Math.min(1, e) * Math.PI) * (fisico ? 18 : 6) * e;
        if (!fisico && Math.random() < 0.8) Fx.agregar({ forma: 'brillo', x: p.x, y: p.y, vx: Fx.azar(-0.02, 0.02), vy: Fx.azar(-0.02, 0.02), tam: 7 * e, color: col[0], borde: col[1], vida: 260 });
      } });
    return new Promise(r => setTimeout(r, ms));
  },

  // ------------------------------------------------------------ fichas
  anim(el, frames, ms, o = {}) {
    if (!el || !el.animate) return null;
    return el.animate(frames, Object.assign({ duration: ms, easing: 'ease-out' }, o));
  },
  // Estocada hacia el objetivo; la promesa se cumple en el momento del golpe.
  embestir(el, dx, dy, ms) {
    const d = Math.hypot(dx, dy) || 1, lejos = Math.min(d * 0.45, ui.cel * 0.7);
    const x = dx / d * lejos, y = dy / d * lejos;
    Fx.anim(el, [{ translate: '0 0' }, { translate: `${-x * 0.15}px ${-y * 0.15}px`, offset: 0.25 }, { translate: `${x}px ${y}px`, offset: 0.5 }, { translate: '0 0' }],
      ms, { easing: 'ease-in-out' });
    return new Promise(r => setTimeout(r, ms * 0.5));
  },
  retroceso(el, ang, crit) {
    const d = crit ? 14 : 8;
    Fx.anim(el, [{ translate: '0 0' }, { translate: `${Math.cos(ang) * d}px ${Math.sin(ang) * d}px`, offset: 0.3 }, { translate: '0 0' }], 320);
    Fx.destello(el);
  },
  destello(el) {
    const cara = el && el.querySelector('.cara');
    Fx.anim(cara, [{ filter: 'brightness(2.4) sepia(1) saturate(6) hue-rotate(-30deg)' }, { filter: 'none' }], 360);
  },
  esquivar(el, ang) {
    const lado = Math.random() < 0.5 ? 1 : -1, d = 16;
    Fx.anim(el, [{ translate: '0 0' }, { translate: `${Math.cos(ang + lado * 1.57) * d}px ${Math.sin(ang + lado * 1.57) * d}px`, offset: 0.35 }, { translate: '0 0' }], 380);
  },
  lanzar(el, tipo) {
    const col = Fx.colores(tipo)[1];
    Fx.anim(el && el.querySelector('.cara'), [{ boxShadow: `0 0 0 0 ${col}` }, { boxShadow: `0 0 26px 8px ${col}`, offset: 0.4 }, { boxShadow: `0 0 0 0 ${col}` }], 520);
    const c = Fx.centro(el);
    Fx.chispas(c.x, c.y, 10, Fx.colores(tipo), { grav: -0.0004, vmax: 0.18, vida: 520 });
  },
  temblor() {
    Fx.anim(document.querySelector('.escena'), [
      { translate: '0 0' }, { translate: '-7px 3px' }, { translate: '6px -4px' }, { translate: '-4px -2px' }, { translate: '3px 3px' }, { translate: '0 0' }], 300, { easing: 'linear' });
  },
};
