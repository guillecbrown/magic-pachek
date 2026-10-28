// =====================================================================
//  MAGIC PACHEK - partida online entre varios navegadores (PeerJS / WebRTC)
//  El anfitrión (J1) corre el motor completo y es el único que tira dados.
//  Hasta tres invitados se unen con el mismo link y reciben un número de
//  jugador (J2, J3, J4) en orden de llegada; cada uno controla los héroes
//  con su chip. Los invitados solo dibujan: reciben una copia de S cada
//  vez que el anfitrión redibuja, las animaciones (flotantes, golpes,
//  pasos...) y las tiradas y preguntas de reacción de sus héroes; mandan
//  de vuelta sus clics (usar, mover, terminar turno, taberna...).
//  Cada invitado guarda una clave en su navegador: si se le corta y
//  vuelve a entrar, recupera su mismo número de jugador.
//  Se carga después del script de index.html: envuelve UI y Juego.
// =====================================================================

const Online = {
  modo: null,              // null | 'anfitrion' | 'invitado'
  peer: null, sala: null,
  // Anfitrión: jugadores[n] = { clave, con, conectado, ultimo } para n = 2..4.
  jugadores: {},
  MAX_JUGADOR: 4,
  // Invitado: su conexión y su número de jugador.
  con: null, yo: null, conectado: false, ultimo: 0,
  clave: null,
  pendientes: new Map(),   // anfitrión: id -> { res, porDefecto, jugador }
  _id: 0,
  _envio: null,
  abierto: false,          // panel desplegado
  aviso: '',

  // ¿El héroe lo controla un invitado conectado? (si se desconectó, se juega en el anfitrión)
  remoto(h) {
    const j = h && h.tipo === 'heroe' && Online.jugadores[h.jugador];
    return !!(j && j.conectado);
  },
  conectados() { return Object.keys(Online.jugadores).map(Number).filter(n => Online.jugadores[n].conectado); },
  hayConexion() { return Online.modo === 'anfitrion' ? Online.conectados().length > 0 : Online.conectado; },
  // ¿Este navegador controla el turno del héroe activo?
  turnoMio() {
    const h = J.buscar(S.actual);
    if (!h || h.tipo !== 'heroe') return true;
    if (Online.modo === 'invitado') return !Online.conectado || h.jugador === Online.yo;
    return !Online.remoto(h);
  },
  quienJuega(h) {
    if (!h || h.tipo !== 'heroe' || !(h.jugador >= 2)) return 'el anfitrión';
    return Online.modo === 'invitado' || Online.remoto(h) ? 'J' + h.jugador : 'el anfitrión';
  },

  // ------------------------------------------------------------ conexión
  nuevoCodigo(n = 5) {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  },
  idPeer: sala => 'magicpachek-' + sala.toLowerCase(),

  crearSala() {
    if (typeof Peer === 'undefined') { Online.avisar('No cargó PeerJS: revisa la conexión a internet.'); return; }
    Online.cerrar();
    Online.modo = 'anfitrion';
    Online.sala = Online.nuevoCodigo();
    Online.jugadores = {};
    Online.peer = new Peer(Online.idPeer(Online.sala));
    Online.peer.on('open', () => Online.pintar());
    Online.peer.on('connection', con => {
      con.on('data', m => {
        const n = Online.numeroDe(con);
        if (n) { Online.jugadores[n].ultimo = Date.now(); if (m && m.t !== 'ping') Online.recibirAnfitrion(n, m); }
        else if (m && m.t === 'hola') Online.recibirHola(con, m);
      });
      con.on('close', () => { const n = Online.numeroDe(con); if (n) Online.desconectado(n); });
    });
    Online.peer.on('error', e => {
      if (e.type === 'unavailable-id') { Online.crearSala(); return; }
      Online.avisar('Error de conexión: ' + e.type);
    });
    Online.pintar();
  },
  numeroDe(con) { return Number(Object.keys(Online.jugadores).find(n => Online.jugadores[n].con === con)) || null; },

  // Un invitado se presenta con su clave: recupera su número o toma uno libre.
  recibirHola(con, m) {
    const js = Online.jugadores;
    let n = Number(Object.keys(js).find(k => js[k].clave === m.clave)) || null;
    for (let k = 2; !n && k <= Online.MAX_JUGADOR; k++) if (!js[k]) n = k;
    // Sala llena: se reaprovecha el lugar de alguien que se fue.
    if (!n) n = Number(Object.keys(js).find(k => !js[k].conectado)) || null;
    if (!n) { con.send({ t: 'lleno' }); setTimeout(() => con.close(), 500); return; }
    const viejo = js[n] && js[n].con;
    js[n] = { clave: m.clave, con, conectado: true, ultimo: Date.now() };
    if (viejo && viejo !== con) viejo.close();
    con.send({ t: 'bienvenida', jugador: n });
    // En la pantalla de selección, cada jugador nuevo recibe su héroe.
    if (S.fase === 'inicio' && sel.nJug < n) {
      sel.nJug = n;
      sel.ids.forEach((id, i) => sel.jugador[id] = i % sel.nJug + 1);
    }
    Online.avisar(`Se unió J${n}.`);
    UI.render();
    Online.enviarEstado(true);
  },

  unirse(codigo) {
    codigo = (codigo || '').trim().toUpperCase();
    if (!codigo) return;
    if (typeof Peer === 'undefined') { Online.avisar('No cargó PeerJS: revisa la conexión a internet.'); return; }
    Online.cerrar();
    Online.modo = 'invitado';
    Online.sala = codigo;
    Online.yo = null;
    Online.peer = new Peer();
    Online.peer.on('open', () => {
      const con = Online.peer.connect(Online.idPeer(codigo), { reliable: true });
      Online.con = con;
      con.on('open', () => { Online.ultimo = Date.now(); con.send({ t: 'hola', clave: Online.miClave() }); });
      con.on('data', m => { Online.ultimo = Date.now(); if (m && m.t !== 'ping') Online.recibirInvitado(m); });
      con.on('close', () => { if (Online.con === con) Online.desconectado(); });
    });
    Online.peer.on('error', e => {
      Online.avisar(e.type === 'peer-unavailable' ? `No existe la sala ${codigo} (o el anfitrión cerró la pestaña).` : 'Error de conexión: ' + e.type);
      Online.pintar();
    });
    Online.pintar();
    UI.render();
  },
  miClave() {
    if (Online.clave) return Online.clave;
    try { Online.clave = localStorage.getItem('magicPachek.clave'); } catch (e) {}
    if (!Online.clave) {
      Online.clave = Online.nuevoCodigo(12);
      try { localStorage.setItem('magicPachek.clave', Online.clave); } catch (e) {}
    }
    return Online.clave;
  },

  cerrar() {
    if (Online.con) Online.con.close();
    Object.values(Online.jugadores).forEach(j => j.con && j.con.close());
    if (Online.peer) Online.peer.destroy();
    Online.peer = Online.con = null;
    Online.jugadores = {};
    Online.conectado = false;
  },
  salir() {
    const eraInvitado = Online.modo === 'invitado';
    Online.cerrar();
    Online.modo = Online.sala = Online.yo = null;
    Online.soltarPendientes();
    if (eraInvitado) { S.fase = 'inicio'; ui.pregunta = null; }
    history.replaceState(null, '', location.pathname);
    Online.pintar();
    UI.render();
  },
  // n: número del invitado que se fue (anfitrión); sin n, el invitado perdió al anfitrión.
  desconectado(n) {
    if (Online.modo === 'anfitrion') {
      const j = Online.jugadores[n];
      if (!j || !j.conectado) return;
      j.conectado = false; j.con = null;
      // Lo que esperaba su respuesta se resuelve solo; sus héroes pasan a jugarse aquí.
      Online.soltarPendientes(n);
      Online.avisar(`J${n} se desconectó: sus héroes se juegan desde aquí hasta que vuelva.`);
    } else {
      Online.conectado = false; Online.con = null;
      Online.soltarPendientes();
      Online.avisar('Se cortó la conexión con el anfitrión.');
    }
    UI.render();
  },
  soltarPendientes(n) {
    Online.pendientes.forEach((p, id) => { if (!n || p.jugador === n) { p.res(p.porDefecto); Online.pendientes.delete(id); } });
    if (Online.modo !== 'anfitrion' && ui.pregunta && ui.pregunta.remota) ui.pregunta = null;
  },

  // Latido: WebRTC tarda en notar que el otro cerró la pestaña, así que
  // cada lado manda un ping cada 3 s y corta si pasan 10 s sin noticias.
  latido() {
    const ahora = Date.now();
    if (Online.modo === 'anfitrion') {
      Online.conectados().forEach(n => {
        const j = Online.jugadores[n];
        if (ahora - j.ultimo > 10000) { const c = j.con; Online.desconectado(n); c.close(); }
      });
      Online.enviar({ t: 'ping' });
      return;
    }
    if (!Online.conectado || !Online.con) return;
    if (ahora - Online.ultimo > 10000) { const c = Online.con; Online.desconectado(); c.close(); return; }
    Online.enviar({ t: 'ping' });
  },

  // Anfitrión: a todos los invitados conectados. Invitado: al anfitrión.
  enviar(msg) {
    if (Online.modo === 'anfitrion') Online.conectados().forEach(n => Online.enviarA(n, msg));
    else if (Online.conectado && Online.con) Online.con.send(msg);
  },
  enviarA(n, msg) { const j = Online.jugadores[n]; if (j && j.conectado && j.con) j.con.send(msg); },
  // Anfitrión: pide algo al invitado n y espera su respuesta.
  pedir(n, tipo, datos, porDefecto) {
    if (!Online.jugadores[n] || !Online.jugadores[n].conectado) return Promise.resolve(porDefecto);
    const id = ++Online._id;
    return new Promise(res => {
      Online.pendientes.set(id, { res, porDefecto, jugador: n });
      Online.enviarA(n, Object.assign({ t: tipo, id }, datos));
    });
  },

  // ------------------------------------------------- copia del estado
  // Las fichas guardan su def (con funciones) por referencia: viajan como
  // { $heroe }, { $fam } o { $mon } y el invitado las vuelve a enlazar.
  serializar() {
    return JSON.stringify(S, function (k, v) {
      if (k === '_cache' || k === 'mapaImg') return undefined;
      if (k === 'invocador') return v ? { $u: v.uid } : v;
      if (k === 'logs') return v.slice(-80);
      if (k === 'areaVista') return v && { set: [...v.set], resta: v.hasta - Date.now() };
      if (k === 'def' && v && this && this.uid) {
        if (this.tipo === 'heroe') return { $heroe: v.id };
        if (this.tipo === 'familiar') return { $fam: v.id };
        if (this.key && MONSTRUOS[this.key] === v) return { $mon: this.key };
      }
      return v;
    });
  },
  aplicar(txt) {
    const nuevo = JSON.parse(txt);
    const unidades = [].concat(nuevo.grupo || [], nuevo.enemigos || [], nuevo.familiares || [], nuevo.vencidos || []);
    const porUid = new Map(unidades.map(u => [u.uid, u]));
    unidades.forEach(u => {
      const d = u.def;
      if (d && d.$heroe) u.def = HEROES.find(h => h.id === d.$heroe);
      else if (d && d.$fam) u.def = FAMILIARES.find(f => f.id === d.$fam);
      else if (d && d.$mon) u.def = MONSTRUOS[d.$mon];
      if (u.invocador && u.invocador.$u) u.invocador = porUid.get(u.invocador.$u) || null;
    });
    if (nuevo.expedicion) {
      const e = nuevo.expedicion;
      e.victoria = Expediciones.crear(e.tipo, e.largo, 1, 1, e.dificultad).victoria;
    }
    if (nuevo.areaVista) nuevo.areaVista = { set: new Set(nuevo.areaVista.set), hasta: Date.now() + nuevo.areaVista.resta };
    const img = S.mapaImg;
    Object.keys(S).forEach(k => delete S[k]);
    Object.assign(S, nuevo);
    if (img && S.mapa && img.semilla === S.mapa.semilla) S.mapaImg = img;   // no redibujar el mapa en cada copia
  },
  // Anfitrión: manda la copia una sola vez por tanda de redibujos. La
  // selección de héroes viaja aparte para que los invitados vean cuál les toca.
  enviarEstado(ya) {
    if (Online.modo !== 'anfitrion' || !Online.hayConexion()) return;
    const mandar = () => {
      Online._envio = null;
      Online.enviar({ t: 'estado', s: Online.serializar(), sel: { ids: sel.ids, jugador: sel.jugador } });
    };
    if (ya) { clearTimeout(Online._envio); mandar(); return; }
    if (!Online._envio) Online._envio = setTimeout(mandar, 30);
  },

  // ------------------------------------------- mensajes de un invitado
  recibirAnfitrion(n, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'resp') {
      const p = Online.pendientes.get(m.id);
      if (p && p.jugador === n) { Online.pendientes.delete(m.id); p.res(m.v); }
      return;
    }
    if (m.t !== 'cmd') return;
    const a = m.a || [];
    const h = J.buscar(S.actual);
    const suTurno = S.fase === 'combate' && h && h.tipo === 'heroe' && h.jugador === n;
    switch (m.c) {
      case 'usar': if (suTurno && a[0] === h.uid) Juego.usar(...a); break;
      case 'mover': if (suTurno && a[0] === h.uid) Juego.mover(...a); break;
      case 'terminar': if (suTurno) Juego.terminarTurno(); break;
      case 'taberna': if (S.fase === 'botin') Juego.irTaberna(); break;
      case 'continuar': if (S.fase === 'taberna') Juego.continuar(); break;
      case 'dadoGolpe': Juego.gastarDadoGolpe(a[0]); break;
      case 'comprar': if (S.fase === 'taberna') Juego.comprar(a[0], a[1]); break;
      case 'subir': Juego.subirNivel(a[0], a[1]); break;
      case 'pendiente': Juego.elegirPendiente(a[0], a[1], a[2]); guardarProgreso(); break;
    }
  },

  // ----------------------------------------- mensajes del anfitrión
  recibirInvitado(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'bienvenida') {
      Online.yo = m.jugador; Online.conectado = true;
      Online.avisar(`Conectado a la sala ${Online.sala}: eres J${m.jugador}.`);
      UI.render();
      return;
    }
    if (m.t === 'lleno') { Online.salir(); Online.abierto = true; Online.avisar('La sala está llena: ya hay 4 jugadores.'); return; }
    if (m.t === 'estado') { Online.aplicar(m.s); Online.selAnfitrion = m.sel; UI.render(); return; }
    if (m.t === 'pregunta') {
      const h = J.buscar(m.uid);
      ui.pregunta = { h, titulo: m.titulo, texto: m.texto, remota: true, res: v => Online.enviar({ t: 'resp', id: m.id, v }) };
      UI.render();
      return;
    }
    if (m.t === 'dado') {
      const u = J.buscar(m.uid) || { nombre: m.nombre, tipo: m.tipoU };
      const x = Object.assign({}, m.x, { contra: m.x.contra && (J.buscar(m.x.contra) || { nombre: '?' }) });
      const p = m.grande ? UI.tiradaGrande(u, m.d, m.bono, m.txt, x, m.manual) : Online.orig.dado(u, m.d, m.bono, m.txt, x);
      if (m.id) Promise.resolve(p).then(() => Online.enviar({ t: 'resp', id: m.id, v: true }));
      return;
    }
    if (m.t !== 'fx') return;
    const a = m.a, o = Online.orig, u = J.buscar(a[0]);
    switch (m.f) {
      case 'flotante': o.flotante(...a); break;
      case 'resaltar': o.resaltar(a[0]); break;
      case 'anuncio': o.anuncio(u || { nombre: a[1] }, a[2]); break;
      case 'paso': if (u) { u.x = a[1]; u.y = a[2]; o.paso(u); } break;
      case 'golpe': { const t = J.buscar(a[1]); if (u && t) o.golpe(u, t, a[2]); break; }
      case 'conjuro': {
        if (!u) break;
        const hab = Heroes.habilidades(u).find(x => x.id === a[1]);
        if (hab) o.conjuro(u, hab, Online.desObj(a[2]), a[3]);
        break;
      }
      case 'especial': if (u) o.especial(u, a[1], (a[2] || []).map(id => J.buscar(id)).filter(Boolean), a[3] && new Set(a[3])); break;
    }
  },
  // Objetivo de una habilidad: criatura, lista de criaturas o casilla.
  aObj(o) { return Array.isArray(o) ? { lista: o.map(u => u && u.uid) } : o && o.uid ? { uid: o.uid } : o; },
  desObj(o) { return o && o.lista ? o.lista.map(id => J.buscar(id)).filter(Boolean) : o && o.uid ? J.buscar(o.uid) : o; },
  fx(f, ...a) { if (Online.modo === 'anfitrion') Online.enviar({ t: 'fx', f, a }); },

  // ---------------------------------------------------------- panel
  avisar(txt) {
    Online.aviso = txt;
    Online.pintar();
    clearTimeout(Online._aviso);
    Online._aviso = setTimeout(() => { Online.aviso = ''; Online.pintar(); }, 6000);
  },
  enlace() { return `${location.origin}${location.pathname}?sala=${Online.sala}`; },
  chip: n => `<b style="color:${COLORES_J[n]}">J${n}</b>`,
  // Nombres de los héroes que controla el jugador n (en la selección o en la partida).
  heroesDe(n) {
    const lista = S.fase === 'inicio' || !S.grupo.length
      ? (Online.modo === 'invitado' ? Online.selAnfitrion || { ids: [], jugador: {} } : sel)
      : null;
    if (lista) return lista.ids.filter(id => lista.jugador[id] === n).map(id => HEROES.find(h => h.id === id).nombre);
    return S.grupo.filter(h => h.jugador === n).map(h => h.nombre);
  },
  filaJugador(n) {
    const j = Online.jugadores[n];
    const hs = Online.heroesDe(n);
    return `<li>${j && j.conectado ? '🟢' : j ? '🔴' : '⚪'} ${Online.chip(n)} ${j ? (hs.length ? hs.join(', ') : '<i>sin héroe</i>') : '<i>libre</i>'}</li>`;
  },
  pintar() {
    let el = document.getElementById('online');
    if (!el) {
      el = document.createElement('div');
      el.id = 'online'; el.className = 'placa';
      document.body.appendChild(el);
      el.addEventListener('click', Online.clic);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'online-codigo') Online.unirse(e.target.value); });
    }
    const punto = Online.hayConexion() ? '🟢' : Online.modo ? '🟡' : '🌐';
    let cuerpo = '';
    if (Online.abierto) {
      if (!Online.modo) {
        cuerpo = `<p>Tú corres la partida y eres ${Online.chip(1)}. Hasta 3 amigos se unen con el mismo link y juegan los héroes ${Online.chip(2)}, ${Online.chip(3)} y ${Online.chip(4)}.</p>
          <button class="primario" data-on="crear">Crear sala</button>
          <div class="fila"><input id="online-codigo" placeholder="Código" maxlength="5" autocomplete="off"><button data-on="unirse">Unirse</button></div>`;
      } else if (Online.modo === 'anfitrion') {
        const lleno = Object.values(Online.jugadores).filter(j => j.conectado).length >= Online.MAX_JUGADOR - 1;
        cuerpo = `<p>Sala <b class="codigo">${Online.sala}</b> ${Online.peer && Online.peer.open ? '' : '(abriendo...)'}</p>
          <ul class="jugadores"><li>🟢 ${Online.chip(1)} ${Online.heroesDe(1).join(', ') || '<i>sin héroe</i>'} (tú)</li>${[2, 3, 4].map(Online.filaJugador).join('')}</ul>
          ${lleno ? '' : `<p>Link para unirse:</p><div class="fila"><input readonly value="${Online.enlace()}"><button data-on="copiar">Copiar</button></div>`}
          ${S.fase === 'inicio' ? '<p>Toca el chip de cada héroe para dárselo a un jugador.</p>' : ''}
          <button data-on="salir">Cerrar sala</button>`;
      } else {
        const hs = Online.yo ? Online.heroesDe(Online.yo) : [];
        cuerpo = `<p>Sala <b class="codigo">${Online.sala}</b>: ${Online.conectado ? `eres ${Online.chip(Online.yo)}${hs.length ? ' y juegas con ' + hs.join(', ') : ''}.` : 'conectando...'}</p>
          <button data-on="salir">Salir de la sala</button>`;
      }
    }
    el.innerHTML = `<button class="chico pastilla" data-on="abrir" title="Jugar online">${punto} ${Online.modo ? 'Online' : 'Jugar online'}${Online.sala && !Online.abierto ? ' · ' + Online.sala : ''}${Online.yo && !Online.abierto ? ' · J' + Online.yo : ''}</button>
      ${cuerpo ? `<div class="cuerpo">${cuerpo}</div>` : ''}${Online.aviso ? `<div class="aviso">${Online.aviso}</div>` : ''}`;
  },
  clic(ev) {
    const b = ev.target.closest('[data-on]');
    if (!b) return;
    const k = b.dataset.on;
    if (k === 'abrir') Online.abierto = !Online.abierto;
    if (k === 'crear') Online.crearSala();
    if (k === 'unirse') Online.unirse(document.getElementById('online-codigo').value);
    if (k === 'salir') Online.salir();
    if (k === 'copiar') { navigator.clipboard && navigator.clipboard.writeText(Online.enlace()).then(() => Online.avisar('Link copiado.'), () => {}); }
    Online.pintar();
  },
};

// ------------------------------------------------------- envolturas de UI
Online.orig = Object.assign({}, UI);

UI.render = function () {
  if (Online.modo === 'invitado' && S.fase === 'inicio') {
    document.body.classList.remove('combate');
    const hs = Online.yo ? Online.heroesDe(Online.yo) : [];
    document.getElementById('app').innerHTML = `<div class="portada"><h1>Magic Pachek</h1>
      <p>${Online.conectado ? 'Conectado a la sala ' + Online.sala + '. El anfitrión está eligiendo los héroes y la expedición.' : 'Conectando con la sala ' + Online.sala + '...'}</p>
      ${Online.yo ? `<p>Eres ${Online.chip(Online.yo)}. ${hs.length ? 'Te toca jugar con <b>' + hs.join(', ') + '</b>.' : 'Todavía no tienes héroe asignado.'}</p>` : ''}</div>`;
    Online.pintar();
    return;
  }
  // Al empezar el combate el panel se pliega para no tapar la barra de acciones.
  if (S.fase !== Online._fase && Online._fase === 'inicio') Online.abierto = false;
  Online._fase = S.fase;
  Online.orig.render();
  Online.pintar();
  Online.enviarEstado();
};

UI.flotante = (uid, txt, clase) => { Online.fx('flotante', uid, txt, clase); return Online.orig.flotante(uid, txt, clase); };
UI.resaltar = uid => { Online.fx('resaltar', uid); return Online.orig.resaltar(uid); };
UI.anuncio = (u, nombre) => { Online.fx('anuncio', u.uid, u.nombre, nombre); return Online.orig.anuncio(u, nombre); };
UI.paso = u => { Online.fx('paso', u.uid, u.x, u.y); return Online.orig.paso(u); };
UI.golpe = (src, tgt, x) => { Online.fx('golpe', src.uid, tgt.uid, x); return Online.orig.golpe(src, tgt, x); };
UI.conjuro = (h, a, obj, celda) => { Online.fx('conjuro', h.uid, a.id, Online.aObj(obj), celda); return Online.orig.conjuro(h, a, obj, celda); };
UI.especial = (e, x, objs, set) => { Online.fx('especial', e.uid, x, objs.map(o => o && o.uid), set ? [...set] : null); return Online.orig.especial(e, x, objs, set); };

// Tiradas: en el turno de un héroe humano se ven en grande, y las lanza a
// mano quien controla ese héroe. El anfitrión espera a que el invitado
// dueño del turno lance las suyas; los demás solo las ven rodar.
UI.dado = function (u, d, bono, txt, x = {}) {
  if (Online.modo !== 'anfitrion' || !Online.hayConexion()) return Online.orig.dado(u, d, bono, txt, x);
  const t = J.buscar(S.actual);
  const grande = S.fase === 'combate' && t && t.tipo === 'heroe' && !Bot.controla(t);
  const manual = grande && (x.vs !== 'CA' || u.uid === S.actual);
  const dueño = grande && Online.remoto(t) ? t.jugador : null;
  const msg = { t: 'dado', uid: u.uid, nombre: u.nombre, tipoU: u.tipo, d, bono, txt, x: Object.assign({}, x, { contra: x.contra && x.contra.uid }), grande, manual: false };
  Online.conectados().filter(n => n !== dueño).forEach(n => Online.enviarA(n, msg));
  if (!dueño) return Online.orig.dado(u, d, bono, txt, x);
  const local = UI.tiradaGrande(u, d, bono, txt, x, false);
  const remoto = manual ? Online.pedir(dueño, 'dado', Object.assign({}, msg, { manual: true }), true) : (Online.enviarA(dueño, msg), null);
  return Promise.all([local, remoto]);
};

// Reacciones de los héroes de un invitado: las contesta él.
UI.preguntar = function (h, titulo, texto, tipo, ctx) {
  if (Online.modo === 'anfitrion' && Online.remoto(h) && !ui.auto) {
    return Online.pedir(h.jugador, 'pregunta', { uid: h.uid, titulo, texto }, Bot.reaccion(h, tipo, ctx));
  }
  return Online.orig.preguntar(h, titulo, texto, tipo, ctx);
};

// ------------------------------------------- los invitados mandan sus clics
Online.juegoOrig = Object.assign({}, Juego);
[['usar', 'usar'], ['mover', 'mover'], ['terminarTurno', 'terminar'], ['irTaberna', 'taberna'], ['continuar', 'continuar'],
 ['gastarDadoGolpe', 'dadoGolpe'], ['comprar', 'comprar'], ['subirNivel', 'subir'], ['elegirPendiente', 'pendiente']].forEach(([f, c]) => {
  Juego[f] = function (...a) {
    if (Online.modo === 'invitado') { Online.enviar({ t: 'cmd', c, a }); return; }
    return Online.juegoOrig[f].apply(Juego, a);
  };
});

// Cada uno solo actúa en el turno de sus héroes. Se intercepta antes que el
// manejador de index.html (fase de captura).
document.addEventListener('click', ev => {
  if (!Online.modo) return;
  const el = ev.target.closest && ev.target.closest('#app [data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (Online.modo === 'invitado' && ['otra', 'reiniciar', 'comenzar', 'auto'].includes(act)) { ev.stopPropagation(); return; }
  const deTurno = ['hab', 'terminar', 'caminar', 'mapa'].includes(act) || (act === 'unidad' && ui.pend);
  if (deTurno && S.fase === 'combate' && !Online.turnoMio()) {
    ev.stopPropagation();
    const h = J.buscar(S.actual);
    Online.avisar(`Es el turno de ${h ? h.nombre : 'otro héroe'}: lo juega ${Online.quienJuega(h)}.`);
  }
}, true);

// ------------------------------------------------------------ arranque
(function () {
  const st = document.createElement('style');
  st.textContent = `
#online{position:fixed;left:12px;bottom:12px;z-index:45;padding:6px;max-width:min(320px,calc(100vw - 24px));font-size:14px}
#online .pastilla{background:transparent;border:none;padding:2px 6px}
#online .cuerpo{padding:4px 6px 6px;display:grid;gap:8px}
#online .cuerpo p{margin:0;color:var(--tenue)}
#online .codigo{color:var(--oro);font-family:'Cinzel';letter-spacing:.12em}
#online .jugadores{list-style:none;margin:0;padding:0;display:grid;gap:3px}
#online .jugadores i{color:var(--tenue)}
#online .fila{display:flex;gap:6px}
#online input{flex:1;min-width:0;background:#0008;color:var(--texto);border:1px solid var(--borde);border-radius:6px;padding:6px 8px;font:inherit}
#online .aviso{padding:6px;color:var(--texto);border-top:1px solid #ffffff14;margin-top:4px}`;
  document.head.appendChild(st);
  const sala = new URLSearchParams(location.search).get('sala');
  if (sala) { Online.abierto = true; Online.unirse(sala); }
  Online._fase = S.fase;
  setInterval(Online.latido, 3000);
  Online.pintar();
})();
