// =====================================================================
//  MAGIC PACHEK - partida online entre dos navegadores (PeerJS / WebRTC)
//  El anfitrión corre el motor completo y es el único que tira dados.
//  El invitado solo dibuja: recibe una copia de S cada vez que el
//  anfitrión redibuja, las animaciones (flotantes, golpes, pasos...) y
//  las preguntas de reacción de sus héroes; manda de vuelta sus clics
//  (usar, mover, terminar turno, taberna...). El invitado controla los
//  héroes del J2; el resto (J1, J3, J4 e IA) se juega en el anfitrión.
//  Se carga después del script de index.html: envuelve UI y Juego.
// =====================================================================

const Online = {
  modo: null,              // null | 'anfitrion' | 'invitado'
  peer: null, con: null, sala: null,
  conectado: false,
  JUGADOR_INVITADO: 2,
  pendientes: new Map(),   // anfitrión: id -> { res, porDefecto }
  _id: 0,
  _envio: null,
  abierto: false,          // panel desplegado
  aviso: '',

  esDelInvitado(h) { return !!h && h.tipo === 'heroe' && h.jugador === Online.JUGADOR_INVITADO; },
  // ¿Este navegador controla el turno del héroe activo?
  turnoMio() {
    const h = J.buscar(S.actual);
    if (!Online.conectado || !h || h.tipo !== 'heroe') return true;
    return Online.modo === 'invitado' ? Online.esDelInvitado(h) : !Online.esDelInvitado(h);
  },

  // ------------------------------------------------------------ conexión
  nuevoCodigo() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  },
  idPeer: sala => 'magicpachek-' + sala.toLowerCase(),

  crearSala() {
    if (typeof Peer === 'undefined') { Online.avisar('No cargó PeerJS: revisa la conexión a internet.'); return; }
    Online.cerrar();
    Online.modo = 'anfitrion';
    Online.sala = Online.nuevoCodigo();
    Online.peer = new Peer(Online.idPeer(Online.sala));
    Online.peer.on('open', () => Online.pintar());
    Online.peer.on('connection', con => {
      // Si el invitado vuelve a entrar, la conexión nueva reemplaza a la vieja.
      if (Online.con) Online.con.close();
      Online.con = con;
      con.on('open', () => {
        Online.conectado = true; Online.ultimo = Date.now();
        Online.avisar('Tu amigo se unió a la sala.');
        Online.enviarEstado(true);
      });
      con.on('data', m => Online.llega(m, Online.recibirAnfitrion));
      con.on('close', () => { if (Online.con === con) Online.desconectado(); });
    });
    Online.peer.on('error', e => {
      if (e.type === 'unavailable-id') { Online.crearSala(); return; }
      Online.avisar('Error de conexión: ' + e.type);
    });
    Online.pintar();
  },

  unirse(codigo) {
    codigo = (codigo || '').trim().toUpperCase();
    if (!codigo) return;
    if (typeof Peer === 'undefined') { Online.avisar('No cargó PeerJS: revisa la conexión a internet.'); return; }
    Online.cerrar();
    Online.modo = 'invitado';
    Online.sala = codigo;
    Online.peer = new Peer();
    Online.peer.on('open', () => {
      const con = Online.peer.connect(Online.idPeer(codigo), { reliable: true });
      Online.con = con;
      con.on('open', () => { Online.conectado = true; Online.ultimo = Date.now(); Online.avisar('Conectado a la sala ' + codigo + '.'); UI.render(); });
      con.on('data', m => Online.llega(m, Online.recibirInvitado));
      con.on('close', () => { if (Online.con === con) Online.desconectado(); });
    });
    Online.peer.on('error', e => {
      Online.avisar(e.type === 'peer-unavailable' ? `No existe la sala ${codigo} (o el anfitrión cerró la pestaña).` : 'Error de conexión: ' + e.type);
      Online.pintar();
    });
    Online.pintar();
    UI.render();
  },

  cerrar() {
    if (Online.con) Online.con.close();
    if (Online.peer) Online.peer.destroy();
    Online.peer = Online.con = null;
    Online.conectado = false;
  },
  salir() {
    const eraInvitado = Online.modo === 'invitado';
    Online.cerrar();
    Online.modo = Online.sala = null;
    Online.soltarPendientes();
    if (eraInvitado) { S.fase = 'inicio'; ui.pregunta = null; }
    history.replaceState(null, '', location.pathname);
    Online.pintar();
    UI.render();
  },
  desconectado() {
    Online.conectado = false;
    Online.con = null;
    // Lo que esperaba respuesta del invitado se resuelve solo; sus héroes pasan a jugarse aquí.
    Online.soltarPendientes();
    Online.avisar(Online.modo === 'anfitrion' ? 'Tu amigo se desconectó: sus héroes se juegan desde aquí hasta que vuelva.' : 'Se cortó la conexión con el anfitrión.');
    UI.render();
  },
  soltarPendientes() {
    Online.pendientes.forEach(p => p.res(p.porDefecto));
    Online.pendientes.clear();
    if (Online.modo !== 'anfitrion' && ui.pregunta && ui.pregunta.remota) ui.pregunta = null;
  },

  // Latido: WebRTC tarda en notar que el otro cerró la pestaña, así que
  // cada lado manda un ping cada 3 s y corta si pasan 10 s sin noticias.
  ultimo: 0,
  llega(m, recibir) { Online.ultimo = Date.now(); if (m && m.t !== 'ping') recibir(m); },
  latido() {
    if (!Online.conectado || !Online.con) return;
    if (Date.now() - Online.ultimo > 10000) { const c = Online.con; Online.desconectado(); c.close(); return; }
    Online.enviar({ t: 'ping' });
  },

  enviar(msg) { if (Online.conectado && Online.con) Online.con.send(msg); },
  // Anfitrión: pide algo al invitado y espera su respuesta.
  pedir(tipo, datos, porDefecto) {
    if (!Online.conectado) return Promise.resolve(porDefecto);
    const id = ++Online._id;
    return new Promise(res => {
      Online.pendientes.set(id, { res, porDefecto });
      Online.enviar(Object.assign({ t: tipo, id }, datos));
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
  // Anfitrión: manda la copia una sola vez por tanda de redibujos.
  enviarEstado(ya) {
    if (Online.modo !== 'anfitrion' || !Online.conectado) return;
    if (ya) { clearTimeout(Online._envio); Online._envio = null; Online.enviar({ t: 'estado', s: Online.serializar() }); return; }
    if (Online._envio) return;
    Online._envio = setTimeout(() => { Online._envio = null; Online.enviar({ t: 'estado', s: Online.serializar() }); }, 30);
  },

  // ------------------------------------------- mensajes del invitado
  recibirAnfitrion(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'resp') {
      const p = Online.pendientes.get(m.id);
      if (p) { Online.pendientes.delete(m.id); p.res(m.v); }
      return;
    }
    if (m.t !== 'cmd') return;
    const a = m.a || [];
    const h = J.buscar(S.actual);
    const suTurno = S.fase === 'combate' && Online.esDelInvitado(h);
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
    if (m.t === 'estado') { Online.aplicar(m.s); UI.render(); return; }
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
  pintar() {
    let el = document.getElementById('online');
    if (!el) {
      el = document.createElement('div');
      el.id = 'online'; el.className = 'placa';
      document.body.appendChild(el);
      el.addEventListener('click', Online.clic);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'online-codigo') Online.unirse(e.target.value); });
    }
    const punto = Online.conectado ? '🟢' : Online.modo ? '🟡' : '🌐';
    let cuerpo = '';
    if (Online.abierto) {
      if (!Online.modo) {
        cuerpo = `<p>Tú corres la partida y tu amigo juega los héroes marcados <b style="color:var(--j2)">J2</b>.</p>
          <button class="primario" data-on="crear">Crear sala</button>
          <div class="fila"><input id="online-codigo" placeholder="Código" maxlength="5" autocomplete="off"><button data-on="unirse">Unirse</button></div>`;
      } else if (Online.modo === 'anfitrion') {
        cuerpo = `<p>Sala <b class="codigo">${Online.sala}</b> ${Online.peer && Online.peer.open ? '' : '(abriendo...)'}</p>
          <p>${Online.conectado ? 'Tu amigo está conectado y juega los héroes <b style="color:var(--j2)">J2</b>.' : 'Mándale este link a tu amigo:'}</p>
          ${Online.conectado ? '' : `<div class="fila"><input readonly value="${Online.enlace()}"><button data-on="copiar">Copiar</button></div>`}
          <button data-on="salir">Cerrar sala</button>`;
      } else {
        cuerpo = `<p>Sala <b class="codigo">${Online.sala}</b>: ${Online.conectado ? 'conectado. Juegas los héroes <b style="color:var(--j2)">J2</b>.' : 'conectando...'}</p>
          <button data-on="salir">Salir de la sala</button>`;
      }
    }
    el.innerHTML = `<button class="chico pastilla" data-on="abrir" title="Jugar online">${punto} ${Online.modo ? 'Online' : 'Jugar online'}${Online.sala && !Online.abierto ? ' · ' + Online.sala : ''}</button>
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
    document.getElementById('app').innerHTML = `<div class="portada"><h1>Magic Pachek</h1>
      <p>${Online.conectado ? 'Conectado a la sala ' + Online.sala + '. El anfitrión está eligiendo los héroes y la expedición.' : 'Conectando con la sala ' + Online.sala + '...'}</p>
      <p>Tú juegas los héroes marcados <b style="color:var(--j2)">J2</b>.</p></div>`;
    Online.pintar();
    return;
  }
  // Al empezar el combate el panel se pliega para no tapar la barra de acciones.
  if (S.fase !== Online._fase && Online._fase === 'inicio') { Online.abierto = false; Online.pintar(); }
  Online._fase = S.fase;
  Online.orig.render();
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
// lance las suyas.
UI.dado = function (u, d, bono, txt, x = {}) {
  if (Online.modo !== 'anfitrion' || !Online.conectado) return Online.orig.dado(u, d, bono, txt, x);
  const t = J.buscar(S.actual);
  const grande = S.fase === 'combate' && t && t.tipo === 'heroe' && !Bot.controla(t);
  const manual = grande && (x.vs !== 'CA' || u.uid === S.actual);
  const suyo = grande && Online.esDelInvitado(t);
  const msg = { uid: u.uid, nombre: u.nombre, tipoU: u.tipo, d, bono, txt, x: Object.assign({}, x, { contra: x.contra && x.contra.uid }), grande, manual: suyo && manual };
  if (suyo) {
    const local = UI.tiradaGrande(u, d, bono, txt, x, false);
    const remoto = manual ? Online.pedir('dado', msg, true) : (Online.enviar(Object.assign({ t: 'dado' }, msg)), null);
    return Promise.all([local, remoto]);
  }
  Online.enviar(Object.assign({ t: 'dado' }, msg));
  return Online.orig.dado(u, d, bono, txt, x);
};

// Reacciones de los héroes del invitado: las contesta él.
UI.preguntar = function (h, titulo, texto, tipo, ctx) {
  if (Online.modo === 'anfitrion' && Online.conectado && Online.esDelInvitado(h) && !ui.auto) {
    return Online.pedir('pregunta', { uid: h.uid, titulo, texto }, Bot.reaccion(h, tipo, ctx));
  }
  return Online.orig.preguntar(h, titulo, texto, tipo, ctx);
};

// ------------------------------------------- el invitado manda sus clics
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
    Online.avisar(`Es el turno de ${h ? h.nombre : 'otro héroe'}: lo juega ${Online.modo === 'invitado' ? 'el anfitrión' : 'tu amigo'}.`);
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
