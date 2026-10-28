// =====================================================================
//  MAGIC PACHEK - bot que juega por un héroe
//  Lo usa el simulador para todos los héroes, y la partida normal para
//  los héroes marcados con 🤖. En cada paso elige la habilidad con más
//  puntos según la estimación ia(J, h) de heroes.js; si el objetivo no
//  está a su alcance, primero camina hasta donde lo tenga. Las áreas las
//  apunta donde atrapan más enemigos y menos aliados. También decide las
//  reacciones (Escudo, Defensa Tanque, castigo divino...).
// =====================================================================

const Bot = {
  todos: false,                       // el simulador lo pone en true
  controla(h) { return Bot.todos || h.jugador === 'ia'; },
  cuerpoACuerpo(h) { return Heroes.armas(h).some(a => a.alcance) && !h.def.lanzador || ['benji', 'fer'].includes(h.def.id) || (h.def.id === 'coco' && h.nivel >= 3); },

  opciones(h) {
    const ops = [];
    for (const a of Heroes.habilidades(h)) {
      if (!a.ia || Juego.bloqueo(h, a)) continue;
      let [p, obj] = a.ia(J, h);
      if (!(p > 0)) continue;
      const op = { a, p, obj };
      if (a.objetivo === 'area') {
        const mp = Heroes.mejorPunto(h, a);
        if (!mp || mp.v <= 0 || mp.aliados > 0 && mp.v < 40) continue;
        op.celda = mp.celda; op.p = Math.min(p, mp.v) * (mp.n >= 2 ? 1 : 0.6);
        op.obj = null;
      } else if (Heroes.necesitaObjetivo(a)) {
        if (!Heroes.objetivoValido(J, h, a, obj)) {
          const pool = a.objetivo === 'enemigo' ? J.enemigosVivos() : S.grupo.concat(S.familiares);
          const enRango = pool.filter(t => Heroes.objetivoValido(J, h, a, t));
          if (enRango.length) obj = a.objetivo === 'enemigo' ? enRango.sort((x, y) => x.pv - y.pv)[0] : enRango[0];
          else {
            // Caminar hasta tenerlo al alcance.
            const deseado = obj && (a.objetivo === 'enemigo' ? obj.tipo === 'enemigo' : obj.tipo !== 'enemigo') ? obj
              : a.objetivo === 'enemigo' ? J.enemigosVivos().filter(T.enTablero).sort((x, y) => Mapas.dist(h, x) - Mapas.dist(h, y))[0] : null;
            if (!deseado || !h.mov) continue;
            const v = T.casillaPara(h, deseado, Heroes.alcance(h, a), { lejos: !Bot.cuerpoACuerpo(h) });
            if (!v) continue;
            op.moverA = v; obj = deseado; op.p -= 0.5;
          }
        }
        op.obj = obj;
      } else if (a.objetivo === 'enemigos' || a.objetivo === 'aliados') {
        if (!Heroes.grupoObjetivo(h, a).length) continue;
      } else if (a.objetivo === 'celda') continue;
      ops.push(op);
    }
    return ops.sort((x, y) => y.p - x.p);
  },

  async turno(h) {
    for (let paso = 0; paso < 12; paso++) {
      if (S.fase !== 'combate' || S.actual !== h.uid || !consciente(h) || J.pierdeTurno(h)) return;
      const ops = Bot.opciones(h);
      if (!ops.length) break;
      const o = ops[0];
      if (o.moverA) {
        await Juego.mover(h.uid, o.moverA.x, o.moverA.y);
        if (S.fase !== 'combate' || !consciente(h)) return;
        if (!Heroes.objetivoValido(J, h, o.a, o.obj)) continue;
      }
      await Juego.usar(h.uid, o.a.id, o.obj && o.obj.uid, o.celda);
      UI.render();
      await espera(UI.velocidad() / 2);
    }
    await Bot.reposicionar(h);
  },

  // Con el movimiento que sobra: los de cuerpo a cuerpo se pegan al enemigo;
  // los demás se alejan si tienen a alguien encima.
  async reposicionar(h) {
    if (S.fase !== 'combate' || S.actual !== h.uid || !consciente(h) || !h.mov) return;
    const enemigos = J.enemigosVivos().filter(T.enTablero);
    if (!enemigos.length) return;
    const cerca = enemigos.sort((x, y) => Mapas.dist(h, x) - Mapas.dist(h, y))[0];
    if (Bot.cuerpoACuerpo(h)) {
      if (Mapas.dist(h, cerca) <= 1) return;
      // Si no llega caminando y le queda la acción, corre.
      if (!T.casillaPara(h, cerca, 5) && h.accion) await Juego.usar(h.uid, 'correr');
      const v = T.casillaPara(h, cerca, 5) || (T.acercarse(h, cerca, h.mov) || {}).v;
      if (v) await Juego.mover(h.uid, v.x, v.y);
      return;
    }
    if (!T.amenazado(h)) return;
    const alc = T.alcanzables(h);
    let mejor = null, md = -1;
    for (const v of alc.values()) {
      if (v.paso) continue;
      const d = Math.min(...enemigos.map(e => Mapas.dist({ x: v.x, y: v.y, tam: 1 }, e)));
      if (d > md) { md = d; mejor = v; }
    }
    if (mejor && md > 1) await Juego.mover(h.uid, mejor.x, mejor.y);
  },

  // Reacciones y decisiones a mitad de turno.
  reaccion(h, tipo, ctx) {
    if (tipo === 'castigo') return ctx.res.crit || ctx.t.jefe || ctx.t.pv > 12 || ctx.n === 1;
    if (tipo === 'contrahechizo') return !!(ctx.x.area || ctx.x.forma || Dado.media(ctx.x.daño || []) > 15 || ctx.x.condicion);
    if (tipo === 'escudo') return h.pv < h.pvMax * 0.7 || J.espacioLibre(h, 2);
    return true;
  },
};
