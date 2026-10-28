// =====================================================================
//  MAGIC PACHEK - motor de combate con reglas de D&D 5e
//  S = estado de la partida. J = reglas que usan las habilidades de
//  heroes.js (ataques, salvaciones, daño, estados). Juego = flujo de la
//  expedición y del combate por iniciativa. IA = monstruos y bots.
//  La interfaz (index.html) define UI.render, UI.flotante, UI.dado,
//  UI.anuncio, UI.resaltar, UI.velocidad y UI.preguntar. El simulador
//  las reemplaza.
// =====================================================================

const S = {
  fase: 'inicio',          // inicio | combate | botin | taberna | victoria | derrota
  grupo: [], enemigos: [], familiares: [],
  orden: [], turnoIdx: -1, actual: null, ronda: 0,
  expedicion: null, combate: 0, oro: 0, pociones: { comun: 0, mayor: 0 },
  logs: [],
};

let Stats = null;          // el simulador pone aquí un objeto de métricas
let _uid = 0;
const nuevoUid = () => 'u' + (++_uid);
const espera = ms => ms ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
const vivo = u => !!u && u.pv > 0 && !u.muerto;
const consciente = u => vivo(u) && !u.caido;

function barajar(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ------------------------------------------------- progreso guardado
// Cada héroe conserva su nivel y su experiencia entre expediciones.
const CLAVE_PROGRESO = 'magicPachek.progreso5e';
let Progreso = { personajes: {}, oro: 0, normal: false, dificil: false, victorias: 0 };
try { Object.assign(Progreso, JSON.parse(localStorage.getItem(CLAVE_PROGRESO)) || {}); } catch (e) {}
function guardarProgreso() {
  if (typeof SIN_GUARDAR !== 'undefined') return;
  try { localStorage.setItem(CLAVE_PROGRESO, JSON.stringify(Progreso)); } catch (e) {}
}
function fichaGuardada(id) { return Progreso.personajes[id] || (Progreso.personajes[id] = { nivel: 1, px: 0 }); }

const Desbloqueos = {
  modificador(k) { return k === 'luna' ? (Progreso.normal || Progreso.dificil) : k === 'resaca' ? Progreso.dificil : true; },
};

// =====================================================================
//  J: REGLAS
// =====================================================================
const J = {
  log(txt, tipo) { S.logs.push({ txt, tipo }); if (S.logs.length > 220) S.logs.shift(); },
  azar(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; },

  heroesVivos() { return S.grupo.filter(vivo); },
  heroesConscientes() { return S.grupo.filter(consciente); },
  aliados() { return S.grupo.filter(consciente).concat(S.familiares.filter(vivo)); },
  enemigosVivos() { return S.enemigos.filter(e => vivo(e) && !J.tiene(e, 'desterrado')); },
  todos() { return S.grupo.concat(S.familiares, S.enemigos); },
  buscar(uid) { return J.todos().find(u => u.uid === uid); },
  bando(u) { return u.tipo === 'enemigo' ? 'enemigos' : 'grupo'; },
  rivales(u) { return u.tipo === 'enemigo' ? J.aliados() : J.enemigosVivos(); },
  companeros(u) { return u.tipo === 'enemigo' ? J.enemigosVivos() : J.aliados(); },

  // -------------------------------------------------------- estadísticas
  mod(u, atr) { return u.tipo === 'heroe' ? R5.mod(u.car[atr]) : (u.def.mods || {})[atr] || 0; },
  prof(u) { return u.tipo === 'heroe' ? R5.prof(u.nivel) : u.def.prof || 2; },
  rasgo(h, id) { return h.tipo === 'heroe' && h.def.rasgos.some(r => r.id === id && h.nivel >= r.nivel); },
  ca(u) {
    let ca = u.tipo === 'heroe' ? u.def.ca(u) + Heroes.talento(u, 'guardia') : u.def.ca;
    if (J.tiene(u, 'escudo')) ca += 5;
    if (J.tiene(u, 'resiliente')) ca += 1;
    return ca;
  },
  cd(h) { return 8 + J.prof(h) + J.mod(h, h.def.lanzador ? h.def.lanzador.atr : 'car') + (J.tieneObjeto(h, 'calcu') ? 1 : 0); },
  bonoConjuro(h) { return J.prof(h) + J.mod(h, h.def.lanzador ? h.def.lanzador.atr : 'car'); },
  bonoSalv(u, atr) {
    if (u.tipo !== 'heroe') return (u.def.salv || {})[atr] ?? J.mod(u, atr);
    return J.mod(u, atr) + (u.def.salvaciones.includes(atr) ? J.prof(u) : 0) + Heroes.talento(u, 'voluntad');
  },
  tieneObjeto(h, id) { return !!(h.objetos && h.objetos.includes(id)); },

  // -------------------------------------------------------------- estados
  // expira: { uid, cuando: 'inicio'|'fin', veces } -> se borra en el
  // inicio/fin del turno de esa criatura. salvar: { atr, cd } -> repite
  // la salvación al final de su turno. conc: id de la concentración que
  // lo mantiene.
  estado(u, id, o = {}) {
    if (u.tipo === 'enemigo' && u.def.defensas && (u.def.defensas.cond || []).includes(id)) {
      J.log(`${u.nombre} es inmune a ${CONDICIONES[id].nombre.toLowerCase()}.`); return false;
    }
    if (u.tipo === 'heroe' && J.inmuneCondicion(u, id)) { J.log(`${u.nombre} no puede quedar ${CONDICIONES[id].nombre.toLowerCase()}.`); return false; }
    u.estados[id] = Object.assign({}, o);
    return true;
  },
  inmuneCondicion(h, id) {
    if (id === 'hechizado' && S.grupo.some(f => consciente(f) && J.rasgo(f, 'auraDevocion'))) return true;
    if (id === 'asustado' && S.grupo.some(f => consciente(f) && J.rasgo(f, 'auraValor'))) return true;
    if ((id === 'hechizado' || id === 'asustado') && J.tiene(h, 'furia') && J.rasgo(h, 'furiaInconsciente')) return true;
    return false;
  },
  valor(u, id) { return u.estados[id] ? u.estados[id].valor : undefined; },
  tiene(u, id) { return !!(u && u.estados && u.estados[id]); },
  quitar(u, id) { delete u.estados[id]; },
  pierdeTurno(u) { return Object.keys(u.estados).some(id => CONDICIONES[id] && CONDICIONES[id].pierdeTurno); },
  incapacitado(u) { return !consciente(u) || INCAPACITAN.some(id => J.tiene(u, id)); },
  estadosMalos(u) { return Object.keys(u.estados).filter(id => CONDICIONES[id] && CONDICIONES[id].tono < 0); },

  // --------------------------------------------------------- concentración
  concentrar(u, nombre) {
    J.romperConcentracion(u, true);
    const id = nuevoUid();
    u.conc = { id, nombre };
    return id;
  },
  romperConcentracion(u, silencioso) {
    if (!u.conc) return;
    const id = u.conc.id;
    if (!silencioso) J.log(`${u.nombre} pierde la concentración en ${u.conc.nombre}.`, 'fallo');
    J.todos().forEach(x => Object.keys(x.estados).forEach(k => { if (x.estados[k].conc === id) delete x.estados[k]; }));
    u.conc = null;
  },

  // ---------------------------------------------------------------- dados
  d20(u, { ventaja, desventaja } = {}) {
    const a = Dado.d(20), b = Dado.d(20);
    if (ventaja && !desventaja) return { d: Math.max(a, b), txt: `[${a},${b}]⬆` };
    if (desventaja && !ventaja) return { d: Math.min(a, b), txt: `[${a},${b}]⬇` };
    return { d: a, txt: `${a}` };
  },
  // Bonos de dado que se suman a ataques y salvaciones.
  dadosExtra(u) {
    let x = 0; const t = [];
    if (J.tiene(u, 'bendecido')) { const v = Dado.d(4); x += v; t.push(`+${v}🙏`); }
    if (J.tiene(u, 'audaz')) { const v = Dado.d(4); x += v; t.push(`+${v}💪`); }
    if (J.tiene(u, 'perdicion')) { const v = Dado.d(4); x -= v; t.push(`-${v}📉`); }
    if (J.tiene(u, 'estatica')) { const v = Dado.d(6); x -= v; t.push(`-${v}📻`); }
    return { x, t: t.join('') };
  },
  // Inspiración bárdica: se usa sola si convierte un fallo en éxito.
  usarInspiracion(u, falta) {
    if (!J.tiene(u, 'inspirado')) return 0;
    const dado = J.valor(u, 'inspirado');
    if (falta > dado) return 0;
    const v = Dado.d(dado);
    const infalible = u.estados.inspirado.infalible;
    if (v >= falta || !infalible) J.quitar(u, 'inspirado');
    J.log(`🎵 ${u.nombre} usa su inspiración: +${v}${v < falta && infalible ? ' (no alcanza, pero la conserva)' : ''}.`);
    return v;
  },

  // ---------------------------------------------------------- ATAQUE
  // o: { nombre, bono, daño: partes, distancia, magico, conjuro, alImpactar(res) }
  async ataque(src, tgt, o) {
    if (!vivo(tgt)) return { impacta: false };
    // Reacción: Encanto instintivo de Guille desvía el ataque.
    if (tgt.tipo === 'heroe' && src.tipo === 'enemigo' && J.puedeReaccionar(tgt) && J.rasgo(tgt, 'encantoInstintivo')) {
      const otros = J.aliados().filter(a => a !== tgt && a.tipo !== 'familiar');
      if (otros.length && await UI.preguntar(tgt, 'Desvío de responsabilidad', `${src.nombre} va a atacar a ${tgt.nombre}. ¿Usar la reacción para desviar el ataque (salvación de SAB CD ${J.cd(tgt)})?`, 'desvio', { src })) {
        tgt.reaccion = false;
        if (!await J.salvar(src, 'sab', J.cd(tgt), { fuente: tgt, conjuro: true })) {
          const nuevo = J.azar(J.enemigosVivos().filter(e => e !== src)) || J.azar(otros);
          J.log(`🌀 ${tgt.nombre} desvía la responsabilidad: ${src.nombre} ataca a ${nuevo.nombre}.`, 'crit');
          tgt = nuevo;
        }
      }
    }
    let ventaja = false, desventaja = false;
    const cerca = !o.distancia;
    const cs = id => CONDICIONES[id];
    Object.keys(src.estados).forEach(id => { if (cs(id) && cs(id).desvAtaca) desventaja = true; });
    if (J.tiene(src, 'burlado')) { desventaja = true; J.quitar(src, 'burlado'); }
    if (J.tiene(src, 'provocado') && src.estados.provocado.fuente !== tgt.uid) desventaja = true;
    if (J.tiene(src, 'invisible') || J.tiene(src, 'temerario') && cerca) ventaja = true;
    if (J.tiene(src, 'rush')) ventaja = true;
    if (src.tipo === 'enemigo' && src.def.rasgos && src.def.rasgos.tacticasManada && J.enemigosVivos().length > 1) ventaja = true;
    Object.keys(tgt.estados).forEach(id => {
      if (cs(id) && cs(id).ventajaContra && (id !== 'derribado' || cerca)) ventaja = true;
    });
    if (J.tiene(tgt, 'derribado') && !cerca) desventaja = true;
    // Disparar con un rival pegado al lado: desventaja.
    if (!cerca && T.amenazado(src)) desventaja = true;
    if (J.tiene(tgt, 'invisible') || J.tiene(tgt, 'esquivando') || J.tiene(tgt, 'lejos')) desventaja = true;
    if (J.tiene(tgt, 'levitando') && cerca) desventaja = true;
    if (tgt.tipo === 'heroe' && tgt.caido) ventaja = true;

    const r = J.d20(src, { ventaja, desventaja });
    const ex = J.dadosExtra(src);
    let total = r.d + o.bono + ex.x + (src.tipo === 'heroe' ? Heroes.talento(src, 'punteria') : 0);
    let ca = J.ca(tgt);
    let crit = r.d >= (o.critMin || 20);
    let impacta = r.d !== 1 && (crit || total >= ca);
    if (!impacta && r.d !== 1 && src.tipo !== 'enemigo') {
      const v = J.usarInspiracion(src, ca - total);
      total += v; impacta = total >= ca;
    }
    // Reacción: Escudo (Indignación de Guille).
    if (impacta && !crit && tgt.tipo === 'heroe' && total < ca + 5 && J.puedeReaccionar(tgt) && J.habilidad(tgt, 'escudo') && J.espacioLibre(tgt, 1)) {
      if (await UI.preguntar(tgt, 'Indignación (Escudo)', `${src.nombre} impacta a ${tgt.nombre} con ${total} contra CA ${ca}. ¿Gastar un espacio de nivel 1 para +5 a la CA hasta su próximo turno?`, 'escudo', { total, ca })) {
        tgt.reaccion = false; J.gastarEspacio(tgt, 1);
        J.estado(tgt, 'escudo', { expira: { uid: tgt.uid, cuando: 'inicio' } });
        ca += 5; impacta = total >= ca;
        J.log(`🛡 ${tgt.nombre} se indigna: +5 a la CA.`, 'crit');
      }
    }
    if (impacta && cerca && (J.tiene(tgt, 'paralizado') || J.tiene(tgt, 'dormido') || tgt.caido)) crit = true;
    if (J.tiene(src, 'rush')) J.quitar(src, 'rush');
    await UI.dado(src, r.d, total - r.d, crit && impacta ? '¡CRÍTICO!' : impacta ? 'impacta' : 'falla', { vs: 'CA', meta: ca, det: r.txt, contra: tgt, nombre: o.nombre });
    const p0 = typeof o.daño === 'string' ? Dado.leer(o.daño)[0] : (o.daño || [])[0];
    await UI.golpe(src, tgt, { impacta, crit: crit && impacta, distancia: !cerca, tipo: (p0 && p0.tipo) || 'contundente', magico: !!(o.magico || o.conjuro) });
    const encabezado = `🎲 ${src.nombre} → ${tgt.nombre} (${o.nombre}): ${r.txt}${o.bono >= 0 ? '+' : ''}${o.bono}${ex.t} = ${total} vs CA ${ca}`;
    if (!impacta) { J.log(`${encabezado} → falla.`, 'fallo'); UI.flotante(tgt.uid, 'falla', 'info'); return { impacta: false, total, d: r.d }; }
    let partes = o.daño.slice();
    if (o.extra) partes = partes.concat(o.extra);
    const tir = Dado.tirar(partes, crit);
    let daño = tir.total;
    // Reacción: Defensa Tanque de Tony.
    if (tgt.tipo !== 'enemigo' && src.tipo === 'enemigo') {
      const tony = S.grupo.find(h => h !== tgt && J.puedeReaccionar(h) && J.habilidad(h, 'tanque') && Mapas.dist(h, tgt) <= 1);
      if (tony && await UI.preguntar(tony, 'Defensa Tanque', `${src.nombre} le va a hacer ${daño} de daño a ${tgt.nombre}. ¿${tony.nombre} se interpone (reduce 1d10 + ${J.prof(tony)})?`, 'tanque', { daño })) {
        tony.reaccion = false;
        const red = Dado.d(10) + J.prof(tony);
        daño = Math.max(0, daño - red);
        J.log(`🐢 ${tony.nombre} se interpone y frena ${red} de daño.`, 'crit');
      }
    }
    J.log(`${encabezado} → ${crit ? '¡CRÍTICO! ' : 'impacta. '}Daño ${tir.trozos.map(t => t.texto + ' ' + t.tipo).join(' + ')} = ${daño}.`, crit ? 'crit' : 'accion');
    const res = { impacta: true, crit, total, d: r.d, daño: 0 };
    res.daño = await J.dañarTrozos(tgt, tir.trozos, src, { magico: o.magico, recortar: daño, crit });
    if (Stats && src.tipo === 'heroe') Stats.heroe(src).daño += res.daño;
    if (o.alImpactar && vivo(tgt)) await o.alImpactar(res, tgt);
    if (o.efecto && vivo(tgt)) await J.aplicarEfecto(src, tgt, o.efecto);
    return res;
  },

  // Efecto de un golpe de monstruo: salvación o condición.
  async aplicarEfecto(src, tgt, ef) {
    if (!ef || !ef.condicion) return;
    if (await J.salvar(tgt, ef.salv, ef.cd, { fuente: src })) return;
    const dur = ef.condicion === 'derribado' ? { expira: { uid: tgt.uid, cuando: 'fin' } }
      : { expira: { uid: tgt.uid, cuando: 'fin', veces: 10 }, salvar: { atr: ef.salv, cd: ef.cd } };
    if (J.estado(tgt, ef.condicion, Object.assign({ fuente: src.uid }, dur))) {
      J.log(`${tgt.nombre} queda ${CONDICIONES[ef.condicion].nombre.toLowerCase()}.`, 'muerte');
    }
  },

  // ------------------------------------------------------ SALVACIÓN
  // o: { fuente, conjuro, magico }
  async salvar(u, atr, cd, o = {}) {
    if (!vivo(u)) return false;
    const nombreAtr = R5.CORTO_ATR[atr];
    if ((atr === 'fue' || atr === 'des') && Object.keys(u.estados).some(id => CONDICIONES[id] && CONDICIONES[id].fallaFueDes)) {
      J.log(`${u.nombre} no puede esquivar: falla la salvación de ${nombreAtr}.`, 'fallo'); return false;
    }
    let bono = J.bonoSalv(u, atr);
    if (u.tipo !== 'enemigo') {
      const fer = S.grupo.find(f => consciente(f) && J.rasgo(f, 'auraProteccion'));
      if (fer) bono += Math.max(1, J.mod(fer, 'car'));
    }
    let ventaja = false, desventaja = false;
    if (u.tipo === 'enemigo' && u.def.rasgos && u.def.rasgos.resistenciaMagica && (o.conjuro || o.magico)) ventaja = true;
    if (J.rasgo(u, 'astuciaGnoma') && ['int', 'sab', 'car'].includes(atr) && (o.magico || o.conjuro)) ventaja = true;
    if (J.rasgo(u, 'sentidoPeligro') && atr === 'des') ventaja = true;
    if (J.tiene(u, 'furia') && atr === 'fue') ventaja = true;
    const r = J.d20(u, { ventaja, desventaja });
    const ex = J.dadosExtra(u);
    let total = r.d + bono + ex.x;
    let menos = '';
    if (J.tiene(u, 'inquieto')) { const v = Dado.d(J.valor(u, 'inquieto')); total -= v; menos = `-${v}😬`; J.quitar(u, 'inquieto'); }
    let ok = total >= cd;
    if (!ok && u.tipo !== 'enemigo') { total += J.usarInspiracion(u, cd - total); ok = total >= cd; }
    // Reacción: Destello de genio (Coco o Tony).
    if (!ok && u.tipo === 'heroe') {
      const genio = S.grupo.find(h => J.puedeReaccionar(h) && J.rasgo(h, 'destello') && J.recurso(h, 'destello') > 0 && cd - total <= J.mod(h, 'int'));
      if (genio && await UI.preguntar(genio, 'Destello de genio', `${u.nombre} falla una salvación de ${nombreAtr} por ${cd - total}. ¿${genio.nombre} le suma +${J.mod(genio, 'int')}?`, 'destello', {})) {
        genio.reaccion = false; J.usarRecurso(genio, 'destello');
        total += J.mod(genio, 'int'); ok = total >= cd;
        J.log(`💡 ${genio.nombre} le da soporte técnico a ${u.nombre}: +${J.mod(genio, 'int')}.`, 'crit');
      }
    }
    J.log(`🎲 ${u.nombre} salva ${nombreAtr}: ${r.txt}${bono >= 0 ? '+' : ''}${bono}${ex.t}${menos} = ${total} vs CD ${cd} → ${ok ? 'salva' : 'falla'}.`, ok ? '' : 'fallo');
    let leg = false;
    if (!ok && u.tipo === 'enemigo' && u.resLegendaria > 0) {
      u.resLegendaria--; ok = true; leg = true;
      J.log(`👑 ${u.nombre} usa una resistencia legendaria y salva igual (${u.resLegendaria} restantes).`, 'muerte');
    }
    await UI.dado(u, r.d, total - r.d, leg ? 'resistencia legendaria' : ok ? 'salva' : 'falla', { vs: 'CD', meta: cd, det: r.txt, salv: nombreAtr, exito: ok });
    return ok;
  },

  // -------------------------------------------------------------- DAÑO
  // trozos: [{suma, tipo}] de Dado.tirar. recortar: total ya ajustado
  // por reacciones (se reparte proporcionalmente).
  async dañarTrozos(tgt, trozos, src, o = {}) {
    const bruto = trozos.reduce((s, t) => s + t.suma, 0);
    const factor = o.recortar !== undefined && bruto ? o.recortar / bruto : 1;
    let total = 0;
    for (const t of trozos) total += J.ajustarTipo(tgt, Math.round(t.suma * factor), t.tipo, o.magico);
    return J.aplicarDaño(tgt, total, src, o);
  },
  async dañar(tgt, cantidad, tipo, src, o = {}) {
    return J.aplicarDaño(tgt, J.ajustarTipo(tgt, cantidad, tipo, o.magico), src, o);
  },
  ajustarTipo(tgt, n, tipo, magico) {
    if (!n) return 0;
    const fisico = ['contundente', 'cortante', 'perforante'].includes(tipo);
    if (tgt.tipo === 'enemigo') {
      const d = tgt.def.defensas || {};
      if ((d.inm || []).includes(tipo) || (fisico && !magico && (d.inm || []).includes('noMagico'))) return 0;
      if ((d.vul || []).includes(tipo)) n *= 2;
      if ((d.res || []).includes(tipo) || (fisico && !magico && (d.res || []).includes('noMagico'))) n = Math.floor(n / 2);
      if (tipo === 'fuego' || tipo === 'ácido') tgt.sinRegenerar = true;
    } else {
      if (J.tiene(tgt, 'furia') && fisico) n = Math.floor(n / 2);
      if (tgt.tipo === 'heroe' && (tgt.def.resistencias || []).includes(tipo)) n = Math.floor(n / 2);
    }
    if (J.tiene(tgt, 'desvestido')) n *= 2;
    return n;
  },
  async aplicarDaño(tgt, d, src, o = {}) {
    if (!tgt || tgt.muerto) return 0;
    if (tgt.tipo === 'heroe' && tgt.caido) {
      if (d <= 0) return 0;
      tgt.salvMuerte.f += o.crit ? 2 : 1;
      J.log(`💀 ${tgt.nombre} recibe daño estando caído: ${o.crit ? 2 : 1} fallo(s) de muerte.`, 'muerte');
      if (d >= tgt.pvMax || tgt.salvMuerte.f >= 3) J.morirHeroe(tgt);
      return 0;
    }
    if (!vivo(tgt) || d <= 0) { if (d <= 0) UI.flotante(tgt.uid, '0', 'info'); return 0; }
    if (tgt.temp > 0) {
      const abs = Math.min(tgt.temp, d); tgt.temp -= abs; d -= abs;
      if (abs) UI.flotante(tgt.uid, `🛡${abs}`, 'info');
    }
    if (d <= 0) return 0;
    const antes = tgt.pv;
    tgt.pv = Math.max(0, tgt.pv - d);
    const hecho = antes - tgt.pv;
    UI.flotante(tgt.uid, `-${d}`, o.crit ? 'daño crit' : 'daño');
    if (src && src.tipo === 'enemigo' && tgt.tipo === 'heroe') {
      if (!tgt.dañadoPor.includes(src.uid)) tgt.dañadoPor.push(src.uid);
      if (Stats) Stats.heroe(tgt).recibido += hecho;
    }
    Object.keys(tgt.estados).forEach(id => { if (CONDICIONES[id] && CONDICIONES[id].despiertaConDaño) { delete tgt.estados[id]; if (tgt.pv > 0) J.log(`${tgt.nombre} reacciona al golpe.`); } });
    // Concentración.
    if (tgt.conc && tgt.pv > 0) {
      const cd = Math.max(10, Math.floor(d / 2));
      if (!await J.salvar(tgt, 'con', cd, {})) J.romperConcentracion(tgt);
    }
    // Reprensión infernal de Fer.
    if (tgt.tipo === 'heroe' && tgt.pv > 0 && src && src.tipo === 'enemigo' && vivo(src) && J.puedeReaccionar(tgt)
        && J.habilidad(tgt, 'reprension') && J.recurso(tgt, 'reprension') > 0) {
      if (await UI.preguntar(tgt, 'Reprensión infernal', `${src.nombre} acaba de herir a ${tgt.nombre}. ¿Responder con llamas infernales (2d10 de fuego, salvación DES CD ${J.cd(tgt)})?`, 'reprension', { src })) {
        tgt.reaccion = false; J.usarRecurso(tgt, 'reprension');
        J.log(`😈 ${tgt.nombre} responde con llamas infernales.`, 'crit');
        const t = Dado.tirar('2d10 fuego');
        const salvo = await J.salvar(src, 'des', J.cd(tgt), { fuente: tgt, conjuro: true });
        await J.dañar(src, salvo ? Math.floor(t.total / 2) : t.total, 'fuego', tgt, { magico: true });
      }
    }
    if (tgt.pv <= 0) await J.caer(tgt, src, d - antes);
    // Jefes que cambian a media vida (la Reina llama a su corte).
    else if (tgt.tipo === 'enemigo' && tgt.def.alMitad && !tgt.mitadHecha && tgt.pv <= tgt.pvMax / 2) {
      tgt.mitadHecha = true;
      const m = tgt.def.alMitad;
      J.log(`👑 ${tgt.nombre}: ${m.nombre}.`, 'titulo'); UI.anuncio(tgt, m.nombre);
      for (let i = 0; i < m.cantidad; i++) Juego.agregarEnemigo(m.invoca);
    }
    return hecho;
  },

  // sobra: daño que pasó de 0 PV (si iguala la vida máxima, muerte instantánea).
  async caer(u, src, sobra) {
    if (u.tipo === 'heroe') {
      if (J.rasgo(u, 'aguante') && J.recurso(u, 'aguante') > 0) {
        J.usarRecurso(u, 'aguante'); u.pv = 1;
        J.log(`💢 ${u.nombre} se niega a caer (Aguante incansable): queda con 1 PV.`, 'crit'); return;
      }
      if (J.tiene(u, 'furia') && J.rasgo(u, 'furiaImplacable')) {
        const cd = 10 + 5 * (u.implacable || 0); u.implacable = (u.implacable || 0) + 1;
        if (await J.salvar(u, 'con', cd, {})) { u.pv = 1; J.log(`🔥 ${u.nombre} sigue en pie por pura furia.`, 'crit'); return; }
      }
      if (sobra >= u.pvMax) { J.log(`El golpe es tan brutal que ${u.nombre} muere en el acto.`, 'muerte'); J.morirHeroe(u); return; }
      u.caido = true; u.salvMuerte = { e: 0, f: 0 }; u.estable = false;
      u.estados = {}; J.romperConcentracion(u, true);
      J.log(`🩸 ${u.nombre} cae inconsciente.`, 'muerte');
      if (Stats) Stats.heroe(u).caidas++;
      return;
    }
    if (u.tipo === 'familiar') { J.log(`${u.nombre} vuelve al Legendarium.`); return; }
    J.romperConcentracion(u, true);
    J.log(`☠ ${u.nombre} cae.`, 'muerte');
    S.vencidos.push(u);
  },
  morirHeroe(h) {
    h.muerto = true; h.caido = true; h.pv = 0; h.estados = {};
    J.log(`⚰ ${h.nombre} ha muerto.`, 'muerte');
    if (Stats) Stats.heroe(h).muertes++;
  },

  curar(u, n, quien) {
    if (!u || u.muerto || n <= 0) return 0;
    if (u.tipo === 'heroe' && u.caido) {
      u.caido = false; u.pv = 0; u.salvMuerte = { e: 0, f: 0 };
      J.log(`✨ ${u.nombre} recupera la conciencia.`, 'crit');
    }
    const antes = u.pv;
    u.pv = Math.min(u.pvMax, u.pv + n);
    if (u.pv > antes) UI.flotante(u.uid, `+${u.pv - antes}`, 'cura');
    if (Stats && quien && quien.tipo === 'heroe') Stats.heroe(quien).cura += u.pv - antes;
    return u.pv - antes;
  },
  vidaTemporal(u, n) { if (n > (u.temp || 0)) { u.temp = n; UI.flotante(u.uid, `+${n} temp`, 'info'); } },

  // Muerte inmediata: solo si le queda menos de la mitad de la vida. Los
  // jefes nunca: reciben el daño alternativo.
  async muerteInmediata(src, tgt, motivo, dañoAlt, tipoAlt) {
    if (!vivo(tgt)) return;
    if (!tgt.jefe && tgt.pv <= tgt.pvMax / 2) {
      J.log(`☠ ${tgt.nombre} ${motivo}.`, 'muerte'); UI.flotante(tgt.uid, '☠', 'daño');
      if (Stats && src.tipo === 'heroe') Stats.heroe(src).daño += tgt.pv;
      tgt.pv = 0; await J.caer(tgt, src, 0); return;
    }
    J.log(`${tgt.nombre} resiste: ${tgt.jefe ? 'es un jefe' : 'todavía tiene más de la mitad de su vida'}.`);
    const d = await J.dañar(tgt, Dado.tirar(dañoAlt).total, tipoAlt, src, { magico: true });
    if (Stats && src.tipo === 'heroe') Stats.heroe(src).daño += d;
  },

  // ------------------------------------------------- recursos y espacios
  recurso(h, id) { const r = h.recursos[id]; return r ? r.max - r.usados : 0; },
  usarRecurso(h, id, n = 1) { if (h.recursos[id]) h.recursos[id].usados += n; },
  espacioLibre(h, min) { return h.espacios.max.some((m, i) => i + 1 >= min && h.espacios.usados[i] < m); },
  gastarEspacio(h, min) {
    for (let i = min - 1; i < h.espacios.max.length; i++) {
      if (h.espacios.usados[i] < h.espacios.max[i]) { h.espacios.usados[i]++; return i + 1; }
    }
    return 0;
  },
  habilidad(h, id) { return h.tipo === 'heroe' && Heroes.habilidades(h).some(a => a.id === id); },
  puedeReaccionar(h) { return h.tipo === 'heroe' && h.reaccion && consciente(h) && !J.incapacitado(h); },

  // Insulto: Guille se indigna (una vez por ronda) y la Dignidad lo bloquea.
  async insulto(src) {
    const g = S.grupo.find(h => consciente(h) && J.rasgo(h, 'indignacionPasiva'));
    if (!g || g === src || g.indignadoRonda === S.ronda) return;
    g.indignadoRonda = S.ronda;
    const v = Dado.d(4);
    J.log(`😤 ${g.nombre} se indigna por el ataque verbal: pierde ${v} PV, pero su próximo conjuro de daño suma INT.`);
    g.pv = Math.max(1, g.pv - v); UI.flotante(g.uid, `-${v}`, 'daño');
    J.estado(g, 'indignado', {});
  },
  // Conjuros y habilidades verbales: los bloquea el Silencio.
  verbalBloqueado(u) { return J.tiene(u, 'silenciado') ? 'Está silenciado' : null; },
  // Insultos: además los bloquea la Dignidad Desatada de Guille.
  insultoBloqueado(u) {
    const dig = S.grupo.find(h => consciente(h) && J.tiene(h, 'dignidad'));
    return dig && dig !== u ? 'La Dignidad Desatada de Guille no deja insultar' : J.verbalBloqueado(u);
  },
};

// =====================================================================
//  T: TABLERO (posiciones, movimiento, alcances)
// =====================================================================
const T = {
  enTablero(u) { return u.x !== undefined && !u.muerto && (u.tipo === 'heroe' || vivo(u)) && !J.tiene(u, 'desterrado'); },
  // Función (x, y) -> criatura que ocupa la casilla.
  ocupado() {
    const m = new Map();
    J.todos().forEach(u => { if (T.enTablero(u)) Mapas.celdas(u).forEach(([x, y]) => m.set(`${x},${y}`, u)); });
    return (x, y) => m.get(`${x},${y}`) || null;
  },
  // Velocidad en casillas.
  velocidad(u) {
    if (J.tiene(u, 'apresado')) return 0;
    const pies = u.tipo === 'heroe' ? u.def.vel(u) : Math.max(...Object.values(u.vel || { camina: 30 }));
    return Math.floor(pies / 5);
  },
  // Alcance cuerpo a cuerpo en casillas (0 si no ataca cuerpo a cuerpo).
  alcanceCC(u) {
    if (u.tipo === 'heroe') return Heroes.armas(u).some(a => a.alcance) ? 1 : 0;
    if (u.tipo === 'familiar') return u.def.cc ? 1 : 0;
    return Math.max(0, ...u.def.ataques.map(a => Math.floor((a.alcance || 0) / 5)));
  },
  // ¿t está a 'pies' de a, con línea de visión si no es adyacente?
  enAlcance(a, t, pies) {
    if (!S.mapa || a.x === undefined || t.x === undefined) return true;
    const d = Mapas.dist(a, t);
    return d * 5 <= pies && (d <= 1 || Mapas.seVen(S.mapa, a, t));
  },
  // ¿Tiene un rival consciente al lado? (los ataques a distancia van con desventaja)
  amenazado(u) {
    return J.rivales(u).some(r => T.enTablero(r) && !J.incapacitado(r) && T.alcanceCC(r) && Mapas.dist(u, r) <= T.alcanceCC(r));
  },
  alcanzables(u, pasos = u.mov) { return Mapas.alcanzables(S.mapa, u, pasos, T.ocupado()); },

  // Mueve u casilla por casilla hasta (x, y). Los rivales que lo tenían al
  // alcance y lo pierden pueden hacer un ataque de oportunidad.
  async mover(u, x, y, o = {}) {
    if (x === u.x && y === u.y) return true;
    const alc = o.alc || T.alcanzables(u, o.pasos !== undefined ? o.pasos : u.mov);
    const d = alc.get(`${x},${y}`);
    if (!d || d.paso) return false;
    const camino = Mapas.camino(alc, x, y);
    u.mov = Math.max(0, (u.mov || 0) - d.costo);
    for (let i = 1; i < camino.length; i++) {
      const [nx, ny] = camino[i];
      if (!J.tiene(u, 'destrabado')) {
        for (const r of J.rivales(u)) {
          const al = T.alcanceCC(r);
          if (!al || !r.reaccion || J.incapacitado(r) || !T.enTablero(r)) continue;
          if (Mapas.dist(u, r) <= al && Mapas.dist({ x: nx, y: ny, tam: u.tam }, r) > al) await T.oportunidad(r, u);
          if (!consciente(u) || S.fase !== 'combate') { UI.render(); return true; }
        }
      }
      u.x = nx; u.y = ny;
      await UI.paso(u);
    }
    return true;
  },
  // Salto directo a una casilla libre (teletransporte, empujones).
  ubicar(u, x, y) {
    if (!Mapas.cabe(S.mapa, u, x, y, T.ocupado(), true)) return false;
    u.x = x; u.y = y; return true;
  },
  async oportunidad(r, u) {
    if (r.tipo === 'enemigo') {
      const a = r.def.ataques.filter(a => a.alcance && Mapas.dist(u, r) * 5 <= a.alcance).sort((p, q) => Dado.media(q.daño) - Dado.media(p.daño))[0];
      if (!a) return;
      r.reaccion = false;
      J.log(`⚡ ${u.nombre} se aleja: ataque de oportunidad de ${r.nombre}.`, 'enemigo');
      await IA.atacar(r, u, a);
    } else if (r.tipo === 'heroe') {
      if (!await UI.preguntar(r, 'Ataque de oportunidad', `${u.nombre} se aleja de ${r.nombre}. ¿Usar la reacción para atacarlo?`, 'oportunidad', { u })) return;
      r.reaccion = false;
      J.log(`⚡ Ataque de oportunidad de ${r.nombre}.`, 'accion');
      await H.arma(J, r, u, Heroes.armas(r).find(a => a.alcance));
    }
  },
  // Casilla libre más cercana a 'ref' donde quepa u.
  colocarCerca(u, ref) {
    const oc = T.ocupado(), libres = [];
    for (let y = 0; y < S.mapa.alto; y++) for (let x = 0; x < S.mapa.ancho; x++) {
      if (Mapas.cabe(S.mapa, u, x, y, oc, true)) libres.push({ x, y, d: Mapas.dist({ x, y, tam: u.tam }, ref) + Math.random() * 0.3 });
    }
    libres.sort((a, b) => a.d - b.d);
    if (libres[0]) { u.x = libres[0].x; u.y = libres[0].y; }
  },
  // Mejor casilla alcanzable este turno desde la que 'pies' llegan a t.
  // lejos: preferir casillas lejos de los rivales (tiradores y lanzadores).
  casillaPara(u, t, pies, o = {}) {
    const alc = o.alc || T.alcanzables(u, o.pasos !== undefined ? o.pasos : u.mov);
    let mejor = null, mp = Infinity;
    for (const v of alc.values()) {
      if (v.paso) continue;
      const pos = { x: v.x, y: v.y, tam: u.tam };
      const d = Mapas.dist(pos, t);
      if (d * 5 > pies || (d > 1 && !Mapas.seVen(S.mapa, pos, t))) continue;
      let p = v.costo;
      if (o.lejos) p -= Math.min(4, Math.min(...J.rivales(u).filter(T.enTablero).map(r => Mapas.dist(pos, r)))) * 1.5;
      if (p < mp) { mp = p; mejor = v; }
    }
    return mejor;
  },
  // Casilla alcanzable que más se acerca a t (para avanzar sin llegar).
  acercarse(u, t, pasos) {
    const alc = T.alcanzables(u, pasos);
    let mejor = null, md = Infinity;
    for (const v of alc.values()) {
      if (v.paso) continue;
      const d = Mapas.dist({ x: v.x, y: v.y, tam: u.tam }, t) + v.costo * 0.01;
      if (d < md) { md = d; mejor = v; }
    }
    return mejor ? { v: mejor, alc } : null;
  },
};

// =====================================================================
//  CREACIÓN DE UNIDADES
// =====================================================================
function crearHeroe(def, ficha, jugador) {
  const h = { uid: nuevoUid(), tipo: 'heroe', bando: 'grupo', tam: 1, def, nombre: def.nombre, jugador, nivel: ficha.nivel, px: ficha.px,
    estados: {}, temp: 0, caido: false, muerto: false, salvMuerte: { e: 0, f: 0 }, estable: false,
    objetos: (ficha.objetos || []).slice(), recursos: {}, espacios: { max: [], usados: [] }, dadosGolpe: { usados: 0 },
    elecciones: ficha.elecciones || (ficha.elecciones = { talentos: {}, mejoras: {} }),
    dañadoPor: [], conc: null };
  Heroes.recalcular(h, true);
  return h;
}

function crearEnemigo(key, def) {
  def = def || MONSTRUOS[key];
  const u = { uid: nuevoUid(), tipo: 'enemigo', bando: 'enemigos', tam: def.tam || 1, vel: def.vel || { camina: 30 },
    key, def, nombre: def.nombre, emoji: def.emoji, pv: def.pv, pvMax: def.pv,
    temp: 0, estados: {}, conc: null, jefe: !!(def.jefe || (def.rasgos || {}).legendarias), mujer: !!def.mujer,
    recargas: (def.especiales || []).map(e => ({ lista: true, usos: e.usos || null })),
    resLegendaria: (def.rasgos || {}).resistenciaLegendaria || 0, legendarias: 0 };
  return u;
}

// =====================================================================
//  JUEGO: EXPEDICIÓN Y COMBATE
// =====================================================================
const Juego = {
  // seleccion: [{ id, jugador }]; opciones: { expedicion, largo, dificultad, modificador }
  iniciar(seleccion, opciones = {}) {
    const { expedicion = 'pantano', largo = 'larga', dificultad = 'normal', modificador = 'ninguno' } = opciones;
    S.grupo = seleccion.map(s => crearHeroe(HEROES.find(h => h.id === s.id), fichaGuardada(s.id), s.jugador));
    const nivel = Math.round(S.grupo.reduce((s, h) => s + h.nivel, 0) / S.grupo.length);
    S.expedicion = Expediciones.crear(expedicion, largo, nivel, S.grupo.length, dificultad);
    Object.assign(S, { dificultad, mod: modificador, combate: 0, logs: [], oro: Progreso.oro || 0, pxGanada: 0,
      pociones: { comun: 0, mayor: 0 }, familiares: [], desbloqueos: [], chisme: false });
    if (modificador === 'resaca') S.grupo.forEach(h => h.pv = Math.ceil(h.pvMax / 2));
    S.atascado = false;
    S.proximo = Expediciones.encuentro(S.expedicion, 0);
    return Juego.iniciarCombate();
  },

  etapa() { return S.expedicion.etapas[Math.min(S.combate, S.expedicion.etapas.length - 1)]; },

  agregarEnemigo(key, def) {
    const e = crearEnemigo(key, def);
    e.iniciativa = Dado.d(20) + (e.def.mods || {}).des;
    e.inicioCombate = { pv: e.pv };
    S.enemigos.push(e);
    const ref = J.buscar(S.actual);
    T.colocarCerca(e, ref && ref.tipo === 'enemigo' ? ref : (J.enemigosVivos().find(x => x !== e) || { x: S.mapa.ancho - 2, y: S.mapa.alto / 2, tam: 1 }));
    // Entra en la iniciativa justo después de quien está actuando.
    const i = S.orden.indexOf(S.actual);
    S.orden.splice(i + 1, 0, e.uid);
    J.log(`Aparece ${e.nombre}.`, 'enemigo');
    return e;
  },

  iniciarCombate() {
    const et = Juego.etapa();
    S.enemigos = S.proximo.map(k => typeof k === 'string' ? crearEnemigo(k) : crearEnemigo(k.key, k.def));
    S.proximo = null; S.chisme = false; S.vencidos = []; S.familiares = [];
    S.fase = 'combate'; S.ronda = 1;
    S.grupo.forEach(h => {
      h.estados = {}; h.temp = 0; h.conc = null; h.dañadoPor = []; h.implacable = 0; h.ataquesRestantes = 0; h.dignidad = 0;
      h.inicioCombate = { pv: h.pv, caido: h.caido };
      if (h.muerto) return;
      Heroes.alIniciarCombate(h);
      if (S.mod === 'chelas') J.estado(h, 'borracho', { expira: { uid: h.uid, cuando: 'fin' } });
    });
    S.enemigos.forEach(e => {
      e.inicioCombate = { pv: e.pv };
      if (S.mod === 'chelas') J.estado(e, 'borracho', { expira: { uid: e.uid, cuando: 'fin' } });
    });
    // Escenario: el grupo entra por la izquierda y los monstruos esperan a la derecha.
    S.mapa = Mapas.generar(et.mapa || 'mazmorra');
    S.mapaImg = null;
    S.grupo.forEach(h => { delete h.x; delete h.y; });
    Mapas.colocar(S.mapa, S.grupo.filter(h => !h.muerto), 'izq', T.ocupado());
    Mapas.colocar(S.mapa, S.enemigos, 'der', T.ocupado());
    // Iniciativa.
    const tirar = u => {
      const t = u.tipo === 'heroe' ? Heroes.iniciativa(u) : { d: Dado.d(20), bono: (u.def.mods || {}).des || 0 };
      u.iniciativa = t.d + t.bono;
      return `${u.nombre} ${u.iniciativa}`;
    };
    const txt = S.grupo.filter(h => !h.muerto).concat(S.enemigos).map(tirar);
    S.orden = S.grupo.filter(h => !h.muerto).concat(S.enemigos)
      .sort((a, b) => b.iniciativa - a.iniciativa || J.mod(b, 'des') - J.mod(a, 'des')).map(u => u.uid);
    S.turnoIdx = -1; S.actual = null;
    J.log(`⚔ Combate ${S.combate + 1} de ${S.expedicion.etapas.length}: ${et.nombre}. ${et.ayuda || ''}`, 'titulo');
    J.log(`🎲 Iniciativa: ${txt.join(' · ')}.`);
    if (Stats) Stats.combates++;
    return Juego.siguienteTurno();
  },

  // ------------------------------------------------------------ turnos
  async siguienteTurno() {
    for (let vueltas = 0; vueltas < 400; vueltas++) {
      if (S.fase !== 'combate') return;
      S.turnoIdx++;
      if (S.turnoIdx >= S.orden.length) {
        S.turnoIdx = 0; S.ronda++;
        if (S.ronda > 40) { J.log('El combate se alarga demasiado: los enemigos se retiran.', 'titulo'); S.atascado = true; S.enemigos.forEach(e => e.pv = 0); Juego.ganarCombate(); return; }
      }
      const u = J.buscar(S.orden[S.turnoIdx]);
      if (!u || (u.tipo !== 'heroe' && !vivo(u)) || u.muerto) continue;
      if (u.tipo === 'familiar' && u.rondas <= 0) continue;
      S.actual = u.uid;
      await Juego.inicioTurno(u);
      if (S.fase !== 'combate') return;
      if (Juego.revisarFin()) return;
      if (u.tipo === 'heroe') {
        if (u.caido) { await Juego.salvacionMuerte(u); await Juego.finTurno(u, true); continue; }
        if (!vivo(u) || J.pierdeTurno(u)) {
          if (vivo(u)) J.log(`${u.nombre} pierde el turno (${J.estadosMalos(u).map(id => CONDICIONES[id].nombre.toLowerCase()).join(', ')}).`);
          await espera(UI.velocidad()); await Juego.finTurno(u, true); continue;
        }
        UI.render();
        if (typeof Bot !== 'undefined' && Bot.controla(u)) { await Bot.turno(u); if (S.fase === 'combate' && S.actual === u.uid) await Juego.finTurno(u, true); continue; }
        return;   // espera al jugador: Juego.terminarTurno()
      }
      UI.render();
      await espera(UI.velocidad());
      if (u.tipo === 'enemigo') await IA.turnoMonstruo(u);
      else await IA.turnoFamiliar(u);
      if (S.fase !== 'combate') return;
      await Juego.finTurno(u, true);
    }
  },

  async inicioTurno(u) {
    u.accion = true; u.adicional = true; u.reaccion = true; u.ataquesRestantes = 0;
    Juego.expirar(u, 'inicio');
    u.mov = T.velocidad(u);
    if (J.tiene(u, 'derribado') && vivo(u)) { J.quitar(u, 'derribado'); u.mov = Math.floor(u.mov / 2); J.log(`${u.nombre} se levanta (gasta la mitad de su movimiento).`); }
    UI.resaltar(u.uid);
    if (u.tipo === 'heroe') {
      if (J.tiene(u, 'sinAdicional')) { u.adicional = false; J.quitar(u, 'sinAdicional'); }
      u.dañadoPorPrev = u.dañadoPor; u.dañadoPor = [];
      await Heroes.alInicioTurno(u);
    }
    if (u.tipo === 'enemigo') {
      const def = u.def;
      u.legendarias = (def.rasgos || {}).legendarias || 0;
      (def.especiales || []).forEach((e, i) => {
        const r = u.recargas[i];
        if (!r.lista && e.recarga && Dado.d(6) >= e.recarga) { r.lista = true; J.log(`✨ ${u.nombre} recarga ${e.nombre}.`, 'enemigo'); }
      });
      if (def.rasgos && def.rasgos.regeneracion && vivo(u) && !u.sinRegenerar && u.pv < u.pvMax) {
        J.log(`${u.nombre} se regenera.`); J.curar(u, def.rasgos.regeneracion);
      }
      u.sinRegenerar = false;
    }
    if (J.tiene(u, 'veneno')) {
      const t = Dado.tirar(u.estados.veneno.valor);
      J.log(`🍶 La chicha le hace efecto a ${u.nombre}.`);
      await J.dañar(u, t.total, 'veneno', J.buscar(u.estados.veneno.fuente), { magico: true });
    }
    if (J.tiene(u, 'nube') && vivo(u)) {
      const n = u.estados.nube;
      if (!await J.salvar(u, 'con', n.cd, { conjuro: true })) {
        J.estado(u, 'incapacitado', { expira: { uid: u.uid, cuando: 'fin' } });
        J.log(`💨 ${u.nombre} se ahoga en la nube apestosa y pierde la acción.`);
      }
    }
  },

  // Borra estados que vencen en el inicio/fin del turno de u.
  expirar(u, cuando) {
    J.todos().forEach(x => Object.keys(x.estados).forEach(id => {
      const e = x.estados[id].expira;
      if (!e || e.uid !== u.uid || e.cuando !== cuando) return;
      if (e.veces === undefined || --e.veces <= 0) delete x.estados[id];
    }));
  },

  async finTurno(u, interno) {
    if (S.fase !== 'combate') return;
    // Salvaciones que se repiten al final del turno.
    for (const id of Object.keys(u.estados)) {
      const st = u.estados[id];
      if (st && st.salvar && vivo(u)) {
        if (await J.salvar(u, st.salvar.atr, st.salvar.cd, { conjuro: !!st.conc })) { delete u.estados[id]; J.log(`${u.nombre} se libra de ${CONDICIONES[id].nombre.toLowerCase()}.`); }
      }
    }
    if (J.tiene(u, 'acido') && vivo(u)) {
      const t = Dado.tirar(u.estados.acido.valor); J.quitar(u, 'acido');
      await J.dañar(u, t.total, 'ácido', J.buscar(u.estados.acido && u.estados.acido.fuente), { magico: true });
    }
    Juego.expirar(u, 'fin');
    if (u.tipo === 'familiar') { u.rondas--; if (u.rondas <= 0) { J.log(`${u.nombre} regresa al Legendarium.`); u.pv = 0; } }
    if (Juego.revisarFin()) return;
    // Acciones legendarias tras el turno de cada héroe.
    if (u.tipo === 'heroe') {
      for (const e of J.enemigosVivos().filter(e => e.legendarias > 0 && !J.incapacitado(e))) {
        await espera(UI.velocidad() / 2);
        await IA.accionLegendaria(e);
        if (Juego.revisarFin()) return;
      }
    }
    UI.render();
    if (!interno) return Juego.siguienteTurno();
  },

  // El jugador termina el turno del héroe activo.
  async terminarTurno() {
    const u = J.buscar(S.actual);
    if (!u || u.tipo !== 'heroe' || S.fase !== 'combate' || S.ocupado) return;
    S.ocupado = true;
    try { await Juego.finTurno(u, true); } finally { S.ocupado = false; }
    if (S.fase === 'combate') await Juego.siguienteTurno();
  },

  async salvacionMuerte(h) {
    if (h.muerto || h.estable) return;
    const d = Dado.d(20);
    await UI.dado(h, d, 0, d >= 10 ? 'éxito' : 'fallo', { vs: 'CD', meta: 10, det: `${d}`, salv: 'muerte', exito: d >= 10 });
    if (d === 20) { h.caido = false; h.pv = 1; J.log(`✨ ${h.nombre} saca 20 en su salvación de muerte: ¡se levanta con 1 PV!`, 'crit'); return; }
    if (d === 1) h.salvMuerte.f += 2; else if (d >= 10) h.salvMuerte.e++; else h.salvMuerte.f++;
    J.log(`💀 ${h.nombre} tira salvación de muerte: ${d} (${h.salvMuerte.e} éxitos, ${h.salvMuerte.f} fallos).`, d >= 10 ? '' : 'muerte');
    if (h.salvMuerte.f >= 3) J.morirHeroe(h);
    else if (h.salvMuerte.e >= 3) { h.estable = true; J.log(`${h.nombre} queda estable.`); }
  },

  // --------------------------------------------- acciones de los héroes
  // ¿Puede el héroe usar esta habilidad ahora? Devuelve el motivo si no.
  bloqueo(h, a) {
    if (S.fase !== 'combate' || S.actual !== h.uid) return 'No es su turno';
    if (!consciente(h) || J.pierdeTurno(h)) return 'No puede actuar';
    if (a.tipo === 'reaccion' || a.tipo === 'pasiva') return 'Se usa sola cuando corresponde';
    if (a.tipo === 'accion' && !h.accion && !(a.esAtaque && h.ataquesRestantes > 0)) return 'Ya usó su acción';
    if (a.esAtaque && !h.accion && h.ataquesRestantes <= 0) return 'No le quedan ataques';
    if (a.tipo === 'adicional' && !h.adicional) return 'Ya usó su acción adicional';
    if (a.tipo === 'gesta' && J.recurso(h, 'gesta') <= 0) return 'Ya usó su Gesta en esta expedición';
    if (a.tipo === 'gesta' && !h.accion) return 'La Gesta necesita su acción';
    if (a.espacio && !J.espacioLibre(h, a.espacio)) return `No le quedan espacios de nivel ${a.espacio} o más`;
    if (a.recurso && J.recurso(h, a.recurso) < (a.cuantos || 1)) return 'No le quedan usos';
    if (a.conjuro || a.espacio) { const v = J.verbalBloqueado(h); if (v) return v; }
    if (a.insulto) { const v = J.insultoBloqueado(h); if (v) return v; }
    return a.requisito ? a.requisito(J, h) : null;
  },

  // Objetivos de una habilidad según su tipo:
  //   'enemigo' / 'aliado'  una criatura (objUid) al alcance y a la vista
  //   'area'                una casilla (celda); se afecta a todas las criaturas dentro
  //   'enemigos' / 'aliados' todas las del bando a 'alcance' (hasta a.max)
  //   'celda'               una casilla libre a 'alcance' (teletransporte)
  //   'yo'                  nada
  objetivos(h, a, objUid, celda) {
    if (Heroes.necesitaObjetivo(a)) { const t = J.buscar(objUid); return Heroes.objetivoValido(J, h, a, t) ? t : undefined; }
    if (a.objetivo === 'area') {
      const ar = Heroes.area(h, a);
      if (ar.forma === 'aura') return Heroes.enArea(h, a, null);
      if (!celda || !Heroes.puntoValido(h, a, celda)) return undefined;
      return Heroes.enArea(h, a, celda);
    }
    if (a.objetivo === 'celda') return celda && Heroes.celdaValida(h, a, celda) ? celda : undefined;
    if (a.objetivo === 'enemigos' || a.objetivo === 'aliados') return Heroes.grupoObjetivo(h, a);
    return h;
  },

  async usar(huid, id, objUid, celda) {
    const h = J.buscar(huid);
    const a = Heroes.habilidades(h).find(x => x.id === id);
    if (!a || Juego.bloqueo(h, a) || S.ocupado) return;
    const obj = Juego.objetivos(h, a, objUid, celda);
    if (obj === undefined) return;
    S.ocupado = true;
    try {
      // Coste: acción, ataque de la acción de Atacar, adicional, gesta.
      if (a.esAtaque) {
        if (h.ataquesRestantes <= 0) { h.accion = false; h.ataquesRestantes = Heroes.ataquesPorAccion(h); }
        h.ataquesRestantes--;
      } else if (a.tipo === 'accion' || a.tipo === 'gesta') { h.accion = false; h.ataquesRestantes = 0; }
      else if (a.tipo === 'adicional') h.adicional = false;
      if (a.tipo === 'gesta') { J.usarRecurso(h, 'gesta'); J.log(`★ ${h.nombre} desata su Gesta: ${a.nombre}!`, 'crit'); UI.anuncio(h, a.nombre); }
      else J.log(`${h.nombre} usa ${a.nombre}${obj && obj.nombre && obj !== h ? ' sobre ' + obj.nombre : Array.isArray(obj) ? ` (${obj.length} criatura${obj.length === 1 ? '' : 's'})` : ''}.`, 'accion');
      let nivelEspacio = 0;
      if (a.espacio) nivelEspacio = J.gastarEspacio(h, a.espacio);
      if (a.recurso) J.usarRecurso(h, a.recurso, a.cuantos || 1);
      if (a.insulto) await J.insulto(h);
      if (a.concentracion) h.concNueva = J.concentrar(h, a.nombre);
      if (Stats) Stats.uso(h, a);
      await UI.conjuro(h, a, obj, celda);
      await a.efecto(J, h, obj, nivelEspacio);
      h.concNueva = null;
      if (a.concentracion && h.conc && !J.todos().some(x => Object.values(x.estados).some(st => st.conc === h.conc.id))) J.romperConcentracion(h, true);
    } finally { S.ocupado = false; }
    if (!Juego.revisarFin()) UI.render();
  },

  // El héroe activo camina hasta una casilla.
  async mover(huid, x, y) {
    const h = J.buscar(huid);
    if (!h || S.actual !== h.uid || S.ocupado || !consciente(h) || J.pierdeTurno(h)) return;
    S.ocupado = true;
    try { await T.mover(h, x, y); } finally { S.ocupado = false; }
    if (!Juego.revisarFin()) UI.render();
  },

  // ------------------------------------------------------------- fin
  revisarFin() {
    if (S.fase !== 'combate') return true;
    S.enemigos = S.enemigos.filter(vivo);
    if (!J.heroesConscientes().length) { Juego.derrota(); return true; }
    if (!J.enemigosVivos().length) { Juego.ganarCombate(); return true; }
    return false;
  },

  derrota() {
    S.fase = 'derrota';
    J.log('El grupo ha caído.', 'muerte');
    Juego.guardarFichas();
    UI.render();
  },

  ganarCombate() {
    if (S.fase !== 'combate') return;
    S.vencidos.push(...S.enemigos.filter(e => vivo(e) && J.tiene(e, 'desterrado')));
    // Experiencia del encuentro: la de cada monstruo por el multiplicador de la Guía.
    const vivosGrupo = S.grupo.filter(h => !h.muerto).length;
    const px = Math.round(S.vencidos.reduce((s, e) => s + (R5.PX_ND[e.def.nd] || 0), 0) * R5.multiplicador(S.vencidos.length, vivosGrupo));
    const oro = Math.round(px / 4 * (0.6 + Math.random() * 0.8)) * (S.mod === 'luna' ? 2 : 1);
    const vivos = S.grupo.filter(h => !h.muerto);
    const porHeroe = Math.floor(px * (S.mod === 'resaca' ? 1.5 : 1) / Math.max(1, vivos.length));
    vivos.forEach(h => h.px += porHeroe);
    S.oro += oro; S.pxGanada += porHeroe;
    S.ultimoBotin = { px: porHeroe, oro };
    J.log(`🏆 Combate ganado: ${porHeroe} PX para cada héroe en pie y ${oro} de oro.`, 'crit');
    // Los caídos se estabilizan al terminar el combate.
    S.grupo.forEach(h => { if (h.caido && !h.muerto) { h.caido = false; h.pv = 1; } h.estados = {}; h.conc = null; h.temp = 0; });
    S.familiares = [];
    S.combate++;
    if (S.combate >= S.expedicion.etapas.length) {
      S.fase = 'victoria';
      const bono = Math.round(S.pxGanada * 0.2);
      S.grupo.filter(h => !h.muerto).forEach(h => h.px += bono);
      S.pxGanada += bono;
      J.log(`🎖 Bono por completar la expedición: +${bono} PX para cada héroe.`, 'crit');
      J.log(`🎉 ${S.expedicion.victoria()}`, 'crit');
      Juego.registrarVictoria();
    } else {
      S.fase = 'botin';
      S.proximo = Expediciones.encuentro(S.expedicion, S.combate);
    }
    UI.render();
  },

  // -------------------------------------------- taberna (descanso corto)
  irTaberna() { S.fase = 'taberna'; Heroes.descansoCorto(); UI.render(); },
  // elec: { talento, mejora } elegidos en la pantalla de subida; sin elec, elige el bot.
  subirNivel(huid, elec) {
    const h = J.buscar(huid);
    if (!h || h.nivel >= R5.NIVEL_MAX || h.px < R5.PX_NIVEL[h.nivel + 1]) return;
    const antes = h.pvMax;
    h.nivel++;
    Heroes.elegir(h, h.nivel, elec || Heroes.eleccionAuto(h, h.nivel));
    Heroes.recalcular(h);
    h.pv += h.pvMax - antes;
    J.log(`⬆ ${h.nombre} sube a nivel ${h.nivel}. ${Heroes.novedades(h).join(' · ')}`, 'crit');
    UI.anuncio(h, `¡Nivel ${h.nivel}!`);
    UI.render();
  },
  // Talento de un nivel ya alcanzado (subió en el descanso largo o venía de antes).
  elegirPendiente(huid, n, elec) {
    const h = J.buscar(huid);
    if (!h || n > h.nivel) return;
    const antes = h.pvMax;
    Heroes.elegir(h, n, elec);
    Heroes.recalcular(h);
    h.pv += Math.max(0, h.pvMax - antes);
    J.log(`★ ${h.nombre} elige ${TALENTOS.find(x => x.id === elec.talento).nombre} (nivel ${n}).`, 'crit');
    UI.render();
  },
  gastarDadoGolpe(huid) {
    const h = J.buscar(huid);
    if (!h || h.muerto || h.dadosGolpe.usados >= h.nivel || h.pv >= h.pvMax) return;
    h.dadosGolpe.usados++;
    const v = Math.max(1, Dado.d(h.def.dadoGolpe) + J.mod(h, 'con'));
    const bardo = S.grupo.find(b => !b.muerto && J.rasgo(b, 'cancionDescanso'));
    let extra = 0;
    if (bardo && !h.cancionUsada) { extra = Dado.d(R5.prof(bardo.nivel) >= 3 ? 8 : 6); h.cancionUsada = true; }
    J.curar(h, v + extra);
    J.log(`${h.nombre} gasta un dado de golpe: +${v}${extra ? ` y +${extra} por la canción de ${bardo.nombre}` : ''}.`);
    UI.render();
  },
  comprar(id, uid) {
    const item = TABERNA.find(t => t.id === id);
    if (!item || S.oro < item.precio) return;
    const h = uid ? J.buscar(uid) : null;
    if (id === 'revivir' && (!h || !h.muerto)) return;
    let objeto = null;
    if (id === 'objeto') { objeto = h && OBJETOS.find(o => o.heroe === h.def.id); if (!objeto || J.tieneObjeto(h, objeto.id)) return; }
    if (id === 'chisme' && S.chisme) return;
    S.oro -= item.precio;
    if (id === 'pocion') S.pociones.comun++;
    if (id === 'pocionMayor') S.pociones.mayor++;
    if (id === 'revivir') { h.muerto = false; h.caido = false; h.pv = 1; h.salvMuerte = { e: 0, f: 0 }; J.log(`✨ ${h.nombre} vuelve a la vida con 1 PV.`, 'crit'); }
    if (id === 'objeto') { h.objetos.push(objeto.id); fichaGuardada(h.def.id).objetos = h.objetos.slice(); J.log(`${h.nombre} consigue ${objeto.nombre}.`); }
    if (id === 'chisme') { S.chisme = true; J.log('El tabernero cuenta lo que se viene.'); }
    if (id === 'apuesta') Juego.apuesta();
    UI.render();
  },
  apuesta() {
    const d = Dado.d(20);
    if (d === 1) { const q = Math.min(S.oro, 40); S.oro -= q; J.log(`🍻 Sacaron 1: les toca invitar la ronda (-${q} de oro).`, 'muerte'); }
    else if (d < 10) J.log(`Sacaron ${d}: el tabernero se queda con la apuesta.`);
    else if (d < 18) { S.oro += 50; J.log(`Sacaron ${d}: ¡ganaron 50 de oro!`, 'crit'); }
    else if (d < 20) { S.pociones.comun++; S.oro += 25; J.log(`Sacaron ${d}: 25 de oro y una poción de curación.`, 'crit'); }
    else { S.oro += 100; S.grupo.forEach(h => { if (!h.muerto) J.curar(h, 10); }); J.log('¡20 natural! Chicha especial de la casa: +100 de oro y +10 PV para todos.', 'crit'); }
  },
  continuar() { S.grupo.forEach(h => h.cancionUsada = false); return Juego.iniciarCombate(); },

  // -------------------------------------------------------- progreso
  // Descanso largo al terminar la expedición: se guardan las fichas y suben los niveles pendientes.
  guardarFichas() {
    S.grupo.forEach(h => {
      const f = fichaGuardada(h.def.id);
      while (h.nivel < R5.NIVEL_MAX && h.px >= R5.PX_NIVEL[h.nivel + 1]) { h.nivel++; J.log(`⬆ ${h.nombre} sube a nivel ${h.nivel} con el descanso largo.`, 'crit'); }
      f.nivel = h.nivel; f.px = h.px; f.objetos = h.objetos.slice();
    });
    Progreso.oro = S.oro;
    guardarProgreso();
  },
  registrarVictoria() {
    const nuevos = [];
    if ((S.dificultad === 'normal' || S.dificultad === 'dificil') && !Progreso.normal && !Progreso.dificil) nuevos.push('Modificador: Luna llena');
    if (S.dificultad === 'normal') Progreso.normal = true;
    if (S.dificultad === 'dificil') { if (!Progreso.dificil) nuevos.push('Modificador: Resaca'); Progreso.dificil = true; }
    Progreso.victorias = (Progreso.victorias || 0) + 1;
    S.desbloqueos = nuevos;
    Juego.guardarFichas();
  },
};

// =====================================================================
//  IA DE LOS MONSTRUOS (con tablero)
//  En su turno cada monstruo: usa su aliento o conjuro si está listo y
//  atrapa a varios héroes (moviéndose para apuntar), o se acerca y ataca
//  cuerpo a cuerpo, o dispara desde lejos. Si no llega a nadie, corre.
// =====================================================================
const IA = {
  objetivos(e) {
    let lista = J.aliados().filter(a => T.enTablero(a));
    if (J.tiene(e, 'hechizado')) lista = lista.filter(a => a.uid !== e.estados.hechizado.fuente);
    return lista;
  },
  // Preferencia por objetivo (más alto = mejor).
  interes(e, t) {
    let p = 10 - t.pv / Math.max(1, t.pvMax) * 4;
    if (J.tiene(e, 'provocado') && e.estados.provocado.fuente === t.uid) p += 8;
    if (t.def && t.def.provoca) p += 5;
    if (e.def.rasgos && e.def.rasgos.tacticasManada) p += (1 - t.pv / t.pvMax) * 6;
    if (J.tiene(e, 'hechizado') && e.estados.hechizado.fuente === t.uid) p -= 100;
    return p + Math.random() * 2;
  },
  mediaAtaque(a) { return Dado.media(a.daño); },
  llega(e, a, t, pos = e) {
    const d = Mapas.dist(pos, t);
    if (a.alcance && d * 5 <= a.alcance) return 'cc';
    if (a.rango && d * 5 <= a.rango && Mapas.seVen(S.mapa, pos, t)) return 'dist';
    return null;
  },
  mejorIndice(e) {
    let mejor = 0;
    e.def.ataques.forEach((a, i) => { if (a.alcance && IA.mediaAtaque(a) > IA.mediaAtaque(e.def.ataques[mejor])) mejor = i; });
    return mejor;
  },

  async turnoMonstruo(e) {
    if (J.pierdeTurno(e)) { J.log(`${e.nombre} pierde el turno (${J.estadosMalos(e).filter(id => CONDICIONES[id].pierdeTurno).map(id => CONDICIONES[id].nombre.toLowerCase()).join(', ')}).`); return; }
    if (J.tiene(e, 'confundido')) {
      const d = Dado.d(10);
      if (d <= 6) { J.log(`❓ ${e.nombre} está confundido y no hace nada (${d}).`); return; }
      if (d <= 8) {
        const cerca = J.todos().filter(x => T.enTablero(x) && x !== e && !x.caido && Mapas.dist(e, x) <= 1);
        const t = J.azar(cerca);
        if (t) { J.log(`❓ ${e.nombre}, confundido, ataca a ${t.nombre}.`); await IA.atacar(e, t, e.def.ataques[IA.mejorIndice(e)]); }
        else J.log(`❓ ${e.nombre} da vueltas confundido.`);
        return;
      }
    }
    if (!IA.objetivos(e).length) return;
    if (e.def.rayos) { await IA.rayos(e); return; }
    const plan = IA.planEspecial(e);
    if (plan) { await IA.usarEspecial(e, plan); return; }
    await IA.planAtaque(e);
  },

  // ------------------------------------------------------- alientos y conjuros
  planEspecial(e) {
    const objetivos = IA.objetivos(e);
    let mejor = null;
    (e.def.especiales || []).forEach((x, i) => {
      const r = e.recargas[i];
      if (!r.lista || (r.usos !== null && r.usos <= 0)) return;
      if (x.verbal && J.verbalBloqueado(e)) return;
      const alc = T.alcanzables(e);
      // Posiciones a probar: donde está y las alcanzables más cercanas a los héroes.
      const pos = [...alc.values()].filter(v => !v.paso)
        .map(v => ({ v, d: Math.min(...objetivos.map(t => Mapas.dist({ x: v.x, y: v.y, tam: e.tam }, t))) }))
        .sort((a, b) => a.d - b.d).slice(0, 24).map(o => o.v);
      pos.unshift({ x: e.x, y: e.y, costo: 0 });
      for (const v of pos) {
        const desde = { x: v.x, y: v.y, tam: e.tam, vel: e.vel };
        const apuntes = x.forma === 'aura' ? [null] : objetivos;
        for (const t of apuntes) {
          let afect;
          if (!x.forma) {
            if (Mapas.dist(desde, t) * 5 > (x.alcance || 60) || !Mapas.seVen(S.mapa, desde, t)) continue;
            afect = [t];
          } else {
            const punto = t ? { x: t.x, y: t.y } : null;
            if (x.forma === 'radio' && (Mapas.dist(desde, t) * 5 > (x.alcance || 60) || !Mapas.seVen(S.mapa, desde, t))) continue;
            const set = Mapas.area(S.mapa, x.forma, x.tam || 15, desde, punto);
            afect = J.todos().filter(u => T.enTablero(u) && u !== e && Mapas.enArea(u, set));
          }
          const heroes = afect.filter(u => u.bando === 'grupo' && !u.caido).length;
          const amigos = afect.filter(u => u.bando === 'enemigos').length;
          const valor = heroes - amigos * 0.6 - v.costo * 0.02;
          if (heroes && (!mejor || valor > mejor.valor)) mejor = { i, x, v, punto: t ? { x: t.x, y: t.y } : null, objetivo: t, valor, heroes };
        }
      }
    });
    if (!mejor) return null;
    const minimo = mejor.x.forma ? Math.min(2, objetivos.length) : 1;
    if (mejor.heroes < minimo) return null;
    return Math.random() < (mejor.x.forma ? 0.9 : 0.6) ? mejor : null;
  },

  async usarEspecial(e, p) {
    const r = e.recargas[p.i];
    await T.mover(e, p.v.x, p.v.y);
    if (!vivo(e) || J.incapacitado(e)) return;
    if (p.x.verbal && await IA.contrahechizo(e, p.x)) { if (r.usos !== null) r.usos--; return; }
    if (p.x.recarga) r.lista = false;
    if (r.usos !== null) r.usos--;
    let afect, set;
    if (!p.x.forma) afect = [p.objetivo];
    else {
      set = Mapas.area(S.mapa, p.x.forma, p.x.tam || 15, e, p.punto);
      S.areaVista = { set, hasta: Date.now() + 1200 };
      afect = J.todos().filter(u => T.enTablero(u) && u !== e && Mapas.enArea(u, set));
    }
    await IA.especial(e, p.x, afect, set);
  },

  async rayos(e) {
    let objetivos = IA.objetivos(e).filter(t => Mapas.dist(e, t) * 5 <= 120 && Mapas.seVen(S.mapa, e, t));
    if (!objetivos.length) {
      const t = IA.objetivos(e).sort((a, b) => Mapas.dist(e, a) - Mapas.dist(e, b))[0];
      const ac = t && T.acercarse(e, t, e.mov);
      if (ac) await T.mover(e, ac.v.x, ac.v.y, { alc: ac.alc });
      objetivos = IA.objetivos(e).filter(t => Mapas.dist(e, t) * 5 <= 120 && Mapas.seVen(S.mapa, e, t));
    }
    const rs = barajar(e.def.rayos.lista.slice()).slice(0, e.def.rayos.cantidad);
    for (const r of rs) {
      const vivos = objetivos.filter(t => T.enTablero(t) && !t.caido);
      if (!vivos.length) break;
      await IA.especial(e, r, [J.azar(vivos)]);
      if (Juego.revisarFin()) return;
    }
    const t = IA.objetivos(e).find(t => Mapas.dist(e, t) <= 1);
    if (t) await IA.atacar(e, t, IA.mejorAtaque(e));
  },

  // ------------------------------------------------------------- ataques
  async planAtaque(e) {
    const objetivos = IA.objetivos(e);
    const ataques = e.def.ataques;
    const cc = ataques.filter(a => a.alcance);
    const dist = ataques.filter(a => a.rango);
    const alc = T.alcanzables(e);
    const reach = Math.max(0, ...cc.map(a => a.alcance));
    // Tirador: si su mejor ataque es a distancia y tiene a alguien a tiro, dispara.
    const tirador = dist.length && (!cc.length || Dado.media(dist[0].daño) >= Dado.media(cc[0].daño) * 0.9);
    let mejor = null;
    for (const t of objetivos) {
      const interes = IA.interes(e, t);
      if (cc.length && !tirador) {
        const v = T.casillaPara(e, t, reach, { alc });
        if (v && (!mejor || interes - v.costo * 0.3 > mejor.p)) mejor = { t, v, modo: 'cc', p: interes - v.costo * 0.3 };
      }
      if (dist.length) {
        const v = T.casillaPara(e, t, dist[0].rango, { alc, lejos: true });
        const p = interes - (tirador ? 0 : 3);
        if (v && (!mejor || p > mejor.p)) mejor = { t, v, modo: 'dist', p };
      }
    }
    if (!mejor) {
      // Nadie al alcance: corre hacia el héroe más cercano.
      const t = objetivos.sort((a, b) => Mapas.dist(e, a) - Mapas.dist(e, b))[0];
      if (!t) return;
      const ac = T.acercarse(e, t, e.mov * 2);
      if (ac) { J.log(`${e.nombre} corre hacia ${t.nombre}.`, 'enemigo'); e.mov *= 2; await T.mover(e, ac.v.x, ac.v.y, { alc: ac.alc }); }
      return;
    }
    await T.mover(e, mejor.v.x, mejor.v.y, { alc });
    if (!vivo(e) || J.incapacitado(e)) return;
    await IA.ejecutarAtaques(e, mejor.t, mejor.modo);
  },

  // Multiataque respetando el alcance de cada ataque.
  async ejecutarAtaques(e, t, modo) {
    const plan = e.def.multi && e.def.multi.length ? e.def.multi : [[modo === 'dist' ? e.def.ataques.indexOf(e.def.ataques.find(a => a.rango)) : IA.mejorIndice(e), 1]];
    for (const [idx, veces] of plan) {
      const a = e.def.ataques[idx] || e.def.ataques[0];
      for (let k = 0; k < veces; k++) {
        if (!t || !T.enTablero(t) || (t.tipo === 'heroe' && t.caido) || !IA.llega(e, a, t)) {
          t = IA.objetivos(e).filter(x => IA.llega(e, a, x)).sort((p, q) => IA.interes(e, q) - IA.interes(e, p))[0];
        }
        if (!t) break;
        await IA.atacar(e, t, a);
        if (Juego.revisarFin()) return;
      }
    }
  },
  mejorAtaque(e) { return e.def.ataques[IA.mejorIndice(e)]; },

  async atacar(e, t, a) {
    UI.resaltar(e.uid);
    const daño = a.daño.map(p => Object.assign({}, p));
    if (S.mod === 'luna' && daño[0]) daño[0].mas = (daño[0].mas || 0) + 2;
    const cerca = !!(a.alcance && Mapas.dist(e, t) * 5 <= a.alcance) || !a.rango;
    await J.ataque(e, t, { nombre: a.nombre, bono: a.bono, daño, distancia: !cerca, efecto: a.efecto });
  },

  async especial(e, x, objetivos, set) {
    J.log(`💥 ${e.nombre} usa ${x.nombre}${objetivos.length > 1 ? ` (${objetivos.length} criaturas)` : objetivos[0] ? ' contra ' + objetivos[0].nombre : ''}.`, 'enemigo');
    UI.anuncio(e, x.nombre);
    await UI.especial(e, x, objetivos, set);
    const tir = x.daño && x.daño.length ? Dado.tirar(x.daño) : null;
    if (tir) J.log(`🎲 Daño: ${tir.trozos.map(t => t.texto + ' ' + t.tipo).join(' + ')} = ${tir.total} (CD ${x.cd} ${R5.CORTO_ATR[x.salv]}${x.mitad ? ', mitad si salva' : ''}).`);
    for (const t of objetivos) {
      if (!t || !T.enTablero(t) || (t.tipo !== 'heroe' && !vivo(t))) continue;
      const salvo = await J.salvar(t, x.salv, x.cd, { fuente: e, magico: true, conjuro: x.verbal });
      if (tir) {
        const factor = salvo ? (x.mitad ? 0.5 : 0) : 1;
        if (factor) await J.dañarTrozos(t, tir.trozos.map(tr => ({ suma: Math.floor(tr.suma * factor), tipo: tr.tipo })), e, { magico: true });
      }
      if (!salvo && x.condicion && vivo(t)) {
        if (x.condicion === 'caer0') { J.log(`☠ El lamento deja a ${t.nombre} sin vida.`, 'muerte'); await J.aplicarDaño(t, t.pv + (t.temp || 0), e); continue; }
        if (J.estado(t, x.condicion, { fuente: e.uid, expira: { uid: t.uid, cuando: 'fin', veces: 10 }, salvar: { atr: x.salv, cd: x.cd } }))
          J.log(`${t.nombre} queda ${CONDICIONES[x.condicion].nombre.toLowerCase()}.`, 'muerte');
      }
    }
  },

  async contrahechizo(e, x) {
    const g = S.grupo.find(h => J.puedeReaccionar(h) && J.habilidad(h, 'contrahechizo') && J.espacioLibre(h, 3) && !J.verbalBloqueado(h) && T.enAlcance(h, e, 60));
    if (!g) return false;
    if (!await UI.preguntar(g, 'Refutación (Contrahechizo)', `${e.nombre} va a usar ${x.nombre}. ¿${g.nombre} lo refuta con un espacio de nivel 3?`, 'contrahechizo', { e, x })) return false;
    g.reaccion = false; J.gastarEspacio(g, 3);
    let ok = true;
    if (e.def.nd > 6) {
      const d = Dado.d(20), tot = d + J.mod(g, 'int'), cd = 10 + Math.min(9, Math.floor(e.def.nd / 2));
      ok = tot >= cd;
      J.log(`🎲 ${g.nombre} intenta refutar: ${d}+${J.mod(g, 'int')} = ${tot} vs ${cd}.`);
    }
    if (ok) { J.log(`🧮 ${g.nombre} refuta a ${e.nombre}: ${x.nombre} no ocurre.`, 'crit'); UI.flotante(e.uid, 'REFUTADO', 'info'); }
    return ok;
  },

  // Acción legendaria: un ataque barato contra alguien que ya tenga al alcance.
  async accionLegendaria(e) {
    const opciones = e.def.ataques.slice().sort((a, b) => IA.mediaAtaque(a) - IA.mediaAtaque(b));
    for (const a of opciones) {
      const t = IA.objetivos(e).filter(t => IA.llega(e, a, t)).sort((p, q) => IA.interes(e, q) - IA.interes(e, p))[0];
      if (!t) continue;
      e.legendarias--;
      J.log(`👑 Acción legendaria de ${e.nombre}.`, 'enemigo');
      await IA.atacar(e, t, a);
      return;
    }
  },

  // Familiares: los de cuerpo a cuerpo se acercan al enemigo más débil.
  async turnoFamiliar(f) {
    if (!vivo(f)) return;
    UI.resaltar(f.uid);
    if (f.def.cc) {
      const t = J.enemigosVivos().filter(T.enTablero).sort((a, b) => Mapas.dist(f, a) - Mapas.dist(f, b))[0];
      if (t && Mapas.dist(f, t) > 1) { const v = T.casillaPara(f, t, 5) || (T.acercarse(f, t, f.mov) || {}).v; if (v) await T.mover(f, v.x, v.y); }
    }
    await f.def.accion(J, f, f.invocador);
  },
};
