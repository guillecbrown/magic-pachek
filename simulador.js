// =====================================================================
//  MAGIC PACHEK - simulador de expediciones (reglas 5e)
//  Juega expediciones completas con bots (bot.js) sobre el motor real y
//  mide el equilibrio: victorias por nivel, caídas y muertes, daño y
//  curación por héroe, y uso de cada habilidad. Se abre con simulador.html.
//  No toca el progreso guardado.
// =====================================================================

const SIN_GUARDAR = true;
Bot.todos = true;
const UI = { render() {}, flotante() {}, dado() {}, paso() {}, golpe() {}, conjuro() {}, especial() {}, anuncio() {}, resaltar() {}, velocidad: () => 0,
  preguntar: (h, titulo, texto, tipo, ctx) => Promise.resolve(Bot.reaccion(h, tipo, ctx)) };
Progreso = { personajes: {}, oro: 0, normal: true, dificil: true };

function nuevasStats() {
  const s = { combates: 0, heroes: {}, usos: {} };
  s.heroe = h => s.heroes[h.def.id] || (s.heroes[h.def.id] = { daño: 0, cura: 0, recibido: 0, caidas: 0, muertes: 0 });
  s.uso = (h, a) => { const k = `${h.def.nombre}: ${a.nombre}`; s.usos[k] = (s.usos[k] || 0) + 1; };
  return s;
}

function tabernaBot() {
  for (const h of S.grupo) {
    while (h.nivel < R5.NIVEL_MAX && h.px >= R5.PX_NIVEL[h.nivel + 1]) Juego.subirNivel(h.uid, window.SIN_TALENTOS ? {} : undefined);
    while (!h.muerto && h.pv < h.pvMax * 0.75 && h.dadosGolpe.usados < h.nivel) Juego.gastarDadoGolpe(h.uid);
  }
  for (const h of S.grupo.filter(x => x.muerto)) if (S.oro >= 300) Juego.comprar('revivir', h.uid);
  while (S.oro >= 50 && S.pociones.comun < 3) Juego.comprar('pocion');
  for (const h of S.grupo) { if (S.oro >= 300 && !h.muerto) Juego.comprar('objeto', h.uid); }
}

async function expedicion(cfg) {
  const ids = cfg.grupo && cfg.grupo.length ? cfg.grupo : barajar(HEROES.map(h => h.id)).slice(0, cfg.tam || 4);
  // SIN_TALENTOS = true en la consola compara contra el juego sin talentos.
  ids.forEach(id => Progreso.personajes[id] = { nivel: cfg.nivel, px: R5.PX_NIVEL[cfg.nivel], objetos: [],
    elecciones: window.SIN_TALENTOS ? { talentos: {}, mejoras: {} } : Heroes.eleccionesAuto(HEROES.find(d => d.id === id), cfg.nivel) });
  Progreso.oro = 0;
  Stats = nuevasStats();
  await Juego.iniciar(ids.map(id => ({ id, jugador: 'ia' })), cfg);
  for (let vueltas = 0; vueltas < 20; vueltas++) {
    if (S.fase === 'botin') { Juego.irTaberna(); continue; }
    if (S.fase === 'taberna') { tabernaBot(); await Juego.continuar(); continue; }
    break;
  }
  const r = { grupo: ids, gano: S.fase === 'victoria', combates: S.combate, stats: Stats, atascada: !!S.atascado,
    niveles: S.grupo.map(h => h.nivel), jefe: S.expedicion.jefeNombre };
  Stats = null;
  return r;
}

function resumir(res, cfg) {
  const n = res.length, pct = x => (100 * x / n).toFixed(0) + '%';
  const sum = f => res.reduce((s, r) => s + f(r), 0);
  const porHeroe = HEROES.map(d => {
    const rr = res.filter(r => r.grupo.includes(d.id));
    const st = k => rr.length ? (sum(r => (r.stats.heroes[d.id] || {})[k] || 0) / rr.length).toFixed(1) : '-';
    return [d.nombre, rr.length ? (100 * rr.filter(r => r.gano).length / rr.length).toFixed(0) + '%' : '-', rr.length,
      st('daño'), st('cura'), st('recibido'), st('caidas'), st('muertes')];
  });
  const usos = {};
  res.forEach(r => Object.entries(r.stats.usos).forEach(([k, v]) => usos[k] = (usos[k] || 0) + v));
  const tabUsos = Object.entries(usos).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (v / n).toFixed(1)]);
  const jefes = {};
  res.filter(r => r.combates >= (LARGOS[cfg.largo].combates - 1)).forEach(r => { const t = jefes[r.jefe] || (jefes[r.jefe] = [0, 0]); t[0]++; if (r.gano) t[1]++; });
  return {
    titulo: `Nivel ${cfg.nivel} · ${EXPEDICIONES[cfg.expedicion].nombre} ${LARGOS[cfg.largo].nombre} · ${DIFICULTADES[cfg.dificultad].nombre} · ${MODIFICADORES[cfg.modificador].nombre}`,
    general: [
      ['Expediciones', n], ['Victorias', pct(res.filter(r => r.gano).length)], ['Atascadas', res.filter(r => r.atascada).length],
      ['Llegan al combate', Array.from({ length: LARGOS[cfg.largo].combates }, (_, k) => res.filter(r => r.combates >= k).length).join(' / ')],
      ['Muertes por expedición', (sum(r => Object.values(r.stats.heroes).reduce((s, h) => s + h.muertes, 0)) / n).toFixed(2)],
      ['Caídas por expedición', (sum(r => Object.values(r.stats.heroes).reduce((s, h) => s + h.caidas, 0)) / n).toFixed(2)],
      ['Nivel al terminar (promedio)', (sum(r => r.niveles.reduce((a, b) => a + b, 0) / r.niveles.length) / n).toFixed(1)],
      ['Jefes (ganados / enfrentados)', Object.entries(jefes).map(([k, [a, b]]) => `${k} ${b}/${a}`).join('; ') || '-'],
    ],
    porHeroe, tabUsos,
  };
}

const tabla = (cab, filas) => `<table><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr>${filas.map(f => `<tr>${f.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;

function pintar(inf) {
  return `<section><h2>${inf.titulo}</h2>
    ${tabla(['Métrica', 'Valor'], inf.general)}
    <h3>Por héroe (promedio por expedición en la que participó)</h3>
    ${tabla(['Héroe', 'Victorias', 'Expediciones', 'Daño', 'Curación', 'Daño recibido', 'Caídas', 'Muertes'], inf.porHeroe)}
    <h3>Habilidades más usadas (por expedición)</h3>${tabla(['Habilidad', 'Usos'], inf.tabUsos.slice(0, 40))}
  </section>`;
}

async function correr(cfg, n, alAvanzar) {
  const res = [];
  for (let i = 0; i < n; i++) {
    res.push(await expedicion(cfg));
    if (alAvanzar && i % 5 === 4) { alAvanzar(i + 1); await new Promise(r => setTimeout(r)); }
  }
  return resumir(res, cfg);
}
