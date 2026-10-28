// =====================================================================
//  MAGIC PACHEK - los héroes como personajes de D&D 5e (niveles 1 a 12)
//
//  Cada héroe tiene características (base + mejoras en los niveles 4, 8
//  y 12), dado de golpe, salvaciones con competencia, CA, armas,
//  recursos de clase y habilidades que se desbloquean por nivel.
//  Al subir de nivel el jugador elige un talento (TALENTOS) y, en los
//  niveles con mejora, cómo reparte los 2 puntos de característica.
//  Las elecciones se guardan en la ficha: elecciones.talentos[nivel] e
//  elecciones.mejoras[nivel].
//
//  Habilidad:
//    tipo      'accion' | 'adicional' | 'reaccion' | 'pasiva' | 'gesta'
//    esAtaque  cuenta como uno de los ataques de la acción de Atacar
//    objetivo  'enemigo' | 'aliado' | 'yo' | 'enemigos' | 'aliados'
//    filtro    (J, h, t) -> ¿puede apuntar a t?
//    espacio   nivel mínimo de espacio de conjuro que gasta
//    recurso   recurso de clase que gasta (furia, inspiracion...)
//    conjuro   lo bloquea el Silencio · insulto: indigna a Guille y lo
//              bloquea la Dignidad · concentracion
//    texto(h)  descripción con los números de su nivel
//    efecto    async (J, h, objetivo, nivelDeEspacio)
//    ia(J, h)  [puntos, objetivo] para los bots del simulador
//  Las reacciones (Escudo, Defensa Tanque, Reprensión, Contrahechizo) y
//  los rasgos pasivos los dispara motor.js cuando corresponde.
// =====================================================================

// ---------------------------------------------------- ayudas comunes
const H = {
  cd: (J, h) => J.cd(h),
  truco: (h, caras) => `${R5.escalaTruco(h.nivel)}d${caras}`,
  dadoInspiracion: h => h.nivel >= 10 ? 10 : h.nivel >= 5 ? 8 : 6,

  // Ataque con arma: bono = característica + competencia (+ magia).
  async arma(J, h, obj, arma, o = {}) {
    const atr = arma.atr === 'fino' ? (J.mod(h, 'fue') >= J.mod(h, 'des') ? 'fue' : 'des') : arma.atr;
    const m = J.mod(h, atr);
    const magia = (arma.magia ? arma.magia(h) : 0) + (J.tieneObjeto(h, 'lentes') ? 1 : 0);
    const daño = Dado.leer(arma.dados, arma.tipo);
    daño[0].mas = m + magia + Heroes.talento(h, 'filo');
    // Cuerpo a cuerpo si el objetivo está al alcance del arma; si no, a distancia.
    const cerca = !!arma.alcance && (!obj || obj.x === undefined || Mapas.dist(h, obj) * 5 <= arma.alcance);
    const extra = [];
    if (J.tiene(h, 'furia') && atr === 'fue' && cerca) extra.push({ n: 0, caras: 0, mas: h.nivel >= 9 ? 3 : 2, tipo: arma.tipo });
    if (J.tiene(h, 'rush')) { extra.push({ n: 2 + (h.nivel >= 5) + (h.nivel >= 11), caras: 6, mas: 0, tipo: arma.tipo }); J.log('⚡ ¡Rush! Coco siempre gana la iniciativa.'); }
    if (J.rasgo(h, 'castigoMejorado') && cerca) extra.push({ n: 1, caras: 8, mas: 0, tipo: 'radiante' });
    if (J.tiene(h, 'manto')) extra.push({ n: 1, caras: 4, mas: 0, tipo: 'radiante' });
    return J.ataque(h, obj, { nombre: arma.nombre, bono: m + J.prof(h) + magia, daño, extra, distancia: !cerca, magico: magia > 0,
      async alImpactar(res, t) {
        if (res.crit && (J.rasgo(h, 'ataquesSalvajes') || J.rasgo(h, 'criticoBrutal')) && cerca) {
          const dados = (J.rasgo(h, 'ataquesSalvajes') ? 1 : 0) + (J.rasgo(h, 'criticoBrutal') ? 1 : 0);
          const v = Dado.tirar(`${dados}${arma.dados.slice(1)}`).total;
          J.log(`💥 Crítico salvaje: +${v}.`); await J.dañar(t, v, arma.tipo, h);
        }
        if (arma.alImpactar && vivo(t)) await arma.alImpactar(J, h, t, res);
        if (o.alImpactar && vivo(t)) await o.alImpactar(res, t);
      } });
  },

  // Daño extra de Guille por indignación o Dignidad Desatada.
  extraConjuro(J, h, tipo) {
    let x = 0;
    if (J.tiene(h, 'indignado')) { x += J.mod(h, 'int'); J.quitar(h, 'indignado'); }
    if (J.tiene(h, 'dignidad')) x += 2 * J.mod(h, 'int');
    if (J.rasgo(h, 'sabioAlquimista') && ['ácido', 'veneno', 'fuego'].includes(tipo)) x += J.mod(h, 'int');
    if (h.tipo === 'heroe') x += Heroes.talento(h, 'arcano');
    return x;
  },

  async ataqueConjuro(J, h, obj, dados, tipo, o = {}) {
    const daño = Dado.leer(dados, tipo);
    daño[0].mas = (daño[0].mas || 0) + H.extraConjuro(J, h, tipo);
    return J.ataque(h, obj, { nombre: o.nombre || 'conjuro', bono: J.bonoConjuro(h), daño, distancia: true, magico: true, alImpactar: o.alImpactar });
  },

  // Conjuro de salvación sobre varios objetivos (una sola tirada de daño).
  // o: { mitad, condicion, dur(t), alFallar(t), alSalvar(t) }
  async salvacion(J, h, objetivos, atr, dados, tipo, o = {}) {
    const cd = J.cd(h);
    let tir = null;
    if (dados) {
      const partes = Dado.leer(dados, tipo);
      partes[0].mas = (partes[0].mas || 0) + H.extraConjuro(J, h, tipo);
      tir = Dado.tirar(partes);
      J.log(`🎲 Daño: ${tir.trozos.map(t => t.texto + ' ' + t.tipo).join(' + ')} = ${tir.total}.`);
    }
    const fallaron = [];
    for (const t of objetivos) {
      if (!vivo(t)) continue;
      const salvo = await J.salvar(t, atr, cd, { fuente: h, conjuro: true, magico: true });
      if (tir) {
        const f = salvo ? (o.mitad ? 0.5 : 0) : 1;
        if (f) { const d = await J.dañarTrozos(t, tir.trozos.map(x => ({ suma: Math.floor(x.suma * f), tipo: x.tipo })), h, { magico: true }); if (Stats) Stats.heroe(h).daño += d; }
      }
      if (salvo) { if (o.alSalvar) await o.alSalvar(t); continue; }
      fallaron.push(t);
      if (o.condicion && vivo(t)) {
        if (J.estado(t, o.condicion, Object.assign({ fuente: h.uid }, o.dur ? o.dur(t) : {})))
          J.log(`${t.nombre} queda ${CONDICIONES[o.condicion].nombre.toLowerCase()}.`, 'crit');
      }
      if (o.alFallar && vivo(t)) await o.alFallar(t);
    }
    return fallaron;
  },

  // Duraciones habituales.
  hastaFinDeSuTurno: t => ({ expira: { uid: t.uid, cuando: 'fin' } }),
  unMinuto: (h, atr, cd, conc) => t => ({ expira: { uid: t.uid, cuando: 'fin', veces: 10 }, salvar: { atr, cd }, conc }),

  // Empuja a t 'casillas' lejos de h, mientras haya lugar.
  empujar(J, h, t, casillas) {
    const [hx, hy] = Mapas.centro(h), [tx, ty] = Mapas.centro(t);
    const dx = Math.sign(Math.round(tx - hx)), dy = Math.sign(Math.round(ty - hy));
    let movio = 0;
    for (let i = 0; i < casillas; i++) { if (!T.ubicar(t, t.x + dx, t.y + dy)) break; movio++; }
    if (movio) J.log(`💨 ${t.nombre} sale despedido ${movio * 5} pies.`);
  },

  curar(J, h, t, dados, mas) {
    const v = Dado.tirar(dados).total + mas;
    J.log(`💚 ${h.nombre} cura ${v} a ${t.nombre}.`);
    return J.curar(t, v, h);
  },
};

// Ayudas para que los bots elijan (puntos = valor aproximado en PV).
const IAH = {
  enemigoDebil(J) { const l = J.enemigosVivos(); return l.length ? l.reduce((a, b) => (b.pv < a.pv ? b : a)) : null; },
  enemigoFuerte(J) { const l = J.enemigosVivos(); return l.length ? l.reduce((a, b) => (b.pv > a.pv ? b : a)) : null; },
  herido(J, umbral = 0.5) {
    const l = S.grupo.filter(h => !h.muerto && (h.caido || h.pv < h.pvMax * umbral));
    if (!l.length) return null;
    return l.find(h => h.caido) || l.reduce((a, b) => (b.pv / b.pvMax < a.pv / a.pvMax ? b : a));
  },
  daño(J, media, t) { return t ? Math.min(media, t.pv + 4) : 0; },
  area(J, media, salvMitad = true) {
    return J.enemigosVivos().reduce((s, e) => s + Math.min(e.pv, media * (salvMitad ? 0.75 : 0.55)), 0);
  },
  control(J) { return J.enemigosVivos().reduce((s, e) => s + Math.min(e.pv, 12 + e.def.nd * 4), 0) * 0.45; },
};

// ---------------------------------------------- ataques de cada héroe
// Cada arma: { id, nombre, atr: 'fue'|'des'|'fino'|'int', dados, tipo, distancia }
function atacar(arma) {
  return { id: 'atacar_' + arma.id, nombre: `Atacar: ${arma.nombre}`, tipo: 'accion', esAtaque: true, objetivo: 'enemigo', generica: true,
    alcance: Math.max(arma.alcance || 0, arma.rango || 0),
    texto: h => `Ataque con arma (${Heroes.ataquesPorAccion(h)} por acción): ${arma.dados} ${arma.tipo}, ${arma.alcance ? 'cuerpo a cuerpo' : ''}${arma.alcance && arma.rango ? ' o ' : ''}${arma.rango ? `a distancia (${arma.rango} pies)` : ''}.`,
    efecto: (J, h, obj) => H.arma(J, h, obj, Heroes.armaActual(h, arma.id)),
    ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, Dado.media(arma.dados) + 3 + J.prof(h) * 0.5, t) * 0.65, t]; } };
}

const ACCIONES_COMUNES = [
  { id: 'correr', nombre: 'Correr', tipo: 'accion', objetivo: 'yo', generica: true,
    texto: h => `Suma otra vez su velocidad (${h.def.vel(h)} pies) a su movimiento de este turno.`,
    efecto: (J, h) => { h.mov += T.velocidad(h); J.log(`${h.nombre} corre.`); },
    ia: () => [0, null] },
  { id: 'destrabarse', nombre: 'Destrabarse', tipo: 'accion', objetivo: 'yo', generica: true,
    texto: () => 'Este turno se mueve sin provocar ataques de oportunidad.',
    efecto: (J, h) => { J.estado(h, 'destrabado', { expira: { uid: h.uid, cuando: 'fin' } }); },
    ia: () => [0, null] },
  { id: 'esquivar', nombre: 'Esquivar', tipo: 'accion', objetivo: 'yo', generica: true,
    texto: () => 'Hasta su próximo turno los ataques contra él tienen desventaja.',
    efecto: (J, h) => { J.estado(h, 'esquivando', { expira: { uid: h.uid, cuando: 'inicio' } }); },
    ia: (J, h) => [h.pv < h.pvMax * 0.3 ? 4 : 0, h] },
  { id: 'pocion', nombre: 'Beber poción', tipo: 'adicional', objetivo: 'yo', generica: true,
    texto: () => `Poción de curación (2d4+2) o mayor (4d4+4). Quedan ${S.pociones.comun} + ${S.pociones.mayor}.`,
    requisito: (J, h) => S.pociones.comun + S.pociones.mayor > 0 ? (h.pv >= h.pvMax ? 'Tiene la vida completa' : null) : 'No quedan pociones',
    efecto: (J, h) => Heroes.pocion(J, h, h),
    ia: (J, h) => [h.pv < h.pvMax * 0.35 ? 12 : 0, h] },
  { id: 'darPocion', nombre: 'Dar poción', tipo: 'accion', objetivo: 'aliado', generica: true, alcance: 5,
    filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto && t !== h,
    texto: () => 'Le da una poción a un aliado (también a uno caído).',
    requisito: () => S.pociones.comun + S.pociones.mayor > 0 ? null : 'No quedan pociones',
    efecto: (J, h, t) => Heroes.pocion(J, h, t),
    ia: (J, h) => { const t = S.grupo.find(x => x.caido && !x.muerto); return [t ? 25 : 0, t]; } },
];

// ------------------------------------------------- familiares de Malego
const FAMILIARES = [
  { id: 'gandalf', nombre: 'Gandalf', emoji: '🧙', texto: 'Fuerza a todos los enemigos (salvación DES, mitad).',
    async accion(J, f, m) {
      J.log('Gandalf: "¡No puedes pasar!"', 'accion');
      await H.salvacion(J, m, J.enemigosVivos(), 'des', `${1 + Math.ceil(m.nivel / 3)}d6`, 'fuerza', { mitad: true });
    } },
  { id: 'sam', nombre: 'Sam', emoji: '🥔', texto: 'Cura 1d8 + CAR a los dos aliados más heridos.',
    async accion(J, f, m) {
      J.log('Sam reparte papas cocidas.', 'accion');
      S.grupo.filter(h => !h.muerto && h.pv < h.pvMax).sort((a, b) => a.pv / a.pvMax - b.pv / b.pvMax).slice(0, 2)
        .forEach(h => H.curar(J, f, h, '1d8', J.mod(m, 'car')));
    } },
  { id: 'gimli', nombre: 'Gimli', emoji: '🪓', provoca: true, cc: true, texto: 'Atrae los golpes y pega con su hacha.',
    async accion(J, f, m) {
      const t = J.enemigosVivos().filter(e => Mapas.dist(f, e) <= 1).sort((a, b) => a.pv - b.pv)[0]; if (!t) return;
      await J.ataque(f, t, { nombre: 'Hacha', bono: J.prof(m) + 3, daño: Dado.leer('1d12+3 cortante') });
    } },
  { id: 'legolas', nombre: 'Legolas', emoji: '🏹', texto: 'Dos flechas.',
    async accion(J, f, m) {
      for (let i = 0; i < 2; i++) { const t = J.azar(J.enemigosVivos().filter(e => T.enAlcance(f, e, 150))); if (t) await J.ataque(f, t, { nombre: 'Flecha', bono: J.prof(m) + 4, daño: Dado.leer('1d8+4 perforante'), distancia: true }); }
    } },
  { id: 'galadriel', nombre: 'Galadriel', emoji: '✨', mujer: true, texto: 'Vida temporal 1d8 + nivel de Malego a todo el grupo.',
    async accion(J, f, m) {
      J.log('Galadriel ilumina al grupo.', 'accion');
      J.heroesConscientes().forEach(h => J.vidaTemporal(h, Dado.d(8) + m.nivel));
    } },
  { id: 'gollum', nombre: 'Gollum', emoji: '💍', cc: true, texto: 'Ataca a cualquiera que tenga al lado, aliados incluidos.',
    async accion(J, f, m) {
      const t = J.azar(J.todos().filter(u => vivo(u) && u !== f && !u.caido && T.enTablero(u) && Mapas.dist(f, u) <= 1));
      J.log('Gollum: "¡Mi tesoro!"', 'accion');
      if (t) await J.ataque(f, t, { nombre: 'Mordisco', bono: J.prof(m) + 3, daño: Dado.leer('2d6+3 perforante') });
    } },
];

// --------------------------------------------- objetos mágicos (taberna)
const OBJETOS = [
  { id: 'botas',  heroe: 'pepe',   nombre: 'Botas de Caporal',       texto: 'Cuando da inspiración bárdica, el aliado también se cura 1d6.' },
  { id: 'lentes', heroe: 'benji',  nombre: 'Lentes de Benji',        texto: '+1 al ataque y al daño con armas.' },
  { id: 'petaca', heroe: 'fer',    nombre: 'Petaca Bendita',         texto: 'Empieza cada combate con 1d8 + CAR de vida temporal.' },
  { id: 'calcu',  heroe: 'guille', nombre: 'Calculadora Científica', texto: '+1 a la CD de sus conjuros.' },
  { id: 'router', heroe: 'coco',   nombre: 'Router Pirata',          texto: 'App Infectora afecta a un enemigo más y da el doble de oro.' },
  { id: 'jora',   heroe: 'tony',   nombre: 'Chicha de Jora Añeja',   texto: 'Una chicha experimental más en cada combate.' },
  { id: 'pua',    heroe: 'malego', nombre: 'Púa de Mithril',         texto: 'La Explosión de Tímpanos hace un dado más de daño.' },
];

// =====================================================================
//  HÉROES
// =====================================================================
const HEROES = [
  // ------------------------------------------------------------- PEPE
  {
    id: 'pepe', nombre: 'Pepe', raza: 'Elfo del Bosque', clase: 'Bardo', subclase: 'Colegio de la Elocuencia',
    arte: 'arte/pepe.jpg', cara: [0.53, 0.15, 2.6], dadoGolpe: 8, vel: () => 35, salvaciones: ['des', 'car'], lanzador: { tipo: 'completo', atr: 'car' },
    base: { fue: 8, des: 14, con: 13, int: 10, sab: 12, car: 17 }, mejoras: { 4: { car: 2 }, 8: { car: 1, con: 1 }, 12: { des: 2 } },
    ca: h => 12 + Math.min(5, R5.mod(h.car.des)),
    armas: [{ id: 'estoque', nombre: 'Estoque', atr: 'fino', dados: '1d8', tipo: 'perforante', alcance: 5 }],
    recursos: h => ({ inspiracion: { max: Math.max(1, R5.mod(h.car.car)), recarga: h.nivel >= 5 ? 'corto' : 'largo', nombre: 'Inspiración bárdica' } }),
    rasgos: [
      { id: 'polifacetico', nivel: 2, nombre: 'Polifacético', texto: 'Suma la mitad de su competencia a la iniciativa.' },
      { id: 'cancionDescanso', nivel: 2, nombre: 'Canción de descanso', texto: 'En la taberna, quien gaste dados de golpe cura 1d6 extra.' },
      { id: 'fuenteInspiracion', nivel: 5, nombre: 'Fuente de inspiración', texto: 'La inspiración bárdica se recupera en cada descanso corto. El dado sube a d8 (d10 en nivel 10).' },
      { id: 'inspiracionInfalible', nivel: 6, nombre: 'Inspiración infalible', texto: 'Si la tirada inspirada igual falla, el aliado conserva el dado.' },
    ],
    habilidades: [
      { id: 'verbal', nombre: 'Ataque Verbal', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 60, insulto: true, conjuro: true,
        texto: h => `Burla cruel. Salvación SAB CD ${J.cd(h)}: ${H.truco(h, 4)} psíquico y desventaja en su próximo ataque.${J.tiene(h, 'beber') ? ` Picado: +${J.valor(h, 'beber')}.` : ''}`,
        async efecto(J, h, t) {
          let dados = H.truco(h, 4) + ' psíquico';
          if (J.tiene(h, 'beber')) { dados += ' y ' + J.valor(h, 'beber') + ' psíquico'; J.quitar(h, 'beber'); }
          await H.salvacion(J, h, [t], 'sab', dados, 'psíquico', { condicion: 'burlado', dur: t => ({ expira: { uid: t.uid, cuando: 'fin' } }) });
        },
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 2.5 * R5.escalaTruco(h.nivel) + (J.tiene(h, 'beber') ? 3.5 * R5.escalaTruco(h.nivel) : 0) + 2, t) * 0.6, t]; } },
      { id: 'beber', nombre: 'Beber', nivel: 1, tipo: 'adicional', objetivo: 'yo',
        texto: h => `Se toma una al seco: su próximo Ataque Verbal hace +${R5.escalaTruco(h.nivel)}d6.`,
        requisito: (J, h) => J.tiene(h, 'beber') ? 'Ya está picado' : null,
        efecto(J, h) { J.estado(h, 'beber', { valor: `${R5.escalaTruco(h.nivel)}d6` }); J.log(`${h.nombre} se toma una al seco.`); },
        ia: (J, h) => [h.accion ? 3 : 0, h] },
      { id: 'caporales', nombre: 'Bailar Caporales', nivel: 1, tipo: 'adicional', objetivo: 'aliado', alcance: 60, recurso: 'inspiracion',
        filtro: (J, h, t) => t !== h && consciente(t) && t.tipo === 'heroe' && !J.tiene(t, 'inspirado'),
        texto: h => `Inspiración bárdica: un aliado gana un d${H.dadoInspiracion(h)} para sumar a un ataque o salvación que falle.`,
        efecto(J, h, t) { Heroes.inspirar(J, h, t); },
        ia: (J, h) => { const t = J.heroesConscientes().find(x => x !== h && !J.tiene(x, 'inspirado')); return [t ? 5 : 0, t]; } },
      { id: 'disonancia', nombre: 'Disonancia Susurrante', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 1, conjuro: true, insulto: true,
        texto: h => `Salvación SAB CD ${J.cd(h)}: 3d6 psíquico (+1d6 por nivel de espacio), mitad si salva.`,
        async efecto(J, h, t, n) { await H.salvacion(J, h, [t], 'sab', `${2 + n}d6`, 'psíquico', { mitad: true }); },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [IAH.daño(J, 9, t) * 0.75, t]; } },
      { id: 'huayno', nombre: 'Huayno de Aliento', nivel: 1, tipo: 'adicional', objetivo: 'aliado', alcance: 60, espacio: 1, conjuro: true,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Palabra curativa: cura 1d4 + ${J.mod(h, 'car')} por nivel de espacio. Levanta a un caído.`,
        efecto(J, h, t, n) { H.curar(J, h, t, `${n}d4`, J.mod(h, 'car')); },
        ia: (J, h) => { const t = IAH.herido(J, 0.3); return [t ? (t.caido ? 30 : 8) : 0, t]; } },
      { id: 'inquietantes', nombre: 'Palabras Inquietantes', nivel: 3, tipo: 'adicional', objetivo: 'enemigo', alcance: 60, recurso: 'inspiracion', insulto: true,
        texto: h => `Gasta inspiración: el enemigo resta un d${H.dadoInspiracion(h)} a su próxima salvación.`,
        efecto(J, h, t) { J.estado(t, 'inquieto', { valor: H.dadoInspiracion(h) }); J.log(`${t.nombre} queda inquieto.`); },
        ia: (J, h) => [0, null] },
      { id: 'paralizante', nombre: 'Insulto Paralizante', nivel: 3, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 2, conjuro: true, insulto: true, concentracion: true,
        filtro: (J, h, t) => t.def.tipo === 'Humanoide',
        texto: h => `Inmovilizar persona (solo humanoides). Salvación SAB CD ${J.cd(h)} o queda paralizado; repite la salvación al final de cada turno. Concentración.`,
        async efecto(J, h, t) { await H.salvacion(J, h, [t], 'sab', null, null, { condicion: 'paralizado', dur: H.unMinuto(h, 'sab', J.cd(h), h.concNueva) }); },
        ia: (J, h) => { const t = J.enemigosVivos().filter(e => e.def.tipo === 'Humanoide').sort((a, b) => b.pv - a.pv)[0]; return [t && !h.conc ? Math.min(t.pv, 25) * 0.5 : 0, t]; } },
      { id: 'hipnotico', nombre: 'Huayno Hipnótico', nivel: 5, tipo: 'accion', objetivo: 'area', area: { forma: 'cubo', tam: 30 }, alcance: 120, espacio: 3, conjuro: true, concentracion: true,
        texto: h => `Patrón hipnótico (cubo de 30 pies a 120): cada criatura dentro salva SAB CD ${J.cd(h)} o queda incapacitada hasta que reciba daño. Ojo con los aliados. Concentración.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'hipnotizado', dur: t => ({ expira: { uid: t.uid, cuando: 'fin', veces: 10 }, conc: h.concNueva }) }); },
        ia: (J, h) => [J.enemigosVivos().length >= 3 && !h.conc ? IAH.control(J) : 0, null] },
      { id: 'masa', nombre: 'Huayno de Aliento en Masa', nivel: 9, tipo: 'accion', objetivo: 'aliados', alcance: 60, max: 6, espacio: 5, conjuro: true,
        texto: h => `Curar heridas en masa: cura 3d8 + ${J.mod(h, 'car')} a hasta 6 aliados a 60 pies.`,
        efecto(J, h, objs) { objs.forEach(x => H.curar(J, h, x, '3d8', J.mod(h, 'car'))); },
        ia: (J, h) => [S.grupo.filter(x => !x.muerto && x.pv < x.pvMax * 0.6).length >= 2 ? 40 : 0, null] },
      { id: 'brindis', nombre: 'Brindis Flamígero', nivel: 10, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 150, espacio: 3, conjuro: true,
        texto: h => `Secretos mágicos: bola de fuego (radio de 20 pies a 150). Salvación DES CD ${J.cd(h)}: 8d6 fuego (+1d6 por nivel de espacio sobre 3), mitad si salva. Quema también a los aliados.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'des', `${5 + n}d6`, 'fuego', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 28), null] },
      { id: 'otto', nombre: 'Caporales Irresistibles', nivel: 11, tipo: 'accion', objetivo: 'enemigo', alcance: 30, espacio: 6, conjuro: true, concentracion: true,
        texto: h => `Danza irresistible: el enemigo baila sin salvación inicial (pierde el turno y lo atacan con ventaja); al final de cada turno salva SAB CD ${J.cd(h)}. Concentración.`,
        efecto(J, h, t) { J.estado(t, 'bailando', { conc: h.concNueva, salvar: { atr: 'sab', cd: J.cd(h) }, expira: { uid: t.uid, cuando: 'fin', veces: 10 } }); J.log(`💃 ${t.nombre} se pone a bailar caporales sin poder evitarlo.`, 'crit'); },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [t && !h.conc && t.pv > 60 ? 45 : 0, t]; } },
    ],
    gesta: { id: 'misogino', nombre: 'Insulto Misógino', tipo: 'gesta', objetivo: 'enemigos', alcance: 60, insulto: true,
      texto: h => `Los enemigos a 60 pies salvan SAB CD ${J.cd(h)}. Las enemigas que fallan: muerte inmediata. El resto recibe ${2 + Math.floor(h.nivel / 2)}d8 psíquico (mitad si salva).`,
      async efecto(J, h, objs) {
        const dados = `${2 + Math.floor(h.nivel / 2)}d8`;
        for (const e of objs) {
          const salvo = await J.salvar(e, 'sab', J.cd(h), { fuente: h, conjuro: true });
          if (e.mujer && !salvo) await J.muerteInmediata(h, e, 'no soportó el insulto', dados + ' psíquico', 'psíquico');
          else await J.dañar(e, Math.floor(Dado.tirar(dados).total / (salvo ? 2 : 1)), 'psíquico', h, { magico: true });
        }
      },
      ia: (J, h) => [IAH.area(J, 4.5 * (2 + h.nivel / 2)) + J.enemigosVivos().filter(e => e.mujer).length * 20, null] },
  },

  // ------------------------------------------------------------ BENJI
  {
    id: 'benji', nombre: 'Benji', raza: 'Semiorco', clase: 'Bárbaro', subclase: 'Senda del Berserker',
    arte: 'arte/benji.jpg', cara: [0.47, 0.21, 2.6], dadoGolpe: 12, vel: h => h.nivel >= 5 ? 40 : 30, salvaciones: ['fue', 'con'], lanzador: null,
    base: { fue: 17, des: 13, con: 16, int: 8, sab: 12, car: 10 }, mejoras: { 4: { fue: 2 }, 8: { fue: 1, con: 1 }, 12: { con: 1, des: 1 } },
    ca: h => 10 + R5.mod(h.car.des) + R5.mod(h.car.con),
    armas: [
      { id: 'apm', nombre: 'Dedos de APM 5000', atr: 'fue', dados: '1d12', tipo: 'cortante', alcance: 5,
        // Interrumpe: el enemigo pierde su recarga lista o su concentración.
        async alImpactar(J, h, t) {
          const lista = (t.recargas || []).some((r, i) => r.lista && t.def.especiales[i].recarga);
          if (!lista && !t.conc) return;
          if (!await J.salvar(t, 'con', 8 + J.prof(h) + J.mod(h, 'fue'), { fuente: h })) {
            (t.recargas || []).forEach((r, i) => { if (t.def.especiales[i].recarga) r.lista = false; });
            J.romperConcentracion(t, true);
            J.log(`⛔ Los dedos de Benji interrumpen a ${t.nombre}: pierde lo que tenía preparado.`, 'crit');
          }
        } },
      { id: 'jabalina', nombre: 'Jabalina', atr: 'fue', dados: '1d6', tipo: 'perforante', alcance: 5, rango: 30 },
    ],
    recursos: h => ({
      furia: { max: h.nivel >= 12 ? 5 : h.nivel >= 6 ? 4 : h.nivel >= 3 ? 3 : 2, recarga: 'largo', nombre: 'Furia' },
      zegarrita: { max: 1, recarga: 'corto', nombre: 'Zegarrita' },
      aguante: { max: 1, recarga: 'largo', nombre: 'Aguante incansable' },
    }),
    rasgos: [
      { id: 'aguante', nivel: 1, nombre: 'Aguante incansable', texto: 'Una vez por descanso largo, al caer a 0 PV queda con 1.' },
      { id: 'ataquesSalvajes', nivel: 1, nombre: 'Ataques salvajes', texto: 'Sus críticos cuerpo a cuerpo suman un dado de arma extra.' },
      { id: 'sentidoPeligro', nivel: 2, nombre: 'Sentido del peligro', texto: 'Ventaja en salvaciones de DES.' },
      { id: 'ataqueExtra', nivel: 5, nombre: 'Ataque extra', texto: 'Ataca dos veces con la acción de Atacar.' },
      { id: 'movimientoRapido', nivel: 5, nombre: 'Movimiento rápido', texto: 'Su velocidad sube a 40 pies.' },
      { id: 'furiaInconsciente', nivel: 6, nombre: 'Furia inconsciente', texto: 'En furia no puede ser hechizado ni asustado.' },
      { id: 'instintoSalvaje', nivel: 7, nombre: 'Instinto salvaje', texto: 'Ventaja en la iniciativa.' },
      { id: 'criticoBrutal', nivel: 9, nombre: 'Crítico brutal', texto: 'Un dado de arma más en sus críticos. La furia suma +3.' },
      { id: 'furiaImplacable', nivel: 11, nombre: 'Furia implacable', texto: 'Si cae a 0 PV en furia, salva CON (CD 10, +5 por uso) para quedar en 1.' },
    ],
    habilidades: [
      { id: 'furia', nombre: 'Furia', nivel: 1, tipo: 'adicional', objetivo: 'yo', recurso: 'furia',
        texto: h => `Hasta el fin del combate: +${h.nivel >= 9 ? 3 : 2} al daño cuerpo a cuerpo con FUE, resistencia a contundente, cortante y perforante, ventaja en FUE.`,
        requisito: (J, h) => J.tiene(h, 'furia') ? 'Ya está en furia' : null,
        efecto(J, h) { J.estado(h, 'furia', {}); J.log(`🔥 ${h.nombre} entra en furia.`, 'crit'); },
        ia: (J, h) => [J.enemigosVivos().reduce((s, e) => s + e.pv, 0) > 25 ? 14 : 0, h] },
      { id: 'temerario', nombre: 'Ataque Temerario', nivel: 2, tipo: 'accion', esAtaque: true, objetivo: 'enemigo', alcance: 5,
        texto: () => 'Empieza la acción de Atacar con ventaja en todos sus ataques de este turno, pero lo atacan con ventaja hasta su próximo turno.',
        requisito: (J, h) => h.ataquesRestantes > 0 ? 'Se elige al empezar a atacar' : null,
        efecto(J, h, t) { J.estado(h, 'temerario', { expira: { uid: h.uid, cuando: 'inicio' } }); return H.arma(J, h, t, Heroes.armaActual(h, 'apm')); },
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [h.pv > h.pvMax * 0.5 ? IAH.daño(J, 12, t) * 0.8 : 0, t]; } },
      { id: 'frenesi', nombre: 'Frenesí', nivel: 3, tipo: 'adicional', objetivo: 'enemigo', alcance: 5,
        texto: () => 'En furia: un ataque extra con los Dedos de APM 5000 como acción adicional.',
        requisito: (J, h) => J.tiene(h, 'furia') ? null : 'Solo en furia',
        efecto: (J, h, t) => H.arma(J, h, t, Heroes.armaActual(h, 'apm')),
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 11, t) * 0.65, t]; } },
      { id: 'dormir', nombre: 'Dormir', nivel: 1, tipo: 'accion', objetivo: 'yo',
        texto: h => `Siesta: gasta un dado de golpe y cura 1d12 + ${R5.mod(h.car.con)}. Queda derribado hasta su próximo turno.`,
        requisito: (J, h) => h.dadosGolpe.usados >= h.nivel ? 'No le quedan dados de golpe' : h.pv >= h.pvMax ? 'Tiene la vida completa' : null,
        efecto(J, h) { h.dadosGolpe.usados++; H.curar(J, h, h, '1d12', J.mod(h, 'con')); J.estado(h, 'derribado', { expira: { uid: h.uid, cuando: 'inicio' } }); J.log(`${h.nombre} se echa una siesta. Zzz.`); },
        ia: (J, h) => [h.pv < h.pvMax * 0.3 ? 9 : 0, h] },
      { id: 'zegarrita', nombre: 'Desaparecer con Zegarrita', nivel: 1, tipo: 'adicional', objetivo: 'yo', recurso: 'zegarrita',
        texto: () => 'Invisible hasta su próximo turno (ataques contra él con desventaja). El turno siguiente no tiene acción adicional.',
        efecto(J, h) { J.estado(h, 'invisible', { expira: { uid: h.uid, cuando: 'inicio' } }); J.estado(h, 'sinAdicional', {}); J.log(`${h.nombre} se fue con Zegarrita. Nadie lo encuentra.`); },
        ia: (J, h) => [h.pv < h.pvMax * 0.35 && !J.tiene(h, 'furia') ? 8 : 0, h] },
      { id: 'ronquido', nombre: 'Ronquido Intimidante', nivel: 10, tipo: 'accion', objetivo: 'enemigo', alcance: 30, insulto: true,
        texto: h => `Presencia intimidante: salvación SAB CD ${8 + J.prof(h) + R5.mod(h.car.car)} o queda asustado (repite al final de cada turno).`,
        async efecto(J, h, t) {
          const cd = 8 + J.prof(h) + J.mod(h, 'car');
          if (!await J.salvar(t, 'sab', cd, { fuente: h })) { J.estado(t, 'asustado', { fuente: h.uid, salvar: { atr: 'sab', cd }, expira: { uid: t.uid, cuando: 'fin', veces: 10 } }); J.log(`${t.nombre} queda asustado.`, 'crit'); }
        },
        ia: () => [0, null] },
    ],
    gesta: { id: 'silbido', nombre: 'Silbido de Fuego', tipo: 'gesta', objetivo: 'yo',
      texto: h => `APM 10000. Quien lo dañó desde su último turno (a 60 pies) salva CON CD ${8 + J.prof(h) + R5.mod(h.car.fue)} o sufre muerte inmediata (si no, 3d10 fuego). Si nadie lo dañó, un golpe crítico automático al enemigo más débil que tenga al lado.`,
      async efecto(J, h) {
        const culpables = J.enemigosVivos().filter(e => (h.dañadoPorPrev || []).concat(h.dañadoPor).includes(e.uid) && T.enAlcance(h, e, 60));
        if (!culpables.length) {
          const t = J.enemigosVivos().filter(e => Mapas.dist(h, e) <= 1).sort((a, b) => a.pv - b.pv)[0];
          if (!t) { J.log('Nadie lo tocó y no tiene a nadie al lado: el silbido se pierde en el aire.'); return; }
          J.log('Nadie lo tocó: el silbido se concentra en un solo golpe.');
          const a = Heroes.armaActual(h, 'apm');
          const daño = Dado.leer(a.dados, a.tipo); daño[0].mas = J.mod(h, 'fue');
          const v = Dado.tirar(daño, true).total + (J.tiene(h, 'furia') ? 2 : 0);
          await J.dañar(t, v, a.tipo, h); return;
        }
        for (const e of culpables) {
          if (!await J.salvar(e, 'con', 8 + J.prof(h) + J.mod(h, 'fue'), { fuente: h })) await J.muerteInmediata(h, e, 'recibió el silbido de fuego', '6d10 fuego', 'fuego');
          else await J.dañar(e, Dado.tirar('3d10').total, 'fuego', h, { magico: true });
        }
      },
      ia: (J, h) => [J.enemigosVivos().filter(e => (h.dañadoPorPrev || []).includes(e.uid) && T.enAlcance(h, e, 60)).length * 25 + (J.enemigosVivos().some(e => Mapas.dist(h, e) <= 1) ? 10 : 0), h] },
  },

  // -------------------------------------------------------------- FER
  {
    id: 'fer', nombre: 'Fer', raza: 'Tiefling', clase: 'Paladín', subclase: 'Juramento a la Diosa Patrona',
    arte: 'arte/fer.jpg', posArte: 'center 85%', cara: [0.35, 0.33, 2.8], dadoGolpe: 10, vel: () => 30, salvaciones: ['sab', 'car'], lanzador: { tipo: 'medio', atr: 'car' },
    base: { fue: 16, des: 10, con: 14, int: 9, sab: 10, car: 16 }, mejoras: { 4: { fue: 2 }, 8: { car: 2 }, 12: { fue: 2 } },
    resistencias: ['fuego'],
    ca: h => 18 + (h.nivel >= 2 ? 1 : 0),
    armas: [{ id: 'espada', nombre: 'Espada larga', atr: 'fue', dados: '1d8', tipo: 'cortante', alcance: 5,
      // Juramento a la Diosa: castigo divino al impactar.
      async alImpactar(J, h, t, res) {
        if (h.nivel < 2 || !J.espacioLibre(h, 1)) return;
        const n = h.espacios.max.findIndex((m, i) => h.espacios.usados[i] < m) + 1;
        const dados = Math.min(5, 1 + n) + (['No muerto', 'Infernal'].includes(t.def.tipo) ? 1 : 0);
        if (!await UI.preguntar(h, 'Juramento a la Diosa', `${h.nombre} impacta${res.crit ? ' con crítico' : ''} a ${t.nombre}. ¿Gastar un espacio de nivel ${n} en un castigo divino de ${dados}d8 radiante${res.crit ? ' (x2 por crítico)' : ''}?`, 'castigo', { t, res, n })) return;
        J.gastarEspacio(h, n);
        const v = Dado.tirar(`${dados}d8 radiante`, res.crit).total;
        J.log(`☀ ¡Juramento a la Diosa! Castigo divino: +${v} radiante.`, 'crit');
        await J.dañar(t, v, 'radiante', h, { magico: true });
        if (Stats) Stats.heroe(h).daño += v;
        if (h.nivel >= 3 && J.recurso(h, 'canalizar') > 0 && J.heroesConscientes().some(x => x.pv < x.pvMax)
            && await UI.preguntar(h, 'Diosa inspiradora', `¿Canalizar divinidad para repartir ${'2d8+' + h.nivel} de vida temporal entre el grupo?`, 'inspiradora', {})) {
          J.usarRecurso(h, 'canalizar');
          const total = Dado.tirar('2d8').total + h.nivel;
          const grupo = J.heroesConscientes();
          grupo.forEach(x => J.vidaTemporal(x, Math.floor(total / grupo.length)));
          J.log(`✨ La Diosa inspira al grupo: ${total} de vida temporal repartida.`, 'crit');
        }
      } }],
    recursos: h => ({
      imposicion: { max: 5 * h.nivel, recarga: 'largo', nombre: 'Imposición de manos' },
      canalizar: { max: h.nivel >= 3 ? 1 : 0, recarga: 'corto', nombre: 'Canalizar divinidad' },
      reprension: { max: h.nivel >= 3 ? 1 : 0, recarga: 'largo', nombre: 'Reprensión infernal' },
    }),
    rasgos: [
      { id: 'resFuego', nivel: 1, nombre: 'Resistencia infernal', texto: 'Resistencia al fuego.' },
      { id: 'defensa', nivel: 2, nombre: 'Estilo de combate: Defensa', texto: '+1 a la CA.' },
      { id: 'castigo', nivel: 2, nombre: 'Juramento a la Diosa (castigo divino)', texto: 'Al impactar puede gastar un espacio: 2d8 radiante (+1d8 por nivel de espacio, +1d8 contra no muertos e infernales).' },
      { id: 'inspiradora', nivel: 3, nombre: 'Diosa inspiradora', texto: 'Tras un castigo, canaliza divinidad (1 por descanso corto): reparte 2d8 + nivel de vida temporal.' },
      { id: 'ataqueExtra', nivel: 5, nombre: 'Ataque extra', texto: 'Ataca dos veces con la acción de Atacar.' },
      { id: 'auraProteccion', nivel: 6, nombre: 'Aura de protección', texto: 'Los aliados suman su CAR a todas sus salvaciones mientras Fer esté consciente.' },
      { id: 'auraDevocion', nivel: 7, nombre: 'Aura de devoción', texto: 'Los aliados no pueden ser hechizados.' },
      { id: 'auraValor', nivel: 10, nombre: 'Aura de valor', texto: 'Los aliados no pueden ser asustados.' },
      { id: 'castigoMejorado', nivel: 11, nombre: 'Castigo divino mejorado', texto: '+1d8 radiante en cada golpe cuerpo a cuerpo.' },
    ],
    habilidades: [
      { id: 'seduccion', nombre: 'Seducción Ebria', nivel: 1, tipo: 'accion', esAtaque: true, objetivo: 'enemigo', alcance: 5,
        texto: h => `Un ataque con la espada; si impacta, salvación CON CD ${J.cd(h)} o queda borracho (desventaja en ataques) hasta el final de su próximo turno.`,
        efecto: (J, h, t) => H.arma(J, h, t, Heroes.armaActual(h, 'espada'), { async alImpactar(res, t) {
          if (!await J.salvar(t, 'con', J.cd(h), { fuente: h })) { J.estado(t, 'borracho', { expira: { uid: t.uid, cuando: 'fin' } }); J.log(`🥴 ${t.nombre} queda borracho de amor.`, 'crit'); }
        } }),
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [IAH.daño(J, 8 + J.mod(h, 'fue'), t) * 0.65 + (t && !J.tiene(t, 'borracho') ? 3 : 0), t]; } },
      { id: 'imposicion', nombre: 'Imposición de Manos', nivel: 1, tipo: 'accion', objetivo: 'aliado', alcance: 5,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto && t.pv < t.pvMax,
        texto: h => `Cura de su reserva (${J.recurso(h, 'imposicion')} de ${5 * h.nivel}) lo que le falte al aliado. Levanta a un caído.`,
        requisito: (J, h) => J.recurso(h, 'imposicion') > 0 ? null : 'La reserva está vacía',
        efecto(J, h, t) {
          const n = Math.min(J.recurso(h, 'imposicion'), t.pvMax - t.pv, t.caido ? Math.max(5, Math.ceil(t.pvMax / 3)) : 999);
          J.usarRecurso(h, 'imposicion', n); J.log(`🤲 ${h.nombre} impone las manos: +${n}.`); J.curar(t, n, h);
        },
        ia: (J, h) => { const t = IAH.herido(J, 0.35); return [t && J.recurso(h, 'imposicion') > 0 ? (t.caido ? 30 : 10) : 0, t]; } },
      { id: 'bendecir', nombre: 'Bendecir', nivel: 2, tipo: 'accion', objetivo: 'aliados', alcance: 30, max: 3, espacio: 1, conjuro: true, concentracion: true,
        texto: () => 'Hasta 3 aliados a 30 pies suman 1d4 a sus ataques y salvaciones. Concentración.',
        efecto(J, h, objs) { objs.forEach(x => J.estado(x, 'bendecido', { conc: h.concNueva })); },
        ia: (J, h) => [!h.conc && J.enemigosVivos().reduce((s, e) => s + e.pv, 0) > 60 ? 12 : 0, null] },
      { id: 'curar', nombre: 'Curar Heridas', nivel: 2, tipo: 'accion', objetivo: 'aliado', alcance: 5, espacio: 1, conjuro: true,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Cura 1d8 + ${R5.mod(h.car.car)} por nivel de espacio.`,
        efecto(J, h, t, n) { H.curar(J, h, t, `${n}d8`, J.mod(h, 'car')); },
        ia: (J, h) => [0, null] },
      { id: 'reprension', nombre: 'Reprensión Infernal', nivel: 3, tipo: 'reaccion', objetivo: 'enemigo',
        texto: h => `Reacción, 1 por descanso largo: quien lo hiere salva DES CD ${J.cd(h)} o recibe 2d10 de fuego.`, efecto() {} },
      { id: 'auxilio', nombre: 'Auxilio', nivel: 5, tipo: 'accion', objetivo: 'aliados', alcance: 30, max: 3, espacio: 2, conjuro: true,
        texto: () => 'Tres aliados a 30 pies ganan +5 de vida máxima y actual por el resto de la expedición (+5 por nivel de espacio sobre 2).',
        efecto(J, h, objs, n) { objs.filter(x => x.tipo === 'heroe').forEach(x => { const v = 5 * (n - 1); x.auxilio = Math.max(x.auxilio || 0, v); Heroes.recalcular(x); J.curar(x, v, h); }); J.log('Fer pide auxilio a la Diosa.'); },
        ia: () => [0, null] },
      { id: 'revivificar', nombre: 'Revivificar', nivel: 9, tipo: 'accion', objetivo: 'aliado', alcance: 5, espacio: 3, conjuro: true,
        filtro: (J, h, t) => t.tipo === 'heroe' && t.muerto,
        texto: () => 'Devuelve la vida a un aliado muerto: vuelve con 1 PV.',
        efecto(J, h, t) { t.muerto = false; t.caido = false; t.pv = 1; t.salvMuerte = { e: 0, f: 0 }; J.log(`✨ La Diosa le devuelve la vida a ${t.nombre}.`, 'crit'); },
        ia: (J, h) => { const t = S.grupo.find(x => x.muerto); return [t ? 50 : 0, t]; } },
      { id: 'manto', nombre: 'Manto del Cruzado', nivel: 9, tipo: 'accion', objetivo: 'aliados', alcance: 30, max: 12, espacio: 3, conjuro: true, concentracion: true,
        texto: () => 'Los aliados a 30 pies suman 1d4 radiante a sus ataques con arma. Concentración.',
        efecto(J, h, objs) { objs.forEach(x => J.estado(x, 'manto', { conc: h.concNueva })); },
        ia: (J, h) => [0, null] },
    ],
    gesta: { id: 'diosa', nombre: 'Invocación de la Diosa Patrona', tipo: 'gesta', objetivo: 'enemigos', alcance: 60,
      filtro: (J, h, e) => J.tiene(e, 'borracho') || J.tiene(e, 'envenenado') || J.tiene(e, 'veneno'),
      texto: h => `La Diosa juzga a los borrachos: cada enemigo borracho o envenenado salva CAR CD ${J.cd(h)} o sufre muerte inmediata (si no, ${4}d8+${h.nivel} radiante). A Fer le cuesta 1 PV.`,
      requisito: (J, h) => Heroes.grupoObjetivo(h, h.def.gesta).length ? null : 'No hay ningún enemigo borracho a 60 pies',
      async efecto(J, h, objs) {
        for (const e of objs) {
          if (!await J.salvar(e, 'car', J.cd(h), { fuente: h, conjuro: true })) await J.muerteInmediata(h, e, 'fue juzgado por la Diosa Patrona', `4d8+${h.nivel} radiante`, 'radiante');
          else await J.dañar(e, Dado.tirar(`4d8+${h.nivel}`).total, 'radiante', h, { magico: true });
        }
        h.pv = Math.max(1, h.pv - 1);
      },
      ia: (J, h) => [J.enemigosVivos().filter(e => J.tiene(e, 'borracho') || J.tiene(e, 'envenenado')).reduce((s, e) => s + Math.min(e.pv, 30), 0), null] },
  },

  // ----------------------------------------------------------- GUILLE
  {
    id: 'guille', nombre: 'Guille', raza: 'Humano', clase: 'Mago', subclase: 'Escuela del Encantamiento',
    arte: 'arte/guille.jpg', cara: [0.48, 0.24, 2.8], dadoGolpe: 6, vel: () => 30, salvaciones: ['int', 'sab'], lanzador: { tipo: 'completo', atr: 'int' },
    base: { fue: 8, des: 14, con: 14, int: 17, sab: 12, car: 10 }, mejoras: { 4: { int: 2 }, 8: { int: 1, con: 1 }, 12: { des: 2 } },
    ca: h => 13 + R5.mod(h.car.des),
    armas: [{ id: 'baston', nombre: 'Bastón', atr: 'fue', dados: '1d6', tipo: 'contundente', alcance: 5 }],
    recursos: () => ({ recuperacion: { max: 1, recarga: 'largo', nombre: 'Recuperación arcana' } }),
    rasgos: [
      { id: 'indignacionPasiva', nivel: 1, nombre: 'Indignación', texto: 'Cuando alguien insulta (una vez por ronda) pierde 1d4 PV y su próximo conjuro de daño suma INT.' },
      { id: 'armaduraMago', nivel: 1, nombre: 'Armadura de mago', texto: 'Siempre la tiene puesta: CA 13 + DES.' },
      { id: 'recuperacionArcana', nivel: 1, nombre: 'Recuperación arcana', texto: 'Una vez por expedición, en la taberna recupera espacios de conjuro (hasta la mitad de su nivel).' },
      { id: 'encantoInstintivo', nivel: 6, nombre: 'Desvío de responsabilidad', texto: 'Reacción: cuando lo atacan, el atacante salva SAB o ataca a otro.' },
      { id: 'encantamientoDividido', nivel: 10, nombre: 'Encantamiento dividido', texto: 'Sus Auditorías afectan a un segundo enemigo.' },
    ],
    habilidades: [
      { id: 'calculadora', nombre: 'Golpe de Calculadora', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 120, conjuro: true,
        texto: h => `Rayo de fuego: ataque de conjuro +${J.bonoConjuro(h)}, ${H.truco(h, 10)} fuego.`,
        efecto: (J, h, t) => H.ataqueConjuro(J, h, t, H.truco(h, 10), 'fuego', { nombre: 'Golpe de Calculadora' }),
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 5.5 * R5.escalaTruco(h.nivel), t) * 0.65, t]; } },
      { id: 'refutacionRapida', nombre: 'Refutación Rápida', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 60, conjuro: true,
        texto: h => `Mente punzante: salvación INT CD ${J.cd(h)}, ${H.truco(h, 6)} psíquico y resta 1d4 a su próxima salvación.`,
        async efecto(J, h, t) { await H.salvacion(J, h, [t], 'int', H.truco(h, 6), 'psíquico', { alFallar: t => J.estado(t, 'inquieto', { valor: 4 }) }); },
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 3.5 * R5.escalaTruco(h.nivel), t) * 0.6, t]; } },
      { id: 'calculo', nombre: 'Cálculo Crítico', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 120, espacio: 1, conjuro: true,
        texto: () => 'Proyectil mágico: 3 dardos de 1d4+1 de fuerza que nunca fallan (+1 dardo por nivel de espacio).',
        async efecto(J, h, t, n) {
          const dardos = 2 + n;
          const v = Dado.tirar(`${dardos}d4+${dardos} fuerza`).total + H.extraConjuro(J, h, 'fuerza');
          J.log(`🧮 ${dardos} dardos de cálculo: ${v} de fuerza, sin margen de error.`);
          const d = await J.dañar(t, v, 'fuerza', h, { magico: true }); if (Stats) Stats.heroe(h).daño += d;
        },
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 10.5, t) * 0.8, t]; } },
      { id: 'clase', nombre: 'Clase Magistral', nivel: 1, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 90, espacio: 1, conjuro: true,
        texto: () => 'Dormir (radio de 20 pies a 90): una clase de contabilidad duerme a 5d8 PV de criaturas (+2d8 por nivel de espacio), empezando por la de menos vida. Los no muertos no duermen; los aliados sí.',
        efecto(J, h, objs, n) {
          let pool = Dado.tirar(`${5 + 2 * (n - 1)}d8`).total;
          J.log(`💤 La clase de contabilidad adormece ${pool} PV de criaturas.`);
          for (const e of objs.filter(e => (e.def.tipo !== 'No muerto') && !e.caido && vivo(e)).sort((a, b) => a.pv - b.pv)) {
            if (e.pv > pool) break;
            pool -= e.pv;
            if (J.estado(e, 'dormido', { expira: { uid: e.uid, cuando: 'fin', veces: 10 } })) J.log(`💤 ${e.nombre} se queda dormido.`, 'crit');
          }
        },
        ia: (J, h) => { const l = J.enemigosVivos().filter(e => e.pv < 22 && e.def.tipo !== 'No muerto'); return [l.length >= 2 && h.nivel <= 4 ? l.reduce((s, e) => s + e.pv, 0) * 0.7 : 0, null]; } },
      { id: 'escudo', nombre: 'Indignación (Escudo)', nivel: 1, tipo: 'reaccion', objetivo: 'yo', espacio: 1, conjuro: true,
        texto: () => 'Reacción al recibir un impacto: +5 a la CA hasta su próximo turno (puede convertirlo en fallo).', efecto() {} },
      { id: 'mirada', nombre: 'Mirada de Auditor', nivel: 2, tipo: 'accion', objetivo: 'enemigo', alcance: 5,
        filtro: (J, h, t) => !t.inmuneMirada,
        texto: h => `Mirada hipnótica: salvación SAB CD ${J.cd(h)} o queda hechizado e incapacitado hasta el final del próximo turno de Guille.`,
        async efecto(J, h, t) {
          if (await J.salvar(t, 'sab', J.cd(h), { fuente: h, magico: true })) { t.inmuneMirada = true; J.log(`${t.nombre} aguanta la mirada: ya no le afecta.`); return; }
          J.estado(t, 'incapacitado', { expira: { uid: h.uid, cuando: 'fin', veces: 2 } });
          J.estado(t, 'hechizado', { fuente: h.uid, expira: { uid: h.uid, cuando: 'fin', veces: 2 } });
          J.log(`🌀 ${t.nombre} queda en trance ante la mirada de auditor.`, 'crit');
        },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [t && !t.inmuneMirada && J.enemigosVivos().length > 1 ? 10 : 0, t]; } },
      { id: 'auditoria', nombre: 'Auditoría Paralizante', nivel: 3, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 2, conjuro: true, concentracion: true,
        filtro: (J, h, t) => t.def.tipo === 'Humanoide',
        texto: h => `Inmovilizar persona (humanoides): salvación SAB CD ${J.cd(h)} o queda paralizado; repite al final de cada turno. Concentración.`,
        async efecto(J, h, t) {
          const objs = [t];
          if (J.rasgo(h, 'encantamientoDividido')) { const o = J.enemigosVivos().find(e => e !== t && e.def.tipo === 'Humanoide'); if (o) objs.push(o); }
          await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'paralizado', dur: H.unMinuto(h, 'sab', J.cd(h), h.concNueva) });
        },
        ia: (J, h) => { const t = J.enemigosVivos().filter(e => e.def.tipo === 'Humanoide').sort((a, b) => b.pv - a.pv)[0]; return [t && !h.conc ? Math.min(t.pv, 25) * 0.5 : 0, t]; } },
      { id: 'contrahechizo', nombre: 'Refutación (Contrahechizo)', nivel: 5, tipo: 'reaccion', objetivo: 'enemigo', espacio: 3, conjuro: true,
        texto: () => 'Reacción: cancela un conjuro o habilidad verbal enemiga. Contra monstruos de ND mayor a 6 tira INT.', efecto() {} },
      { id: 'excel', nombre: 'Hoja de Cálculo Explosiva', nivel: 5, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 150, espacio: 3, conjuro: true,
        texto: h => `Bola de fuego (radio de 20 pies a 150): salvación DES CD ${J.cd(h)}, 8d6 fuego (+1d6 por nivel de espacio sobre 3), mitad si salva. Quema también a los aliados.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'des', `${5 + n}d6`, 'fuego', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 28), null] },
      { id: 'amnesia', nombre: 'Amnesia Etérea', nivel: 7, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 10 }, alcance: 90, espacio: 4, conjuro: true, concentracion: true,
        texto: h => `Confusión (radio de 10 pies a 90): cada criatura dentro salva SAB CD ${J.cd(h)} o queda confundida (actúa al azar); repite al final de cada turno. Concentración.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'confundido', dur: H.unMinuto(h, 'sab', J.cd(h), h.concNueva) }); },
        ia: (J, h) => [J.enemigosVivos().length >= 3 && !h.conc ? IAH.control(J) * 0.8 : 0, null] },
      { id: 'auditoriaTotal', nombre: 'Auditoría Total', nivel: 9, tipo: 'accion', objetivo: 'enemigo', alcance: 90, espacio: 5, conjuro: true, concentracion: true,
        filtro: (J, h, t) => t.def.tipo !== 'No muerto',
        texto: h => `Inmovilizar monstruo: salvación SAB CD ${J.cd(h)} o queda paralizado; repite al final de cada turno. Concentración.`,
        async efecto(J, h, t) {
          const objs = [t];
          if (J.rasgo(h, 'encantamientoDividido')) { const o = J.enemigosVivos().find(e => e !== t && e.def.tipo !== 'No muerto'); if (o) objs.push(o); }
          await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'paralizado', dur: H.unMinuto(h, 'sab', J.cd(h), h.concNueva) });
        },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [t && !h.conc && t.def.tipo !== 'No muerto' && t.pv > 50 ? 35 : 0, t]; } },
      { id: 'liquidacion', nombre: 'Liquidación', nivel: 11, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 6, conjuro: true,
        texto: h => `Desintegrar: salvación DES CD ${J.cd(h)} o recibe 10d6+40 de fuerza.`,
        async efecto(J, h, t) { await H.salvacion(J, h, [t], 'des', '10d6+40', 'fuerza', {}); if (!vivo(t)) J.log(`${t.nombre} queda reducido a polvo y facturas.`); },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [t ? Math.min(t.pv, 75) * 0.6 : 0, t]; } },
    ],
    gesta: { id: 'dignidad', nombre: 'Dignidad Desatada', tipo: 'gesta', objetivo: 'yo',
      texto: h => `3 rondas: nadie más puede insultar y sus conjuros de daño suman +${2 * R5.mod(h.car.int)}. Al terminar tira d20: con 1 se reinicia el combate.`,
      efecto(J, h) { J.estado(h, 'dignidad', {}); h.dignidad = 3; J.log('⚖ ¡DIGNIDAD DESATADA! Guille emerge del limbo.', 'crit'); },
      ia: (J, h) => [h.nivel >= 3 && J.enemigosVivos().reduce((s, e) => s + e.pv, 0) > 80 ? 20 : 0, h] },
  },

  // ------------------------------------------------------------- COCO
  {
    id: 'coco', nombre: 'Coco', raza: 'Humano', clase: 'Artífice', subclase: 'Armero',
    arte: 'arte/coco.jpg', cara: [0.46, 0.22, 2.6], dadoGolpe: 8, vel: () => 30, salvaciones: ['con', 'int'], lanzador: { tipo: 'artifice', atr: 'int' },
    base: { fue: 12, des: 13, con: 14, int: 17, sab: 10, car: 12 }, mejoras: { 4: { int: 2 }, 8: { int: 1, con: 1 }, 12: { con: 2 } },
    ca: h => (h.nivel >= 3 ? 18 : 17) + (h.nivel >= 10 ? 1 : 0),
    armas: [
      { id: 'ballesta', nombre: 'Ballesta ligera', atr: 'des', dados: '1d8', tipo: 'perforante', rango: 80, magia: h => h.nivel >= 2 ? 1 : 0 },
      { id: 'guanteletes', nombre: 'Guanteletes de trueno', atr: 'int', dados: '1d8', tipo: 'trueno', alcance: 5, desde: 3, magia: h => h.nivel >= 2 ? 1 : 0,
        alImpactar(J, h, t) { J.estado(t, 'provocado', { fuente: h.uid, expira: { uid: h.uid, cuando: 'inicio' } }); } },
    ],
    recursos: h => ({
      campo: { max: h.nivel >= 3 ? R5.prof(h.nivel) : 0, recarga: 'largo', nombre: 'Firewall' },
      destello: { max: h.nivel >= 7 ? Math.max(1, R5.mod(h.car.int)) : 0, recarga: 'largo', nombre: 'Destello de genio' },
      almacen: { max: h.nivel >= 11 ? 2 : 0, recarga: 'largo', nombre: 'Almacén de conjuros' },
    }),
    rasgos: [
      { id: 'rush', nivel: 1, nombre: 'Rush', texto: '+5 a la iniciativa. Su primer ataque de cada combate tiene ventaja y suma 2d6 (3d6 en nivel 5, 4d6 en nivel 11).' },
      { id: 'infusion', nivel: 2, nombre: 'Arma mejorada', texto: 'Infusión: +1 al ataque y al daño con sus armas.' },
      { id: 'armero', nivel: 3, nombre: 'Armadura arcana: Guardián', texto: 'Armadura pesada (CA 18). Guanteletes de trueno con INT: quien recibe el golpe tiene desventaja para atacar a otros.' },
      { id: 'ataqueExtra', nivel: 5, nombre: 'Ataque extra', texto: 'Ataca dos veces con la acción de Atacar.' },
      { id: 'destello', nivel: 7, nombre: 'Destello de genio (Soporte técnico)', texto: 'Reacción, INT veces por descanso largo: suma INT a la salvación fallida de un aliado.' },
      { id: 'armaduraMas', nivel: 10, nombre: 'Armadura +1', texto: '+1 a la CA.' },
    ],
    habilidades: [
      { id: 'app', nombre: 'App Infectora', nivel: 1, tipo: 'accion', objetivo: 'enemigos', alcance: 30, max: h => J.tieneObjeto(h, 'router') ? 4 : 3, espacio: 1, conjuro: true, concentracion: true,
        texto: h => `Perdición: hasta ${J.tieneObjeto(h, 'router') ? 4 : 3} enemigos a 30 pies salvan CAR CD ${J.cd(h)} o restan 1d4 a ataques y salvaciones. Coco gana 5 de oro por infectado. Concentración.`,
        async efecto(J, h, objs) {
          const f = await H.salvacion(J, h, objs, 'car', null, null, { condicion: 'perdicion', dur: t => ({ conc: h.concNueva }) });
          const oro = f.length * 5 * (J.tieneObjeto(h, 'router') ? 2 : 1);
          if (oro) { S.oro += oro; UI.flotante(h.uid, `+${oro} oro`, 'oro'); }
        },
        ia: (J, h) => [!h.conc && J.enemigosVivos().length >= 2 ? 10 : 0, null] },
      { id: 'brillo', nombre: 'Pantalla Brillante', nivel: 1, tipo: 'accion', objetivo: 'area', area: { forma: 'cubo', tam: 20 }, alcance: 60, espacio: 1, conjuro: true, concentracion: true,
        texto: h => `Fuego feérico (cubo de 20 pies a 60): las criaturas dentro salvan DES CD ${J.cd(h)} o brillan (ventaja para atacarlas). Concentración.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'des', null, null, { condicion: 'marcado', dur: () => ({ conc: h.concNueva }) }); },
        ia: (J, h) => [!h.conc && S.grupo.length >= 3 ? 9 : 0, null] },
      { id: 'firewall', nombre: 'Firewall', nivel: 3, tipo: 'adicional', objetivo: 'aliado', alcance: 30, recurso: 'campo',
        filtro: (J, h, t) => t.tipo === 'heroe' && consciente(t),
        texto: h => `Campo defensivo: ${h.nivel + R5.mod(h.car.int)} de vida temporal a Coco o a un aliado.`,
        efecto(J, h, t) { J.vidaTemporal(t, h.nivel + J.mod(h, 'int')); J.log(`${h.nombre} le instala un firewall a ${t.nombre}.`); },
        ia: (J, h) => { const t = J.heroesConscientes().filter(x => !x.temp).sort((a, b) => a.pv - b.pv)[0]; return [t ? 6 : 0, t]; } },
      { id: 'distante', nombre: 'Protección Distante', nivel: 5, tipo: 'adicional', objetivo: 'celda', alcance: 30, espacio: 2, conjuro: true,
        texto: () => 'Paso brumoso: se teletransporta a una casilla libre que vea a 30 pies (sin ataques de oportunidad).',
        efecto(J, h, c) { T.ubicar(h, c.x, c.y); J.log(`${h.nombre} se teletransporta.`); },
        ia: () => [0, null] },
      { id: 'pantallazo', nombre: 'Pantallazo Azul', nivel: 5, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 10 }, alcance: 60, espacio: 2, conjuro: true,
        texto: h => `Destrozar (radio de 10 pies a 60): salvación CON CD ${J.cd(h)}, 3d8 trueno (+1d8 por nivel de espacio sobre 2), mitad si salvan.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'con', `${1 + n}d8`, 'trueno', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 13.5) * Math.min(1, 3 / Math.max(1, J.enemigosVivos().length)), null] },
      { id: 'almacen', nombre: 'Pantallazo Almacenado', nivel: 11, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 10 }, alcance: 60, recurso: 'almacen', conjuro: true,
        texto: h => `Objeto almacenado: Pantallazo Azul (radio de 10 pies a 60, 3d8 trueno, CD ${J.cd(h)}) sin gastar espacio.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'con', '3d8', 'trueno', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 13.5) * 0.9, null] },
      { id: 'sobrecarga', nombre: 'Sobrecarga', nivel: 9, tipo: 'accion', objetivo: 'area', area: { forma: 'linea', tam: 100 }, alcance: 100, espacio: 3, conjuro: true,
        texto: h => `Relámpago (línea de 100 pies desde Coco): salvación DES CD ${J.cd(h)}, 8d6 relámpago, mitad si salvan.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'des', `${5 + n}d6`, 'relámpago', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 28) * Math.min(1, 3 / Math.max(1, J.enemigosVivos().length)), null] },
    ],
    gesta: { id: 'desvestimiento', nombre: 'Desvestimiento Repentino', tipo: 'gesta', objetivo: 'yo',
      texto: h => `Se quita la camisa: recibe el doble de daño el resto del combate, pero al empezar cada uno de sus turnos aplaude y cada enemigo recibe ${1 + Math.floor(h.nivel / 3)}d8 de trueno.`,
      efecto(J, h) { J.estado(h, 'desvestido', {}); J.log('¡Coco se quita la camisa! Aplaude y golpea el piso a ritmo ritual.', 'crit'); },
      ia: (J, h) => [h.pv > h.pvMax * 0.7 && J.enemigosVivos().length >= 3 ? 25 : 0, h] },
  },

  // ------------------------------------------------------------- TONY
  {
    id: 'tony', nombre: 'Tony', raza: 'Gnomo de las Rocas', clase: 'Artífice', subclase: 'Alquimista',
    arte: null, emoji: '🐢', dadoGolpe: 8, vel: () => 25, salvaciones: ['con', 'int'], lanzador: { tipo: 'artifice', atr: 'int' },
    base: { fue: 8, des: 14, con: 15, int: 17, sab: 12, car: 10 }, mejoras: { 4: { int: 2 }, 8: { int: 1, con: 1 }, 12: { con: 2 } },
    ca: h => 16 + Math.min(2, R5.mod(h.car.des)) + (h.nivel >= 10 ? 1 : 0),
    armas: [{ id: 'ballesta', nombre: 'Ballesta ligera', atr: 'des', dados: '1d8', tipo: 'perforante', rango: 80, magia: h => h.nivel >= 2 ? 1 : 0 }],
    recursos: h => ({
      destello: { max: h.nivel >= 7 ? Math.max(1, R5.mod(h.car.int)) : 0, recarga: 'largo', nombre: 'Destello de genio' },
      almacen: { max: h.nivel >= 11 ? 2 : 0, recarga: 'largo', nombre: 'Almacén de pócimas' },
    }),
    rasgos: [
      { id: 'astuciaGnoma', nivel: 1, nombre: 'Astucia gnoma', texto: 'Ventaja en salvaciones de INT, SAB y CAR contra magia.' },
      { id: 'infusion', nivel: 2, nombre: 'Arma mejorada', texto: 'Infusión: +1 al ataque y al daño con su ballesta.' },
      { id: 'chicha', nivel: 3, nombre: 'Chicha experimental', texto: 'Empieza cada combate con 1 chicha (2 desde nivel 6). Efecto al azar.' },
      { id: 'sabioAlquimista', nivel: 5, nombre: 'Sabio alquimista', texto: 'Suma INT a sus curaciones y al daño de ácido, veneno y fuego de sus conjuros.' },
      { id: 'destello', nivel: 7, nombre: 'Destello de genio', texto: 'Reacción, INT veces por descanso largo: suma INT a la salvación fallida de un aliado.' },
      { id: 'reactivos', nivel: 9, nombre: 'Reactivos restauradores', texto: 'Sus chichas también dan 2d6 + INT de vida temporal.' },
      { id: 'armaduraMas', nivel: 10, nombre: 'Armadura +1', texto: '+1 a la CA.' },
    ],
    habilidades: [
      { id: 'pocima', nombre: 'Pócima Defensiva', nivel: 1, tipo: 'accion', objetivo: 'aliado', alcance: 5, espacio: 1, conjuro: true,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Curar heridas: 1d8 + ${R5.mod(h.car.int) * (h.nivel >= 5 ? 2 : 1)} por nivel de espacio. Levanta a un caído.`,
        efecto(J, h, t, n) { H.curar(J, h, t, `${n}d8`, J.mod(h, 'int') * (J.rasgo(h, 'sabioAlquimista') ? 2 : 1)); },
        ia: (J, h) => { const t = IAH.herido(J, 0.4); return [t ? (t.caido ? 30 : 11) : 0, t]; } },
      { id: 'pocimaAlmacen', nombre: 'Pócima Almacenada', nivel: 11, tipo: 'accion', objetivo: 'aliado', alcance: 5, recurso: 'almacen',
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Objeto almacenado: Pócima Defensiva (1d8 + ${2 * R5.mod(h.car.int)}) sin gastar espacio.`,
        efecto(J, h, t) { H.curar(J, h, t, '1d8', 2 * J.mod(h, 'int')); },
        ia: (J, h) => { const t = IAH.herido(J, 0.4); return [t ? (t.caido ? 31 : 12) : 0, t]; } },
      { id: 'acido', nombre: 'Salpicadura Ácida', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 60, conjuro: true,
        texto: h => `El objetivo y otro enemigo a 5 pies de él salvan DES CD ${J.cd(h)}: ${H.truco(h, 6)} ácido${h.nivel >= 5 ? ` + ${R5.mod(h.car.int)}` : ''}.`,
        async efecto(J, h, t) {
          const otros = J.enemigosVivos().filter(e => e !== t && Mapas.dist(e, t) <= 1);
          await H.salvacion(J, h, [t].concat(otros.slice(0, 1)), 'des', H.truco(h, 6), 'ácido', {});
        },
        ia: (J, h) => { const t = IAH.enemigoDebil(J); return [IAH.daño(J, 3.5 * R5.escalaTruco(h.nivel), t) * Math.min(2, J.enemigosVivos().length) * 0.5, t]; } },
      { id: 'tanque', nombre: 'Defensa Tanque', nivel: 1, tipo: 'reaccion', objetivo: 'aliado',
        texto: h => `Reacción: cuando golpean a un aliado, se interpone y reduce el daño en 1d10 + ${R5.prof(h.nivel)}.`, efecto() {} },
      { id: 'preparacion', nombre: 'Preparación', nivel: 3, tipo: 'accion', objetivo: 'yo', espacio: 1,
        texto: () => 'Revuelve la olla: gasta un espacio de nivel 1 y prepara otra chicha experimental.',
        efecto(J, h) { h.chichas++; J.log(`${h.nombre} revuelve la chicha: ya tiene ${h.chichas}.`); },
        ia: () => [0, null] },
      { id: 'chicha', nombre: 'Chicha Experimental', nivel: 3, tipo: 'adicional', objetivo: 'aliado', alcance: 5,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Le da una chicha a un aliado (${h.chichas || 0} listas). d6: 1 cura 2d4+INT, 2 +1 CA, 3 +1d4 a tiradas, 4 levita, 5 vida temporal, 6 cura y audacia.`,
        requisito: (J, h) => h.chichas > 0 ? null : 'No le quedan chichas',
        efecto(J, h, t) { h.chichas--; Heroes.chicha(J, h, t); },
        ia: (J, h) => { const t = IAH.herido(J, 0.6) || h; return [h.chichas ? 6 : 0, t]; } },
      { id: 'nauseabundo', nombre: 'Rayo Nauseabundo', nivel: 3, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 1, conjuro: true,
        texto: h => `Ataque de conjuro +${J.bonoConjuro(h)}: 2d8 veneno (+1d8 por nivel de espacio); si impacta, salvación CON o queda borracho hasta el final de su próximo turno.`,
        efecto: (J, h, t, n) => H.ataqueConjuro(J, h, t, `${1 + n}d8`, 'veneno', { nombre: 'Rayo Nauseabundo', async alImpactar(res, t) {
          if (!await J.salvar(t, 'con', J.cd(h), { fuente: h, conjuro: true })) { J.estado(t, 'borracho', { expira: { uid: t.uid, cuando: 'fin' } }); J.log(`🤢 ${t.nombre} queda mareado.`); }
        } }),
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [IAH.daño(J, 9, t) * 0.6, t]; } },
      { id: 'flechaAcida', nombre: 'Chicha Ácida', nivel: 5, tipo: 'accion', objetivo: 'enemigo', alcance: 90, espacio: 2, conjuro: true,
        texto: h => `Flecha ácida: ataque de conjuro +${J.bonoConjuro(h)}, 4d4 ácido + ${R5.mod(h.car.int)} y 2d4 más al final de su próximo turno.`,
        efecto: (J, h, t, n) => H.ataqueConjuro(J, h, t, `${2 + 2 * (n - 1)}d4`, 'ácido', { nombre: 'Chicha Ácida', alImpactar(res, t) { J.estado(t, 'acido', { valor: `${n}d4`, fuente: h.uid }); } }),
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [IAH.daño(J, 17, t) * 0.65, t]; } },
      { id: 'humo', nombre: 'Bomba de Humo', nivel: 9, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 90, espacio: 3, conjuro: true, concentracion: true,
        texto: h => `Nube apestosa (radio de 20 pies a 90): al empezar cada turno, quien esté dentro salva CON CD ${J.cd(h)} o pierde la acción. Concentración.`,
        efecto(J, h, objs) { objs.forEach(e => J.estado(e, 'nube', { cd: J.cd(h), conc: h.concNueva })); J.log('Una nube de humo alcohólico cubre a los enemigos.', 'crit'); },
        ia: (J, h) => [J.enemigosVivos().length >= 3 && !h.conc ? IAH.control(J) * 0.7 : 0, null] },
      { id: 'elixir', nombre: 'Elixir Revitalizante', nivel: 9, tipo: 'adicional', objetivo: 'aliados', alcance: 60, max: 6, espacio: 3, conjuro: true,
        texto: h => `Palabra curativa en masa: cura 1d4 + ${2 * R5.mod(h.car.int)} a hasta 6 aliados a 60 pies.`,
        efecto(J, h, objs) { objs.forEach(x => H.curar(J, h, x, '1d4', 2 * J.mod(h, 'int'))); },
        ia: (J, h) => [S.grupo.filter(x => !x.muerto && (x.caido || x.pv < x.pvMax * 0.5)).length >= 2 ? 30 : 0, null] },
    ],
    gesta: { id: 'brebaje', nombre: 'Brebaje Final de la Chicha', tipo: 'gesta', objetivo: 'enemigos', alcance: 60,
      texto: h => `El grupo cura ${h.nivel}d4. Cada enemigo a 60 pies salva CON CD ${J.cd(h)}: si falla queda con la chicha (envenenado y ${1 + Math.floor(h.nivel / 2)}d6 de veneno por turno, 3 rondas); si falla con menos del 30% de su vida, muere.`,
      async efecto(J, h, objs) {
        S.grupo.filter(x => !x.muerto).forEach(x => H.curar(J, h, x, `${h.nivel}d4`, 0));
        for (const e of objs) {
          if (await J.salvar(e, 'con', J.cd(h), { fuente: h, conjuro: true })) continue;
          if (!e.jefe && e.pv < e.pvMax * 0.3) { await J.muerteInmediata(h, e, 'no aguantó la chicha', '1d6 veneno', 'veneno'); continue; }
          J.estado(e, 'veneno', { valor: `${1 + Math.floor(h.nivel / 2)}d6`, fuente: h.uid, expira: { uid: e.uid, cuando: 'fin', veces: 3 } });
        }
      },
      ia: (J, h) => [J.enemigosVivos().length * 10 + S.grupo.filter(x => x.pv < x.pvMax * 0.5).length * 8, null] },
  },

  // ----------------------------------------------------------- MALEGO
  {
    id: 'malego', nombre: 'Malego', raza: 'Elfo de los Bosques', clase: 'Bardo', subclase: 'Colegio de los Espíritus',
    arte: null, emoji: '🎸', dadoGolpe: 8, vel: () => 35, salvaciones: ['des', 'car'], lanzador: { tipo: 'completo', atr: 'car' },
    base: { fue: 8, des: 15, con: 13, int: 10, sab: 12, car: 17 }, mejoras: { 4: { car: 2 }, 8: { car: 1, des: 1 }, 12: { con: 2 } },
    ca: h => 12 + Math.min(5, R5.mod(h.car.des)),
    armas: [{ id: 'arco', nombre: 'Arco corto', atr: 'des', dados: '1d6', tipo: 'perforante', rango: 80 }],
    recursos: h => ({ inspiracion: { max: Math.max(1, R5.mod(h.car.car)), recarga: h.nivel >= 5 ? 'corto' : 'largo', nombre: 'Inspiración bárdica' } }),
    rasgos: [
      { id: 'polifacetico', nivel: 2, nombre: 'Polifacético', texto: 'Suma la mitad de su competencia a la iniciativa.' },
      { id: 'cancionDescanso', nivel: 2, nombre: 'Canción de descanso', texto: 'En la taberna, quien gaste dados de golpe cura 1d6 extra.' },
      { id: 'fuenteInspiracion', nivel: 5, nombre: 'Fuente de inspiración', texto: 'La inspiración bárdica se recupera en cada descanso corto.' },
      { id: 'espiritusMejorados', nivel: 6, nombre: 'Legendarium ampliado', texto: 'Sus familiares duran 3 rondas y tira dos veces para elegir.' },
    ],
    habilidades: [
      { id: 'timpanos', nombre: 'Explosión Metal de Tímpanos', nivel: 1, tipo: 'accion', objetivo: 'enemigo', alcance: 60, conjuro: true,
        texto: h => `Salvación CON CD ${J.cd(h)}: ${R5.escalaTruco(h.nivel) + (J.tieneObjeto(h, 'pua') ? 1 : 0)}d6 trueno; si falla, queda silenciado (sin conjuros ni habilidades verbales) hasta el final de su próximo turno.`,
        async efecto(J, h, t) {
          await H.salvacion(J, h, [t], 'con', `${R5.escalaTruco(h.nivel) + (J.tieneObjeto(h, 'pua') ? 1 : 0)}d6`, 'trueno', { condicion: 'silenciado', dur: t => ({ expira: { uid: t.uid, cuando: 'fin' } }) });
        },
        ia: (J, h) => { const lanzador = J.enemigosVivos().find(e => (e.def.especiales || []).some(x => x.verbal)); const t = lanzador || IAH.enemigoDebil(J); return [IAH.daño(J, 3.5 * R5.escalaTruco(h.nivel), t) * 0.6 + (lanzador ? 8 : 0), t]; } },
      { id: 'riff', nombre: 'Riff Inspirador', nivel: 1, tipo: 'adicional', objetivo: 'aliado', alcance: 60, recurso: 'inspiracion',
        filtro: (J, h, t) => t !== h && consciente(t) && t.tipo === 'heroe' && !J.tiene(t, 'inspirado'),
        texto: h => `Inspiración bárdica: un aliado gana un d${H.dadoInspiracion(h)} para sumar a un ataque o salvación que falle.`,
        efecto(J, h, t) { Heroes.inspirar(J, h, t); },
        ia: (J, h) => { const t = J.heroesConscientes().find(x => x !== h && !J.tiene(x, 'inspirado')); return [t && h.nivel < 3 ? 5 : 0, t]; } },
      { id: 'bateria', nombre: 'Solo de Batería', nivel: 1, tipo: 'accion', objetivo: 'area', area: { forma: 'aura', tam: 10 }, espacio: 1, conjuro: true,
        texto: h => `Onda atronadora (todo a 10 pies de Malego, aliados incluidos): salvación CON CD ${J.cd(h)}, 2d8 trueno (+1d8 por nivel de espacio) y salen despedidos 10 pies; mitad si salvan.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'con', `${1 + n}d8`, 'trueno', { mitad: true, alFallar: t => H.empujar(J, h, t, 2) }); },
        ia: (J, h) => [IAH.area(J, 9) * Math.min(1, 3 / Math.max(1, J.enemigosVivos().length)), null] },
      { id: 'balada', nombre: 'Balada Élfica', nivel: 1, tipo: 'adicional', objetivo: 'aliado', alcance: 60, espacio: 1, conjuro: true,
        filtro: (J, h, t) => t.tipo === 'heroe' && !t.muerto,
        texto: h => `Palabra curativa: cura 1d4 + ${R5.mod(h.car.car)} por nivel de espacio. Levanta a un caído.`,
        efecto(J, h, t, n) { H.curar(J, h, t, `${n}d4`, J.mod(h, 'car')); },
        ia: (J, h) => { const t = IAH.herido(J, 0.3); return [t ? (t.caido ? 30 : 8) : 0, t]; } },
      { id: 'trenzas', nombre: 'Protectio Crinium', nivel: 1, tipo: 'adicional', objetivo: 'yo', espacio: 1, conjuro: true,
        texto: h => `Se suelta las trenzas: 1d8 + ${R5.mod(h.car.car)} de vida temporal (+1d8 por nivel de espacio).`,
        efecto(J, h, t, n) { J.vidaTemporal(h, Dado.tirar(`${n}d8`).total + J.mod(h, 'car')); J.log(`El cabello de ${h.nombre} lo cubre como armadura.`); },
        ia: (J, h) => [!h.temp && h.pv < h.pvMax * 0.5 ? 5 : 0, h] },
      { id: 'invocatio', nombre: 'Invocatio Legendarium', nivel: 3, tipo: 'accion', objetivo: 'yo', recurso: 'inspiracion',
        texto: h => `Relatos del más allá: gasta inspiración e invoca un familiar al azar del Legendarium durante ${h.nivel >= 6 ? 3 : 2} rondas.`,
        requisito: () => S.familiares.some(vivo) ? 'Ya hay un familiar en juego' : null,
        efecto(J, h) { Heroes.invocarFamiliar(J, h); },
        ia: (J, h) => [S.familiares.some(vivo) ? 0 : 16, h] },
      { id: 'silencio', nombre: 'Silencio', nivel: 3, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 120, espacio: 2, conjuro: true, concentracion: true,
        texto: () => 'Esfera de silencio (radio de 20 pies a 120): las criaturas dentro quedan silenciadas (sin conjuros ni habilidades verbales) mientras dure. Concentración.',
        efecto(J, h, objs) { objs.forEach(e => J.estado(e, 'silenciado', { conc: h.concNueva })); J.log('🔇 Un silencio absoluto cae sobre la zona.', 'crit'); },
        ia: (J, h) => [!h.conc && J.enemigosVivos().some(e => (e.def.especiales || []).some(x => x.verbal)) ? 25 : 0, null] },
      { id: 'aterrador', nombre: 'Riff Aterrador', nivel: 5, tipo: 'accion', objetivo: 'area', area: { forma: 'cono', tam: 30 }, alcance: 30, espacio: 3, conjuro: true, concentracion: true,
        texto: h => `Miedo (cono de 30 pies): cada criatura dentro salva SAB CD ${J.cd(h)} o huye despavorida (pierde la acción); repite al final de cada turno. Concentración.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'aterrado', dur: H.unMinuto(h, 'sab', J.cd(h), h.concNueva) }); },
        ia: (J, h) => [J.enemigosVivos().length >= 3 && !h.conc ? IAH.control(J) * 0.9 : 0, null] },
      { id: 'escenario', nombre: 'Fuera del Escenario', nivel: 7, tipo: 'accion', objetivo: 'enemigo', alcance: 60, espacio: 4, conjuro: true, concentracion: true,
        texto: h => `Destierro: salvación CAR CD ${J.cd(h)} o desaparece mientras dure la concentración. Concentración.`,
        async efecto(J, h, t) { await H.salvacion(J, h, [t], 'car', null, null, { condicion: 'desterrado', dur: () => ({ conc: h.concNueva }) }); },
        ia: (J, h) => { const t = IAH.enemigoFuerte(J); return [t && !h.conc && t.pv > 40 && J.enemigosVivos().length > 1 ? 30 : 0, t]; } },
      { id: 'feedback', nombre: 'Feedback del Amplificador', nivel: 9, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 120, espacio: 5, conjuro: true,
        texto: h => `Estática sináptica (radio de 20 pies a 120): salvación INT CD ${J.cd(h)}, 8d6 psíquico (mitad si salvan); los que fallan restan 1d6 a ataques y salvaciones.`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'int', '8d6', 'psíquico', { mitad: true, condicion: 'estatica', dur: H.unMinuto(h, 'int', J.cd(h)) }); },
        ia: (J, h) => [IAH.area(J, 28) * 1.1, null] },
      { id: 'pirotecnia', nombre: 'Pirotecnia', nivel: 10, tipo: 'accion', objetivo: 'area', area: { forma: 'radio', tam: 20 }, alcance: 150, espacio: 3, conjuro: true,
        texto: h => `Secretos mágicos: bola de fuego (radio de 20 pies a 150). Salvación DES CD ${J.cd(h)}, 8d6 fuego, mitad si salvan.`,
        async efecto(J, h, objs, n) { await H.salvacion(J, h, objs, 'des', `${5 + n}d6`, 'fuego', { mitad: true }); },
        ia: (J, h) => [IAH.area(J, 28), null] },
      { id: 'publico', nombre: 'El Público se Rinde', nivel: 11, tipo: 'accion', objetivo: 'enemigos', alcance: 60, max: 12, espacio: 6, conjuro: true,
        texto: h => `Sugestión en masa: cada enemigo a 60 pies salva SAB CD ${J.cd(h)} o se va al pogo y no actúa durante 2 rondas (o hasta recibir daño).`,
        async efecto(J, h, objs) { await H.salvacion(J, h, objs, 'sab', null, null, { condicion: 'sugestionado', dur: t => ({ expira: { uid: t.uid, cuando: 'fin', veces: 2 } }) }); },
        ia: (J, h) => [J.enemigosVivos().length >= 3 ? IAH.control(J) * 0.8 : 0, null] },
    ],
    gesta: { id: 'pogo', nombre: 'Pogo Berserker', tipo: 'gesta', objetivo: 'enemigos', alcance: 30,
      texto: h => `Metal extremo: cada enemigo a 30 pies salva FUE CD ${J.cd(h)}. Si falla, ${2 + Math.floor(h.nivel / 2)}d8 contundente y queda aturdido hasta el final de su próximo turno; si salva, la mitad.`,
      async efecto(J, h, objs) {
        J.log('🤘 ¡POGO! Los enemigos se empujan entre ellos.', 'crit');
        await H.salvacion(J, h, objs, 'fue', `${2 + Math.floor(h.nivel / 2)}d8`, 'contundente', { mitad: true, condicion: 'aturdido', dur: t => ({ expira: { uid: t.uid, cuando: 'fin' } }) });
      },
      ia: (J, h) => [IAH.area(J, 4.5 * (2 + h.nivel / 2)) + J.enemigosVivos().length * 6, null] },
  },
];

// =====================================================================
//  TALENTOS (uno por cada nivel desde el 2)
// =====================================================================
// max: cuántas veces se puede elegir. requiere: (def) -> ¿lo puede tomar?
// auto: orden en que los toman los bots y el simulador.
const TALENTOS = [
  { id: 'robustez', icono: '❤️', nombre: 'Robustez', texto: '+3 puntos de golpe máximos.', max: 4 },
  { id: 'filo', icono: '⚔️', nombre: 'Filo', texto: '+1 al daño de los ataques con armas.', max: 3 },
  { id: 'arcano', icono: '🔮', nombre: 'Poder arcano', texto: '+1 al daño de los conjuros y habilidades mágicas.', max: 3, requiere: def => !!def.lanzador },
  { id: 'punteria', icono: '🎯', nombre: 'Puntería', texto: '+1 a todas las tiradas de ataque (armas y conjuros).', max: 1 },
  { id: 'guardia', icono: '🛡️', nombre: 'Guardia', texto: '+1 a la clase de armadura.', max: 1 },
  { id: 'voluntad', icono: '🧠', nombre: 'Voluntad', texto: '+1 a todas las tiradas de salvación.', max: 2 },
  { id: 'reflejos', icono: '⚡', nombre: 'Reflejos', texto: '+3 a la iniciativa.', max: 1 },
];
const TALENTOS_AUTO = {
  armas: ['filo', 'robustez', 'punteria', 'filo', 'robustez', 'guardia', 'filo', 'robustez', 'voluntad', 'robustez', 'reflejos', 'voluntad'],
  magia: ['arcano', 'robustez', 'punteria', 'arcano', 'robustez', 'voluntad', 'arcano', 'guardia', 'robustez', 'voluntad', 'robustez', 'reflejos'],
};

// =====================================================================
//  REGLAS DE PERSONAJE
// =====================================================================
const Heroes = {
  // Las mejoras de los niveles 4, 8 y 12: las que eligió el jugador o, si no eligió, las sugeridas.
  caracteristicas(def, nivel, elec) {
    const c = Object.assign({}, def.base);
    Object.entries(def.mejoras).forEach(([n, m]) => {
      if (nivel >= +n) Object.entries((elec && elec.mejoras[n]) || m).forEach(([k, v]) => c[k] = Math.min(20, c[k] + v));
    });
    return c;
  },
  // Veces que eligió un talento hasta su nivel actual.
  talento(h, id) {
    const t = h.elecciones && h.elecciones.talentos;
    return t ? Object.entries(t).filter(([n, v]) => v === id && +n <= h.nivel).length : 0;
  },
  // Talentos que puede tomar en el nivel n (sin contar lo elegido en ese mismo nivel).
  talentosDisponibles(h, n) {
    const t = (h.elecciones && h.elecciones.talentos) || {};
    const veces = id => Object.entries(t).filter(([k, v]) => v === id && +k !== n && +k <= Math.max(n, h.nivel)).length;
    return TALENTOS.map(x => ({ ...x, veces: veces(x.id), puede: (!x.requiere || x.requiere(h.def)) && veces(x.id) < x.max }));
  },
  // Niveles ya alcanzados en los que todavía no eligió talento.
  pendientes(h) {
    const t = (h.elecciones && h.elecciones.talentos) || {};
    const r = [];
    for (let n = 2; n <= h.nivel; n++) if (!t[n]) r.push(n);
    return r;
  },
  eleccionAuto(h, n) {
    const orden = TALENTOS_AUTO[h.def.lanzador && h.def.lanzador.tipo !== 'medio' ? 'magia' : 'armas'];
    const disp = Heroes.talentosDisponibles(h, n).filter(x => x.puede);
    // Recorre el orden y toma el primero que todavía no eligió tantas veces como pide el orden hasta ahí.
    const pide = {};
    let talento = null;
    for (const id of orden.concat(TALENTOS.map(x => x.id))) {
      pide[id] = (pide[id] || 0) + 1;
      const x = disp.find(d => d.id === id);
      if (x && x.veces < pide[id]) { talento = id; break; }
    }
    return { talento, mejora: h.def.mejoras[n] ? Object.assign({}, h.def.mejoras[n]) : undefined };
  },
  // Elecciones automáticas desde el nivel 2 hasta 'nivel' (simulador, héroes nuevos de prueba).
  eleccionesAuto(def, nivel) {
    const h = { def, nivel, elecciones: { talentos: {}, mejoras: {} } };
    for (let n = 2; n <= nivel; n++) Heroes.elegir(h, n, Heroes.eleccionAuto(h, n));
    return h.elecciones;
  },
  elegir(h, n, elec) {
    if (!h.elecciones) h.elecciones = { talentos: {}, mejoras: {} };
    if (elec.talento) h.elecciones.talentos[n] = elec.talento;
    if (elec.mejora && h.def.mejoras[n]) h.elecciones.mejoras[n] = elec.mejora;
  },
  pvMax(def, nivel, car) {
    const con = R5.mod(car.con);
    return def.dadoGolpe + con + (nivel - 1) * (def.dadoGolpe / 2 + 1 + con);
  },
  // Recalcula lo que depende del nivel. nuevo: empieza con todo lleno.
  recalcular(h, nuevo) {
    h.car = Heroes.caracteristicas(h.def, h.nivel, h.elecciones);
    h.pvMax = Heroes.pvMax(h.def, h.nivel, h.car) + 3 * Heroes.talento(h, 'robustez') + (h.auxilio || 0);
    if (nuevo) h.pv = h.pvMax; else h.pv = Math.min(h.pv, h.pvMax);
    const rec = h.def.recursos(h);
    rec.gesta = { max: 1, recarga: 'expedicion', nombre: 'Gesta' };
    Object.entries(rec).forEach(([k, r]) => {
      const usados = h.recursos[k] ? h.recursos[k].usados : 0;
      h.recursos[k] = Object.assign({ usados: nuevo ? 0 : usados }, r);
    });
    const max = h.def.lanzador ? R5.ESPACIOS[h.def.lanzador.tipo][h.nivel].slice() : [];
    const usados = max.map((m, i) => nuevo ? 0 : Math.min(m, h.espacios.usados[i] || 0));
    h.espacios = { max, usados };
  },
  armaActual(h, id) { return h.def.armas.find(a => a.id === id); },
  armas(h) { return h.def.armas.filter(a => (!a.desde || h.nivel >= a.desde) && (!a.hasta || h.nivel <= a.hasta)); },
  ataquesPorAccion(h) { return J.rasgo(h, 'ataqueExtra') ? 2 : 1; },
  // Todas las acciones disponibles en su nivel: ataques, comunes, de clase y la gesta.
  habilidades(h) {
    if (h._cache && h._cache.nivel === h.nivel) return h._cache.lista;
    const lista = Heroes.armas(h).map(atacar).concat(
      h.def.habilidades.filter(a => h.nivel >= a.nivel), ACCIONES_COMUNES, [h.def.gesta]);
    h._cache = { nivel: h.nivel, lista };
    return lista;
  },
  necesitaObjetivo(a) { return a.objetivo === 'enemigo' || a.objetivo === 'aliado'; },
  // Alcance de una habilidad en pies (60 si no dice).
  alcance(h, a) { return a.alcance || 60; },
  objetivoValido(J, h, a, t) {
    if (!t) return false;
    let ok = false;
    if (a.objetivo === 'enemigo') ok = t.tipo === 'enemigo' && vivo(t) && !J.tiene(t, 'desterrado') && (!a.filtro || a.filtro(J, h, t));
    if (a.objetivo === 'aliado') ok = t.tipo !== 'enemigo' && (a.filtro ? a.filtro(J, h, t) : consciente(t));
    return ok && (t === h || T.enAlcance(h, t, Heroes.alcance(h, a)));
  },
  area(h, a) { return a.area; },
  // ¿Se puede apuntar el área a esta casilla? (radio y cubo: a 'alcance' y a la vista)
  puntoValido(h, a, c) {
    const f = a.area.forma;
    if (f === 'aura') return true;
    if (f === 'cono' || f === 'linea') return !(c.x === h.x && c.y === h.y);
    const d = Mapas.dist(h, { x: c.x, y: c.y, tam: 1 });
    const [hx, hy] = Mapas.centro(h);
    return d * 5 <= Heroes.alcance(h, a) && Mapas.vista(S.mapa, hx, hy, c.x + 0.5, c.y + 0.5);
  },
  casillasArea(h, a, c) {
    const f = a.area.forma;
    return Mapas.area(S.mapa, f, a.area.tam, f === 'radio' || f === 'cubo' ? null : h, c);
  },
  // Criaturas dentro del área (el lanzador solo cae en las de radio o cubo).
  enArea(h, a, c) {
    const set = Heroes.casillasArea(h, a, c);
    return J.todos().filter(u => T.enTablero(u) && (u.tipo === 'heroe' || vivo(u)) && Mapas.enArea(u, set));
  },
  celdaValida(h, a, c) {
    const [hx, hy] = Mapas.centro(h);
    return Mapas.dist(h, { x: c.x, y: c.y, tam: 1 }) * 5 <= Heroes.alcance(h, a) && Mapas.vista(S.mapa, hx, hy, c.x + 0.5, c.y + 0.5)
      && Mapas.cabe(S.mapa, h, c.x, c.y, T.ocupado(), true);
  },
  // Grupo automático: enemigos o aliados a 'alcance' (los enemigos más fuertes primero; los aliados más heridos).
  grupoObjetivo(h, a) {
    const max = typeof a.max === 'function' ? a.max(h) : a.max || 99;
    const pool = a.objetivo === 'enemigos' ? J.enemigosVivos() : S.grupo.filter(x => !x.muerto).concat(S.familiares.filter(vivo));
    return pool.filter(t => T.enTablero(t) && T.enAlcance(h, t, Heroes.alcance(h, a)) && (!a.filtro || a.filtro(J, h, t)))
      .sort((p, q) => a.objetivo === 'enemigos' ? q.pv - p.pv : p.pv / p.pvMax - q.pv / q.pvMax).slice(0, max);
  },
  // Mejor casilla para un área (para los bots): enemigos atrapados menos aliados.
  mejorPunto(h, a) {
    let mejor = null;
    const cand = new Map();
    J.enemigosVivos().filter(T.enTablero).forEach(e => Mapas.celdas(e).forEach(([x, y]) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cand.set(`${x + dx},${y + dy}`, { x: x + dx, y: y + dy });
    }));
    if (a.area.forma === 'aura') cand.clear(), cand.set('yo', { x: h.x, y: h.y });
    for (const c of cand.values()) {
      if (c.x < 0 || c.y < 0 || c.x >= S.mapa.ancho || c.y >= S.mapa.alto || !Heroes.puntoValido(h, a, c)) continue;
      const dentro = Heroes.enArea(h, a, c);
      const enemigos = dentro.filter(u => u.tipo === 'enemigo');
      const aliados = dentro.filter(u => u.tipo !== 'enemigo');
      const v = enemigos.reduce((s, e) => s + Math.min(e.pv, 15 + e.def.nd * 3), 0) - aliados.length * 25;
      if (enemigos.length && (!mejor || v > mejor.v)) mejor = { celda: c, v, n: enemigos.length, aliados: aliados.length };
    }
    return mejor;
  },
  iniciativa(h) {
    let bono = R5.mod(h.car.des);
    if (J.rasgo(h, 'polifacetico')) bono += Math.floor(R5.prof(h.nivel) / 2);
    if (J.rasgo(h, 'rush')) bono += 5;
    bono += 3 * Heroes.talento(h, 'reflejos');
    const d = J.rasgo(h, 'instintoSalvaje') ? Math.max(Dado.d(20), Dado.d(20)) : Dado.d(20);
    return { d, bono };
  },
  alIniciarCombate(h) {
    if (J.rasgo(h, 'rush')) J.estado(h, 'rush', {});
    if (h.def.id === 'tony') h.chichas = (h.nivel >= 6 ? 2 : h.nivel >= 3 ? 1 : 0) + (J.tieneObjeto(h, 'jora') ? 1 : 0);
    if (J.tieneObjeto(h, 'petaca')) J.vidaTemporal(h, Dado.d(8) + J.mod(h, 'car'));
  },
  async alInicioTurno(h) {
    if (J.tiene(h, 'desvestido')) {
      J.log('👏 Coco aplaude y golpea el piso.', 'accion');
      const dados = `${1 + Math.floor(h.nivel / 3)}d8`;
      for (const e of J.enemigosVivos()) { const d = await J.dañar(e, Dado.tirar(dados).total, 'trueno', h, { magico: true }); if (Stats) Stats.heroe(h).daño += d; }
    }
    if (h.dignidad) {
      h.dignidad--;
      if (h.dignidad <= 0) {
        h.dignidad = 0; J.quitar(h, 'dignidad');
        const d = Dado.d(20);
        J.log(`Guille vuelve a su limbo y tira el d20 del destino: ${d}.`);
        if (d === 1) {
          J.log('🔄 ¡El limbo reinicia el combate! Todos vuelven a como empezaron.', 'crit');
          S.grupo.forEach(x => { if (x.inicioCombate && !x.muerto) { x.pv = x.inicioCombate.pv; x.caido = x.inicioCombate.caido; x.estados = {}; } });
          S.enemigos.forEach(e => { if (e.inicioCombate) e.pv = e.inicioCombate.pv; e.estados = {}; });
        }
      }
    }
  },
  inspirar(J, h, t) {
    J.estado(t, 'inspirado', { valor: H.dadoInspiracion(h), infalible: J.rasgo(h, 'inspiracionInfalible') });
    J.log(`🎵 ${h.nombre} inspira a ${t.nombre} (d${H.dadoInspiracion(h)}).`);
    if (J.tieneObjeto(h, 'botas')) J.curar(t, Dado.d(6), h);
  },
  pocion(J, h, t) {
    const mayor = S.pociones.mayor > 0 && (t.caido || t.pvMax - t.pv > 12 || !S.pociones.comun);
    if (mayor) S.pociones.mayor--; else S.pociones.comun--;
    const v = Dado.tirar(mayor ? '4d4+4' : '2d4+2').total;
    J.log(`🧪 ${t.nombre} toma una poción${mayor ? ' mayor' : ''}: +${v}.`);
    J.curar(t, v, h);
  },
  chicha(J, h, t) {
    const d = Dado.d(6), int = J.mod(h, 'int');
    const nombres = ['', 'curativa', 'resiliente', 'audaz', 'voladora', 'transformadora', 'de jora'];
    J.log(`🍶 ${t.nombre} toma chicha ${nombres[d]}.`);
    if (d === 1 || d === 6) J.curar(t, Dado.tirar('2d4').total + int, h);
    if (d === 2) J.estado(t, 'resiliente', { expira: { uid: t.uid, cuando: 'fin', veces: 10 } });
    if (d === 3 || d === 6) J.estado(t, 'audaz', { expira: { uid: t.uid, cuando: 'fin', veces: 10 } });
    if (d === 4) J.estado(t, 'levitando', { expira: { uid: t.uid, cuando: 'fin', veces: 10 } });
    if (d === 5) J.vidaTemporal(t, Dado.d(8) + h.nivel);
    if (J.rasgo(h, 'reactivos')) J.vidaTemporal(t, Dado.tirar('2d6').total + int);
  },
  invocarFamiliar(J, m) {
    let f = J.azar(FAMILIARES);
    if (J.rasgo(m, 'espiritusMejorados') && f.id === 'gollum') f = J.azar(FAMILIARES);
    const pv = 10 + 3 * m.nivel;
    const u = { uid: nuevoUid(), tipo: 'familiar', bando: 'grupo', tam: 1, vel: { camina: 30 }, def: f, nombre: f.nombre, emoji: f.emoji, pv, pvMax: pv, temp: 0, estados: {},
      rondas: J.rasgo(m, 'espiritusMejorados') ? 3 : 2, invocador: m, mujer: !!f.mujer, iniciativa: m.iniciativa };
    T.colocarCerca(u, m);
    S.familiares = S.familiares.filter(vivo).concat([u]);
    S.orden.splice(S.orden.indexOf(m.uid) + 1, 0, u.uid);
    J.log(`📖 ${m.nombre} invoca a ${f.nombre} del Legendarium. ${f.texto}`, 'crit');
  },
  // Descanso corto (taberna): recursos de descanso corto y espacios de Guille.
  descansoCorto() {
    S.grupo.forEach(h => {
      Object.values(h.recursos).forEach(r => { if (r.recarga === 'corto') r.usados = 0; });
      if (J.rasgo(h, 'recuperacionArcana') && J.recurso(h, 'recuperacion') > 0 && h.espacios.usados.some(u => u > 0)) {
        let presupuesto = Math.ceil(h.nivel / 2);
        for (let i = Math.min(5, h.espacios.max.length) - 1; i >= 0 && presupuesto > 0; i--) {
          while (h.espacios.usados[i] > 0 && i + 1 <= presupuesto) { h.espacios.usados[i]--; presupuesto -= i + 1; }
        }
        J.usarRecurso(h, 'recuperacion');
        J.log(`${h.nombre} repasa sus apuntes y recupera espacios de conjuro.`);
      }
    });
  },
  // Lo que gana al llegar a su nivel actual.
  novedades(h) {
    const n = h.nivel;
    const r = [];
    h.def.habilidades.filter(a => a.nivel === n).forEach(a => r.push(a.nombre));
    h.def.rasgos.filter(a => a.nivel === n).forEach(a => r.push(a.nombre));
    const mej = (h.elecciones && h.elecciones.mejoras[n]) || h.def.mejoras[n];
    if (mej) r.push('Mejora de características: ' + Object.entries(mej).map(([k, v]) => `${R5.CORTO_ATR[k]} +${v}`).join(', '));
    const tal = TALENTOS.find(x => x.id === (h.elecciones && h.elecciones.talentos[n]));
    if (tal) r.push(`Talento: ${tal.icono} ${tal.nombre}`);
    if ([5, 9].includes(n)) r.push('Competencia +' + R5.prof(n));
    if ([5, 11].includes(n) && h.def.lanzador) r.push('Trucos más fuertes');
    return r;
  },
};
