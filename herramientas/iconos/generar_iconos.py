# Genera iconos.js con los íconos de game-icons.net (CC BY 3.0) que usa la barra de habilidades.
# Uso:
#   git clone --depth 1 https://github.com/game-icons/icons.git <carpeta>
#   python generar_iconos.py <carpeta>
# Para una habilidad nueva: agregar 'id_habilidad': 'autor/nombre' en ICONOS y volver a correr.
# Los nombres se buscan en https://game-icons.net (la URL dice autor/nombre).
import json, re, sys
from pathlib import Path

ICONOS = {
    # Estándar
    'caminar': 'lorc/boot-prints', 'correr': 'lorc/sprint', 'destrabarse': 'delapouite/jump-across', 'esquivar': 'lorc/dodging',
    'pocion': 'delapouite/health-potion', 'darPocion': 'lorc/potion-ball',
    'atacar_estoque': 'lorc/stiletto', 'atacar_espada': 'lorc/broadsword', 'atacar_baston': 'lorc/wizard-staff',
    'atacar_ballesta': 'carl-olsen/crossbow', 'atacar_arco': 'delapouite/bow-arrow', 'atacar_jabalina': 'lorc/thrown-spear',
    'atacar_apm': 'lorc/fist', 'atacar_guanteletes': 'delapouite/gauntlet',
    # Pepe
    'verbal': 'lorc/shouting', 'beber': 'lorc/beer-stein', 'caporales': 'delapouite/carnival-mask', 'disonancia': 'skoll/sound-waves',
    'huayno': 'delapouite/musical-notes', 'inquietantes': 'lorc/terror', 'paralizante': 'delapouite/frozen-body',
    'hipnotico': 'lorc/divided-spiral', 'masa': 'lorc/music-spell', 'brindis': 'delapouite/glass-celebration',
    'otto': 'delapouite/avoidance', 'misogino': 'delapouite/angry-eyes',
    # Benji
    'furia': 'delapouite/enrage', 'temerario': 'delapouite/sword-brandish', 'frenesi': 'lorc/whirlwind', 'dormir': 'lorc/sleepy',
    'zegarrita': 'delapouite/invisible', 'ronquido': 'delapouite/night-sleep', 'silbido': 'lorc/fire-breath',
    # Fer
    'seduccion': 'lorc/lips', 'imposicion': 'delapouite/hand-of-god', 'bendecir': 'lorc/holy-symbol', 'curar': 'delapouite/healing',
    'reprension': 'delapouite/devil-mask', 'auxilio': 'delapouite/first-aid-kit', 'revivificar': 'lorc/angel-wings',
    'manto': 'delapouite/cape', 'diosa': 'lorc/angel-outfit',
    # Guille
    'calculadora': 'delapouite/calculator', 'refutacionRapida': 'lorc/pointing', 'calculo': 'delapouite/pie-chart',
    'clase': 'delapouite/teacher', 'escudo': 'lorc/magic-shield', 'mirada': 'delapouite/eye-target', 'auditoria': 'delapouite/checklist',
    'contrahechizo': 'lorc/interdiction', 'excel': 'lorc/explosion-rays', 'amnesia': 'delapouite/brain-leak',
    'auditoriaTotal': 'lorc/papers', 'liquidacion': 'delapouite/money-stack', 'dignidad': 'lorc/crown',
    # Coco
    'rush': 'lorc/lightning-helix', 'app': 'delapouite/smartphone', 'brillo': 'delapouite/striped-sun', 'firewall': 'delapouite/brick-wall',
    'distante': 'lorc/radar-sweep', 'pantallazo': 'delapouite/laptop', 'almacen': 'delapouite/save', 'sobrecarga': 'sbed/battery-pack',
    'desvestimiento': 'delapouite/underwear',
    # Tony
    'pocima': 'lorc/standing-potion', 'pocimaAlmacen': 'lorc/bottled-bolt', 'acido': 'sbed/acid', 'tanque': 'lorc/turtle-shell',
    'preparacion': 'delapouite/cardboard-box', 'chicha': 'delapouite/jug', 'nauseabundo': 'lorc/vomiting', 'flechaAcida': 'lorc/acid-blob',
    'humo': 'darkzaitzev/smoke-bomb', 'elixir': 'lorc/round-bottom-flask', 'brebaje': 'lorc/cauldron',
    # Malego
    'timpanos': 'lorc/sonic-shout', 'riff': 'lorc/guitar', 'bateria': 'caro-asercion/drum-kit', 'balada': 'lorc/lyre',
    'trenzas': 'delapouite/hair-strands', 'invocatio': 'delapouite/spell-book', 'silencio': 'lorc/silence', 'aterrador': 'lorc/screaming',
    'escenario': 'lorc/teleport', 'feedback': 'delapouite/speaker', 'pirotecnia': 'lorc/firework-rocket',
    'publico': 'delapouite/laurels-trophy', 'pogo': 'lorc/punch-blast',
    # Por defecto, si una habilidad no tiene ícono propio
    '_gesta': 'delapouite/star-formation', '_ataque': 'lorc/crossed-swords', '_conjuro': 'lorc/magic-swirl', '_otra': 'delapouite/sparkles',
}

def trazos(svg):
    # Cada SVG trae un cuadrado negro de fondo y el dibujo en blanco: se queda solo con el dibujo.
    ds = re.findall(r'<path([^>]*)\sd="([^"]+)"', svg)
    return ' '.join(d for attrs, d in ds if d != 'M0 0h512v512H0z')

def main():
    raiz = Path(sys.argv[1])
    salida, faltan = {}, []
    for hab, nombre in ICONOS.items():
        f = raiz / (nombre + '.svg')
        if not f.exists():
            faltan.append(nombre)
            continue
        salida[hab] = trazos(f.read_text(encoding='utf-8'))
    if faltan:
        sys.exit('No existen: ' + ', '.join(faltan))
    destino = Path(__file__).resolve().parents[2] / 'iconos.js'
    destino.write_text(
        '// Generado por herramientas/iconos/generar_iconos.py. No editar a mano.\n'
        '// Íconos de game-icons.net (Lorc, Delapouite, Carl Olsen, Skoll, Sbed, DarkZaitzev, Caro Asercion), licencia CC BY 3.0.\n'
        'const ICONOS_SVG = ' + json.dumps(salida, ensure_ascii=False, indent=0) + ';\n', encoding='utf-8')
    print(f'{len(salida)} íconos -> {destino} ({destino.stat().st_size // 1024} KB)')

main()
