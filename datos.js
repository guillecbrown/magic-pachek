// =====================================================================
//  MAGIC PACHEK - expediciones, encuentros, taberna y modificadores
//
//  Los encuentros se arman como en la Guía del Dungeon Master: cada
//  héroe aporta un umbral de PX según su nivel (fácil, medio, difícil,
//  mortal) y los monstruos se eligen hasta llenar ese presupuesto,
//  multiplicado por la cantidad de monstruos. El combate final usa el
//  umbral siguiente.
// =====================================================================

// Dificultad: qué umbral de la Guía usan los combates normales (0 fácil,
// 1 medio, 2 difícil, 3 mortal). El jefe usa el siguiente; en Difícil,
// mortal x1,2. Hay taberna (descanso corto) entre cada combate.
const DIFICULTADES = {
  facil:   { nombre: 'Fácil',   umbral: 1, texto: 'Combates medios; el jefe, difícil.' },
  normal:  { nombre: 'Normal',  umbral: 2, texto: 'Combates difíciles; el jefe, mortal.' },
  dificil: { nombre: 'Difícil', umbral: 3, texto: 'Combates mortales; el jefe, un poco más que mortal.' },
};

const LARGOS = {
  corta: { nombre: 'Corta', combates: 3 },
  larga: { nombre: 'Larga', combates: 5 },
};

// Temas de cada etapa: qué monstruos del Manual pueden aparecer.
const TEMAS = {
  camino: { nombre: 'El camino a la taberna', ayuda: 'Bandidos y alimañas del camino.',
    pool: ['mm_goblin', 'mm_goblin_boss', 'mm_kobold', 'mm_winged_kobold', 'mm_bandit', 'mm_bandit_captain', 'mm_thug', 'mm_wolf',
      'mm_worg', 'mm_dire_wolf', 'mm_hobgoblin', 'mm_hobgoblin_captain', 'mm_bugbear', 'mm_bugbear_chief', 'mm_giant_spider',
      'mm_owlbear', 'mm_ettercap', 'mm_veteran', 'mm_gladiator', 'mm_ogre', 'mm_ettin', 'mm_hill_giant', 'mm_hobgoblin_warlord',
      'mm_assassin', 'mm_manticore', 'mm_wyvern', 'mm_young_green_dragon', 'mm_stone_giant'] },
  pantano: { nombre: 'El pantano', ayuda: 'Brujas, sapos y cosas que viven en el barro.',
    pool: ['mm_bullywug', 'mm_giant_frog', 'mm_giant_toad', 'mm_lizardfolk', 'mm_lizardfolk_shaman', 'mm_lizard_king_queen', 'mm_crocodile',
      'mm_giant_crocodile', 'mm_swarm_of_insects', 'mm_swarm_of_poisonous_snakes', 'mm_will_o_wisp', 'mm_sea_hag', 'mm_green_hag',
      'mm_black_dragon_wyrmling', 'mm_young_black_dragon', 'mm_shambling_mound', 'mm_hydra', 'mm_troll', 'mm_giant_constrictor_snake',
      'mm_harpy', 'mm_ghoul', 'mm_night_hag', 'mm_bone_naga', 'mm_spirit_naga', 'mm_adult_black_dragon'] },
  puente: { nombre: 'El puente maldito', ayuda: 'Muertos que no descansan y lo que vive bajo el puente.',
    pool: ['mm_skeleton', 'mm_zombie', 'mm_ghoul', 'mm_ghast', 'mm_shadow', 'mm_specter', 'mm_wight', 'mm_banshee', 'mm_wraith',
      'mm_troll', 'mm_ogre', 'mm_ogre_zombie', 'mm_minotaur_skeleton', 'mm_harpy', 'mm_mummy', 'mm_revenant', 'mm_vampire_spawn',
      'mm_bone_devil', 'mm_mummy_lord', 'mm_vampire', 'mm_wraith', 'mm_flameskull'] },
  campamento: { nombre: 'El campamento orco', ayuda: 'Orcos, ogros y sus bestias de guerra.',
    pool: ['mm_orc', 'mm_orog', 'mm_orc_eye_of_gruumsh', 'mm_orc_war_chief', 'mm_half_ogre', 'mm_ogre', 'mm_worg', 'mm_dire_wolf',
      'mm_hill_giant', 'mm_ettin', 'mm_berserker', 'mm_veteran', 'mm_troll', 'mm_cyclops', 'mm_fomorian', 'mm_frost_giant',
      'mm_fire_giant', 'mm_oni', 'mm_stone_giant', 'mm_young_red_dragon'] },
};

const EXPEDICIONES = {
  pantano: { nombre: 'El Pantano', texto: 'La historia de siempre: del camino a la taberna hasta el trono de la Reina Bruja del Pantano.',
    temas: ['camino', 'pantano', 'puente', 'campamento'], jefe: 'reina' },
  mazmorra: { nombre: 'Mazmorra', texto: 'Cualquier monstruo del Manual. Al fondo espera lo más temible que el grupo pueda enfrentar.',
    temas: null, jefe: 'mazmorra' },
};

// Taberna (descanso corto). Precios en monedas de oro, como en el Manual del Jugador.
const TABERNA = [
  { id: 'pocion',      nombre: 'Poción de curación',       precio: 50,  texto: 'Cura 2d4+2. Se toma como acción adicional o se le da a un caído.' },
  { id: 'pocionMayor', nombre: 'Poción de curación mayor', precio: 150, texto: 'Cura 4d4+4.' },
  { id: 'revivir',     nombre: 'Revivificar',              precio: 300, texto: 'El sacerdote del pueblo devuelve la vida a un héroe muerto (1 PV).' },
  { id: 'objeto',      nombre: 'Objeto mágico',            precio: 250, texto: 'Un objeto personal que mejora una habilidad. Se queda con el héroe.' },
  { id: 'apuesta',     nombre: 'Apuesta con el tabernero', precio: 25,  texto: 'Tira d20. Puede salir muy bien... o te toca invitar.' },
  { id: 'chisme',      nombre: 'Chisme del tabernero',     precio: 10,  texto: 'Revela qué enemigos vienen en el próximo combate.' },
];

const MODIFICADORES = {
  ninguno: { nombre: 'Sin modificador', texto: 'La expedición normal.' },
  chelas:  { nombre: 'Noche de chelas', texto: 'Todos (héroes y enemigos) empiezan cada combate borrachos hasta el final de su primer turno.' },
  luna:    { nombre: 'Luna llena', texto: 'Los enemigos hacen +2 de daño, pero el oro se duplica.', desbloqueo: 'Ganar en Normal o Difícil' },
  resaca:  { nombre: 'Resaca', texto: 'Empiezan la expedición con media vida, pero ganan 50% más de PX.', desbloqueo: 'Ganar en Difícil' },
};

// =====================================================================
//  ARMADO DE ENCUENTROS
// =====================================================================
const Expediciones = {
  crear(tipo, largo, nivel, tam, dificultad) {
    const def = EXPEDICIONES[tipo];
    const n = LARGOS[largo].combates;
    const etapas = [];
    for (let i = 0; i < n - 1; i++) {
      const tema = def.temas ? def.temas[n === 3 ? [0, 1][i] : i] : null;
      // mapa: escenario del tablero (ver mapas.js).
      etapas.push(tema ? { nombre: TEMAS[tema].nombre, ayuda: TEMAS[tema].ayuda, tema, mapa: tema }
        : { nombre: ['La entrada', 'Los túneles', 'La cripta', 'Las profundidades'][i], ayuda: 'Monstruos al azar del Manual.', mapa: 'mazmorra' });
    }
    etapas.push(def.jefe === 'reina'
      ? { nombre: 'El trono del pantano', jefe: true, mapa: 'trono', ayuda: 'La Reina Bruja del Pantano: acciones legendarias y, a media vida, llama a su corte.' }
      : { nombre: 'La guarida', jefe: true, mapa: 'mazmorra', ayuda: 'Lo más temible que el grupo puede enfrentar.' });
    return { tipo, largo, dificultad, etapas, jefeNombre: null,
      victoria() { return `El grupo derrotó a ${this.jefeNombre || 'la Reina Bruja del Pantano'}. Las chelas corren por cuenta de la casa.`; } };
  },

  // Presupuesto de PX: suma de umbrales de cada héroe vivo.
  presupuesto(exp, jefe) {
    const u = DIFICULTADES[exp.dificultad].umbral;
    const heroes = S.grupo.filter(h => !h.muerto);
    const total = heroes.reduce((s, h) => s + R5.UMBRALES[h.nivel][Math.min(3, u + (jefe ? 1 : 0))], 0);
    return Math.round(total * (jefe && u >= 3 ? 1.2 : 1));
  },
  nivelGrupo() { const l = S.grupo.filter(h => !h.muerto); return Math.max(1, Math.round(l.reduce((s, h) => s + h.nivel, 0) / Math.max(1, l.length))); },

  encuentro(exp, i) {
    const etapa = exp.etapas[i];
    const presupuesto = Expediciones.presupuesto(exp, etapa.jefe);
    const nivel = Expediciones.nivelGrupo();
    const tam = S.grupo.filter(h => !h.muerto).length;
    if (etapa.jefe && exp.tipo === 'pantano') {
      // Las acciones legendarias y la corte que invoca valen por varios monstruos.
      const nd = Expediciones.ndPara(presupuesto * 0.45);
      const reina = Expediciones.reina(nd, nivel);
      exp.jefeNombre = reina.nombre;
      return [{ key: 'reina', def: reina }];
    }
    // Un solo monstruo grande en el límite "mortal" gana la mitad de las veces: se le da el 75%.
    if (etapa.jefe) return Expediciones.jefeMazmorra(exp, presupuesto * 0.75, nivel, tam);
    const pool = etapa.tema ? TEMAS[etapa.tema].pool : Object.keys(MONSTRUOS);
    return Expediciones.armar(pool, presupuesto, nivel, tam);
  },

  px: k => R5.PX_ND[MONSTRUOS[k].nd] || 0,
  ajustado(lista, tam) { return lista.reduce((s, k) => s + Expediciones.px(k), 0) * R5.multiplicador(lista.length, tam); },

  armar(pool, presupuesto, nivel, tam) {
    const px = Expediciones.px;
    const cand = pool.filter(k => MONSTRUOS[k] && MONSTRUOS[k].sorteo !== false && px(k) <= presupuesto && MONSTRUOS[k].nd <= nivel + 3);
    if (!cand.length) {
      const todos = Object.keys(MONSTRUOS).filter(k => MONSTRUOS[k].sorteo !== false && px(k) <= presupuesto);
      return todos.length ? Expediciones.armar(todos, presupuesto, nivel, tam) : ['mm_goblin'];
    }
    const maxN = Math.min(8, 2 * tam + 2);
    let mejor = null, mejorPuntos = Infinity;
    for (let intento = 0; intento < 60; intento++) {
      const lideres = cand.filter(k => px(k) >= presupuesto * 0.12);
      const lider = J.azar(lideres.length ? lideres : cand);
      const grupo = [lider];
      for (let fallos = 0; grupo.length < maxN && fallos < 4;) {
        const menores = cand.filter(k => px(k) <= px(lider));
        const k = Math.random() < 0.5 ? lider : J.azar(menores);
        if (Expediciones.ajustado(grupo.concat([k]), tam) <= presupuesto) grupo.push(k); else fallos++;
      }
      const adj = Expediciones.ajustado(grupo, tam);
      const puntos = Math.abs(presupuesto - adj) + (adj > presupuesto ? presupuesto : 0) + (grupo.length === 1 && tam > 2 ? presupuesto * 0.25 : 0);
      if (puntos < mejorPuntos) { mejor = grupo; mejorPuntos = puntos; }
    }
    return mejor;
  },

  // Jefe de la mazmorra: un legendario si cabe; si no, el monstruo más fuerte que quepa, con escolta.
  jefeMazmorra(exp, presupuesto, nivel, tam) {
    const px = Expediciones.px;
    const todos = Object.keys(MONSTRUOS).filter(k => !MONSTRUOS[k].bueno && px(k) <= presupuesto && MONSTRUOS[k].sorteo !== false);
    const legend = todos.filter(k => (MONSTRUOS[k].rasgos || {}).legendarias && px(k) >= presupuesto * 0.45);
    let jefe = legend.length ? J.azar(legend) : null;
    if (!jefe) {
      const fuertes = todos.filter(k => px(k) >= presupuesto * 0.4).sort((a, b) => px(b) - px(a));
      jefe = J.azar(fuertes.slice(0, 8)) || todos.sort((a, b) => px(b) - px(a))[0] || 'mm_ogre';
    }
    exp.jefeNombre = MONSTRUOS[jefe].nombre;
    const grupo = [{ key: jefe, def: Object.assign({}, MONSTRUOS[jefe], { jefe: true }) }];
    // Escolta con lo que sobre del presupuesto.
    const resto = presupuesto - px(jefe) * R5.multiplicador(1, tam);
    if (resto > presupuesto * 0.25) {
      const esc = Expediciones.armar(todos.filter(k => k !== jefe && px(k) <= px(jefe) / 3), resto / 2, nivel, tam).slice(0, 3);
      esc.forEach(k => grupo.push(k));
    }
    return grupo;
  },

  ndPara(px) {
    let nd = 0.5;
    for (const [n] of R5.POR_ND) if (R5.PX_ND[n] <= px) nd = n;
    return nd;
  },

  // La Reina Bruja del Pantano se construye con la tabla de la Guía del DM según el ND.
  reina(nd, nivel) {
    const [, ca, pvTabla, atk, dpr, cd] = R5.POR_ND.find(f => f[0] >= nd) || R5.POR_ND[R5.POR_ND.length - 1];
    // La tabla de la Guía da más vida que los monstruos reales del Manual de ese ND.
    const pv = Math.round(pvTabla * (nd < 5 ? 0.6 : 0.8));
    const prof = nd < 5 ? 2 : nd < 9 ? 3 : nd < 13 ? 4 : 5;
    const car = Math.min(5, 2 + Math.floor(nd / 3));
    // El daño por ronda de la tabla se reparte en 2 golpes propios y 2 legendarios.
    const porGolpe = dpr / 4;
    const mas = Math.max(1, atk - prof);
    const n = Math.max(1, Math.round((porGolpe - mas) / 4.5));
    const ritual = Math.max(1, Math.round(dpr * 0.3 / 3.5));
    const corte = nd >= 8 ? 'mm_troll' : nd >= 4 ? 'mm_lizardfolk' : nd >= 2 ? 'mm_bullywug' : 'mm_goblin';
    return {
      nombre: 'Reina Bruja del Pantano', en: 'Swamp Witch Queen', emoji: '👑', tipo: 'Feérico', nd, ca, pv, prof,
      arte: (MONSTRUOS.mm_green_hag || {}).arte,
      mods: { fue: 2, des: 2, con: 3, int: 2, sab: 3, car }, salv: { fue: 2, des: 2, con: 3 + prof, int: 2, sab: 3 + prof, car: car + prof },
      ataques: [{ nombre: 'Golpe de cetro', bono: atk, daño: [{ n, caras: 8, mas, tipo: 'contundente' }], distancia: false }],
      multi: [[0, 2]],
      // Con ND bajo (héroes de nivel 1-2) no tiene acciones legendarias ni chisme.
      especiales: [
        { nombre: 'Ritual del Pantano', salv: 'con', cd, daño: [{ n: ritual, caras: 6, mas: 0, tipo: 'necrótico' }], mitad: true, area: true, recarga: 5, usos: null, verbal: true },
      ].concat(nd >= 2 ? [
        { nombre: 'Chisme venenoso', salv: 'sab', cd, daño: [{ n: Math.max(1, Math.round(ritual / 2)), caras: 6, mas: 0, tipo: 'psíquico' }], mitad: true, area: true, condicion: 'asustado', recarga: 6, usos: null, verbal: true },
      ] : []),
      rasgos: { legendarias: nd >= 5 ? 2 : nd >= 2 ? 1 : 0, resistenciaLegendaria: nd >= 5 ? 2 : 1, resistenciaMagica: nd >= 8 },
      mujer: true, jefe: true, pag: null,
      alMitad: { nombre: 'La corte del pantano', invoca: corte, cantidad: nd >= 2 ? 2 : 1 },
    };
  },
};
