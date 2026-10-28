// =====================================================================
//  MAGIC PACHEK - reglas de D&D 5e que usa el juego
//  Tablas del Manual del Jugador y de la Guía del Dungeon Master, dados
//  y condiciones. Lo usan heroes.js, motor.js y datos.js.
// =====================================================================

const R5 = {
  ATRIBUTOS: ['fue', 'des', 'con', 'int', 'sab', 'car'],
  NOMBRE_ATR: { fue: 'Fuerza', des: 'Destreza', con: 'Constitución', int: 'Inteligencia', sab: 'Sabiduría', car: 'Carisma' },
  CORTO_ATR: { fue: 'FUE', des: 'DES', con: 'CON', int: 'INT', sab: 'SAB', car: 'CAR' },

  mod: v => Math.floor((v - 10) / 2),
  prof: nivel => 2 + Math.floor((nivel - 1) / 4),
  // Trucos: el daño sube en los niveles 5 y 11.
  escalaTruco: nivel => 1 + (nivel >= 5) + (nivel >= 11),

  // Experiencia acumulada para llegar a cada nivel (índice = nivel).
  PX_NIVEL: [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000],
  NIVEL_MAX: 12,

  // PX que da cada nivel de desafío.
  PX_ND: { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
    9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
    19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
    28: 120000, 29: 135000, 30: 155000 },

  // Umbrales de PX por personaje para armar encuentros: [fácil, medio, difícil, mortal].
  UMBRALES: [null, [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500],
    [250, 500, 750, 1100], [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100],
    [550, 1100, 1600, 2400], [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500]],

  // Multiplicador de PX según cuántos monstruos hay (grupos chicos lo sienten más).
  multiplicador(n, tamGrupo) {
    const escala = [1, 1.5, 2, 2.5, 3, 4];
    let i = n <= 1 ? 0 : n === 2 ? 1 : n <= 6 ? 2 : n <= 10 ? 3 : 4;
    if (tamGrupo < 3) i = Math.min(5, i + 1);
    return escala[i];
  },

  // Espacios de conjuro por nivel de personaje: [nivel 1, nivel 2, ...].
  ESPACIOS: {
    completo: [null, [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
      [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1]],
    medio: [null, [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3]],
    artifice: [null, [2], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3]],
  },

  // Estadísticas de un monstruo según su ND (Guía del DM): para crear jefes propios.
  // [nd, ca, pv, bono de ataque, daño por ronda, cd]
  POR_ND: [[0.5, 13, 60, 3, 7, 13], [1, 13, 78, 3, 12, 13], [2, 13, 93, 3, 17, 13], [3, 13, 108, 4, 23, 13],
    [4, 14, 123, 5, 29, 14], [5, 15, 138, 6, 35, 15], [6, 15, 153, 6, 41, 15], [7, 15, 168, 6, 47, 15],
    [8, 16, 183, 7, 53, 16], [9, 16, 198, 7, 59, 16], [10, 17, 213, 7, 65, 16], [11, 17, 228, 8, 71, 17],
    [12, 17, 243, 8, 77, 17], [13, 18, 258, 8, 83, 18], [14, 18, 273, 8, 89, 18], [15, 18, 288, 8, 95, 18]],
};

// ------------------------------------------------------------------ dados
const Dado = {
  d: caras => 1 + Math.floor(Math.random() * caras),
  // partes: [{n, caras, mas, tipo}] o texto '2d6+3'. crit duplica los dados.
  tirar(partes, crit = false) {
    if (typeof partes === 'string') partes = Dado.leer(partes);
    let total = 0; const trozos = [];
    for (const p of partes) {
      const n = p.n * (crit ? 2 : 1);
      const caras = [];
      for (let i = 0; i < n; i++) caras.push(Dado.d(p.caras));
      const suma = caras.reduce((a, b) => a + b, 0) + (p.mas || 0);
      total += suma;
      trozos.push({ tipo: p.tipo, suma, texto: (n ? `${n}d${p.caras}[${caras.join(',')}]` : '') + (p.mas ? `${p.mas > 0 && n ? '+' : ''}${p.mas}` : '') });
    }
    return { total: Math.max(0, total), trozos };
  },
  leer(txt, tipo) {
    return txt.split(' y ').map(t => {
      const m = t.trim().match(/^(\d+)d(\d+)\s*([+-]\s*\d+)?\s*(.*)$/);
      if (!m) return { n: 0, caras: 0, mas: parseInt(t), tipo: tipo || '' };
      return { n: +m[1], caras: +m[2], mas: m[3] ? parseInt(m[3].replace(/\s/g, '')) : 0, tipo: m[4] || tipo || '' };
    });
  },
  media(partes) { return (typeof partes === 'string' ? Dado.leer(partes) : partes).reduce((s, p) => s + p.n * (p.caras + 1) / 2 + (p.mas || 0), 0); },
  texto(partes) {
    return (typeof partes === 'string' ? Dado.leer(partes) : partes)
      .map(p => (p.n ? `${p.n}d${p.caras}` : '') + (p.mas ? `${p.mas > 0 && p.n ? '+' : ''}${p.mas}` : '') + (p.tipo ? ' ' + p.tipo : '')).join(' + ');
  },
};

// ------------------------------------------------------------- condiciones
// tono: 1 bueno, -1 malo. pierdeTurno: no actúa. ventajaContra: los
// ataques contra él tienen ventaja. desvAtaca: ataca con desventaja.
const CONDICIONES = {
  envenenado:   { nombre: 'Envenenado', icono: '🤢', tono: -1, desvAtaca: true, texto: 'Desventaja en ataques.' },
  borracho:     { nombre: 'Borracho', icono: '🥴', tono: -1, desvAtaca: true, texto: 'Como envenenado: desventaja en ataques.' },
  asustado:     { nombre: 'Asustado', icono: '😱', tono: -1, desvAtaca: true, texto: 'Desventaja en ataques.' },
  hechizado:    { nombre: 'Hechizado', icono: '💘', tono: -1, texto: 'No puede atacar a quien lo hechizó.' },
  derribado:    { nombre: 'Derribado', icono: '🫠', tono: -1, desvAtaca: true, ventajaContra: true, texto: 'Desventaja en ataques; ventaja para atacarlo.' },
  apresado:     { nombre: 'Apresado', icono: '🪢', tono: -1, desvAtaca: true, ventajaContra: true, texto: 'Desventaja en ataques; ventaja para atacarlo.' },
  cegado:       { nombre: 'Cegado', icono: '🙈', tono: -1, desvAtaca: true, ventajaContra: true, texto: 'Desventaja en ataques; ventaja para atacarlo.' },
  incapacitado: { nombre: 'Incapacitado', icono: '😵', tono: -1, pierdeTurno: true, texto: 'Pierde su turno.' },
  aturdido:     { nombre: 'Aturdido', icono: '💫', tono: -1, pierdeTurno: true, ventajaContra: true, fallaFueDes: true, texto: 'Pierde el turno, falla salvaciones de FUE y DES, ventaja para atacarlo.' },
  paralizado:   { nombre: 'Paralizado', icono: '🧊', tono: -1, pierdeTurno: true, ventajaContra: true, fallaFueDes: true, critCerca: true, texto: 'Pierde el turno; los golpes cuerpo a cuerpo que le acierten son críticos.' },
  dormido:      { nombre: 'Dormido', icono: '💤', tono: -1, pierdeTurno: true, ventajaContra: true, fallaFueDes: true, critCerca: true, despiertaConDaño: true, texto: 'Inconsciente hasta recibir daño.' },
  hipnotizado:  { nombre: 'Hipnotizado', icono: '🌀', tono: -1, pierdeTurno: true, despiertaConDaño: true, texto: 'Incapacitado hasta recibir daño.' },
  confundido:   { nombre: 'Confundido', icono: '❓', tono: -1, texto: 'Actúa al azar: puede no hacer nada o atacar a cualquiera.' },
  bailando:     { nombre: 'Bailando', icono: '💃', tono: -1, pierdeTurno: true, ventajaContra: true, texto: 'Pierde el turno bailando; ventaja para atacarlo.' },
  aterrado:     { nombre: 'Aterrado', icono: '🏃', tono: -1, pierdeTurno: true, texto: 'Huye despavorido: pierde su acción.' },
  sugestionado: { nombre: 'En el pogo', icono: '🤘', tono: -1, pierdeTurno: true, despiertaConDaño: true, texto: 'Se fue al pogo: no actúa hasta recibir daño.' },
  desterrado:   { nombre: 'Fuera del escenario', icono: '🚪', tono: -1, pierdeTurno: true, intocable: true, texto: 'Desterrado mientras dure la concentración.' },
  silenciado:   { nombre: 'Silenciado', icono: '🔇', tono: -1, texto: 'No puede usar conjuros ni habilidades verbales.' },
  provocado:    { nombre: 'Provocado', icono: '⚡', tono: -1, texto: 'Desventaja para atacar a cualquiera que no sea quien lo provocó.' },
  perdicion:    { nombre: 'Perdición', icono: '📉', tono: -1, texto: 'Resta 1d4 a sus ataques y salvaciones.' },
  inquieto:     { nombre: 'Inquieto', icono: '😬', tono: -1, texto: 'Resta un dado a su próxima salvación.' },
  burlado:      { nombre: 'Burlado', icono: '🗯', tono: -1, texto: 'Desventaja en su próximo ataque.' },
  marcado:      { nombre: 'Brillando', icono: '✨', tono: -1, texto: 'Fuego feérico: ventaja para atacarlo.', ventajaContra: true },
  estatica:     { nombre: 'Estática', icono: '📻', tono: -1, texto: 'Resta 1d6 a ataques y salvaciones.' },
  acido:        { nombre: 'Ácido', icono: '🧪', tono: -1, texto: 'Recibe daño de ácido al terminar su turno.' },
  veneno:       { nombre: 'Chicha', icono: '🍶', tono: -1, desvAtaca: true, texto: 'Envenenado: desventaja en ataques y daño de veneno cada turno.' },
  nube:         { nombre: 'Nube apestosa', icono: '💨', tono: -1, texto: 'Al empezar su turno salva CON o pierde la acción.' },
  // buenos
  bendecido:    { nombre: 'Bendecido', icono: '🙏', tono: 1, texto: '+1d4 a ataques y salvaciones.' },
  inspirado:    { nombre: 'Inspirado', icono: '🎵', tono: 1, texto: 'Puede sumar el dado de inspiración a una tirada que falle.' },
  audaz:        { nombre: 'Audaz', icono: '💪', tono: 1, texto: '+1d4 a ataques y salvaciones.' },
  furia:        { nombre: 'Furia', icono: '🔥', tono: 1, texto: '+daño cuerpo a cuerpo con FUE; resistencia a daño contundente, cortante y perforante.' },
  temerario:    { nombre: 'Temerario', icono: '😤', tono: 0, texto: 'Ataca con ventaja, pero lo atacan con ventaja.', ventajaContra: true },
  escudo:       { nombre: 'Escudo', icono: '🛡', tono: 1, texto: '+5 a la CA.' },
  esquivando:   { nombre: 'Esquivando', icono: '🌬', tono: 1, texto: 'Los ataques contra él tienen desventaja.' },
  invisible:    { nombre: 'Invisible', icono: '👻', tono: 1, texto: 'Los ataques contra él tienen desventaja; los suyos, ventaja.' },
  lejos:        { nombre: 'Lejos', icono: '🛰', tono: 1, texto: 'Teletransportado: los ataques contra él tienen desventaja.' },
  resiliente:   { nombre: 'Resiliente', icono: '🪨', tono: 1, texto: '+1 a la CA.' },
  levitando:    { nombre: 'Levitando', icono: '🎈', tono: 1, texto: 'Los ataques cuerpo a cuerpo contra él tienen desventaja.' },
  manto:        { nombre: 'Manto del cruzado', icono: '☀', tono: 1, texto: '+1d4 radiante en sus ataques con arma.' },
  desvestido:   { nombre: 'Desvestido', icono: '👕', tono: 0, texto: 'Recibe el doble de daño, pero aplaude al empezar su turno.' },
  dignidad:     { nombre: 'Dignidad', icono: '⚖', tono: 1, texto: 'Nadie más puede usar ataques verbales.' },
  beber:        { nombre: 'Picado', icono: '🍺', tono: 1, texto: 'Su próxima burla hace daño extra.' },
  indignado:    { nombre: 'Indignado', icono: '😤', tono: 1, texto: 'Su próximo conjuro de daño suma INT.' },
  rush:         { nombre: 'Rush', icono: '⚡', tono: 1, texto: 'Su primer ataque del combate tiene ventaja y daño extra.' },
  sinAdicional: { nombre: 'Con Zegarrita', icono: '💑', tono: 0, texto: 'Este turno no tiene acción adicional.' },
};

// Condiciones que impiden reaccionar o concentrarse.
const INCAPACITAN = ['incapacitado', 'aturdido', 'paralizado', 'dormido', 'hipnotizado', 'bailando', 'aterrado', 'sugestionado', 'desterrado'];
