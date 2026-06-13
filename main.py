from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from datetime import datetime, timedelta
import sqlite3
import hashlib
import uvicorn
import os

# Configuración
# Ruta de la base de datos. En la nube apúntala a un disco persistente con la
# variable de entorno DB_PATH (ej. /data/prode.db) para no perder los datos.
DB_PATH = os.environ.get("DB_PATH", "prode.db")
# Clave de administrador para cargar resultados oficiales a mano.
# Cámbiala con la variable de entorno ADMIN_KEY antes de desplegar.
ADMIN_KEY = os.environ.get("ADMIN_KEY", "mundial2026")
# Minutos antes del inicio del partido en que se cierran las apuestas.
LOCK_MINUTES = 1


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode("utf-8")).hexdigest()


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            pin TEXT,
            points INTEGER DEFAULT 0,
            exact_hits INTEGER DEFAULT 0,
            partial_hits INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            home_team TEXT,
            away_team TEXT,
            home_logo TEXT,
            away_logo TEXT,
            date TEXT,
            group_name TEXT,
            stage TEXT,
            stadium TEXT,
            city TEXT,
            matchday TEXT,
            home_goals INTEGER,
            away_goals INTEGER,
            status TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            player_id INTEGER,
            match_id TEXT,
            home_score INTEGER,
            away_score INTEGER,
            PRIMARY KEY (player_id, match_id),
            FOREIGN KEY (player_id) REFERENCES players (id),
            FOREIGN KEY (match_id) REFERENCES matches (id)
        )
    ''')
    # Mini-migraciones: agregar columnas si la BD viene de una versión anterior.
    for table, column, coltype in (
        ("players", "pin", "TEXT"),
        ("matches", "stage", "TEXT"),
        ("matches", "stadium", "TEXT"),
        ("matches", "city", "TEXT"),
        ("matches", "matchday", "TEXT"),
    ):
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
        except sqlite3.OperationalError:
            pass  # la columna ya existe
    conn.commit()
    conn.close()


app = FastAPI(title="Prode Mundial 2026 API")


# ---------- Modelos ----------
class PlayerCreate(BaseModel):
    name: str
    pin: str


class LoginRequest(BaseModel):
    name: str
    pin: str


class PredictionUpdate(BaseModel):
    player_id: int
    pin: str
    match_id: str
    home_score: int
    away_score: int


class ResultUpdate(BaseModel):
    home_goals: int
    away_goals: int
    admin_key: str


# ---------- Lógica de puntaje ----------
def outcome(h, a):
    """Devuelve el signo del resultado: 1 local, 0 empate, -1 visitante."""
    if h > a:
        return 1
    if h < a:
        return -1
    return 0


def recalculate_scores():
    """Recalcula puntos de todos los jugadores desde cero (idempotente).
    3 pts marcador exacto, 1 pt acierto de resultado, 0 si falla."""
    conn = get_conn()
    cursor = conn.cursor()

    # Resultados oficiales disponibles (goles cargados).
    finished = {
        m["id"]: (m["home_goals"], m["away_goals"])
        for m in cursor.execute(
            "SELECT id, home_goals, away_goals FROM matches "
            "WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL"
        ).fetchall()
    }

    # Acumuladores por jugador.
    stats = {
        p["id"]: {"points": 0, "exact": 0, "partial": 0}
        for p in cursor.execute("SELECT id FROM players").fetchall()
    }

    for pred in cursor.execute(
        "SELECT player_id, match_id, home_score, away_score FROM predictions"
    ).fetchall():
        real = finished.get(pred["match_id"])
        if real is None or pred["player_id"] not in stats:
            continue
        rh, ra = real
        ph, pa = pred["home_score"], pred["away_score"]
        if ph is None or pa is None:
            continue
        s = stats[pred["player_id"]]
        if ph == rh and pa == ra:
            s["points"] += 3
            s["exact"] += 1
        elif outcome(ph, pa) == outcome(rh, ra):
            s["points"] += 1
            s["partial"] += 1

    for pid, s in stats.items():
        cursor.execute(
            "UPDATE players SET points = ?, exact_hits = ?, partial_hits = ? WHERE id = ?",
            (s["points"], s["exact"], s["partial"], pid),
        )
    conn.commit()
    conn.close()


def is_locked(match_date: str) -> bool:
    """True si el partido ya cerró (inicio menos LOCK_MINUTES)."""
    if not match_date:
        return False
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            start = datetime.strptime(match_date[:19], fmt)
            return datetime.now() >= start - timedelta(minutes=LOCK_MINUTES)
        except ValueError:
            continue
    return False


# ---------- Endpoints: jugadores / auth ----------
@app.post("/api/players")
def create_player(player: PlayerCreate):
    name = player.name.strip()
    pin = player.pin.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    if not (pin.isdigit() and len(pin) == 4):
        raise HTTPException(status_code=400, detail="El PIN debe tener 4 dígitos")
    conn = get_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO players (name, pin) VALUES (?, ?)", (name, hash_pin(pin))
        )
        conn.commit()
        return {"id": cursor.lastrowid, "name": name}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Ese nombre ya está registrado")
    finally:
        conn.close()


@app.post("/api/login")
def login(req: LoginRequest):
    conn = get_conn()
    cursor = conn.cursor()
    p = cursor.execute(
        "SELECT * FROM players WHERE name = ?", (req.name.strip(),)
    ).fetchone()
    conn.close()
    if not p or p["pin"] != hash_pin(req.pin.strip()):
        raise HTTPException(status_code=401, detail="Nombre o PIN incorrecto")
    return {"id": p["id"], "name": p["name"], "points": p["points"]}


@app.get("/api/players")
def get_players():
    conn = get_conn()
    players = conn.execute(
        "SELECT p.id, p.name, p.points, p.exact_hits, p.partial_hits, "
        "  (SELECT COUNT(*) FROM predictions pr WHERE pr.player_id = p.id) AS pred_count "
        "FROM players p "
        "ORDER BY p.points DESC, p.exact_hits DESC, p.name ASC"
    ).fetchall()
    conn.close()
    return [dict(p) for p in players]


@app.post("/api/players/{player_id}/delete")
def delete_player(player_id: int, body: dict):
    if body.get("admin_key") != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Clave de administrador incorrecta")
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM predictions WHERE player_id = ?", (player_id,))
    cursor.execute("DELETE FROM players WHERE id = ?", (player_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/api/players/cleanup")
def cleanup_inactive(body: dict):
    """Elimina jugadores que se registraron pero no cargaron ningún pronóstico."""
    if body.get("admin_key") != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Clave de administrador incorrecta")
    conn = get_conn()
    cursor = conn.cursor()
    rows = cursor.execute(
        "SELECT name FROM players WHERE id NOT IN "
        "(SELECT DISTINCT player_id FROM predictions)"
    ).fetchall()
    names = [r["name"] for r in rows]
    cursor.execute(
        "DELETE FROM players WHERE id NOT IN "
        "(SELECT DISTINCT player_id FROM predictions)"
    )
    conn.commit()
    conn.close()
    return {"deleted": len(names), "names": names}


@app.get("/api/players/{player_id}/board")
def player_board(player_id: int):
    """Pronósticos de un jugador, SOLO de partidos ya cerrados (anti-trampa).
    Los partidos aún abiertos no revelan la jugada de otros."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT pr.match_id, pr.home_score, pr.away_score, m.date "
        "FROM predictions pr JOIN matches m ON m.id = pr.match_id "
        "WHERE pr.player_id = ?", (player_id,)
    ).fetchall()
    conn.close()
    return [
        {"match_id": r["match_id"], "home_score": r["home_score"], "away_score": r["away_score"]}
        for r in rows if is_locked(r["date"])
    ]


# ---------- Endpoints: pronósticos ----------
def verify_pin(cursor, player_id: int, pin: str):
    p = cursor.execute(
        "SELECT pin FROM players WHERE id = ?", (player_id,)
    ).fetchone()
    if not p or p["pin"] != hash_pin(pin.strip()):
        raise HTTPException(status_code=403, detail="PIN incorrecto")


@app.post("/api/predictions")
def save_prediction(pred: PredictionUpdate):
    conn = get_conn()
    cursor = conn.cursor()
    try:
        verify_pin(cursor, pred.player_id, pred.pin)
        match = cursor.execute(
            "SELECT date FROM matches WHERE id = ?", (pred.match_id,)
        ).fetchone()
        if not match:
            raise HTTPException(status_code=404, detail="Partido no encontrado")
        if is_locked(match["date"]):
            raise HTTPException(
                status_code=423, detail="Apuestas cerradas para este partido"
            )
        cursor.execute(
            '''INSERT INTO predictions (player_id, match_id, home_score, away_score)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(player_id, match_id) DO UPDATE SET
               home_score = excluded.home_score,
               away_score = excluded.away_score''',
            (pred.player_id, pred.match_id, pred.home_score, pred.away_score),
        )
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@app.get("/api/predictions/{player_id}")
def get_player_predictions(player_id: int):
    conn = get_conn()
    preds = conn.execute(
        "SELECT * FROM predictions WHERE player_id = ?", (player_id,)
    ).fetchall()
    conn.close()
    return [dict(p) for p in preds]


# ---------- Endpoints: partidos / resultados ----------
@app.get("/api/matches")
def get_matches():
    conn = get_conn()
    matches = conn.execute("SELECT * FROM matches ORDER BY date").fetchall()
    conn.close()
    out = []
    for m in matches:
        d = dict(m)
        d["locked"] = is_locked(d["date"])
        out.append(d)
    return out


# Caché en memoria para datos que vienen de la API externa (TTL corto).
_cache: dict = {}


def _cached(key: str, ttl_seconds: int, producer):
    """Devuelve datos cacheados; recalcula con `producer` si expiró el TTL.
    Si la API externa falla pero hay un valor previo, se reusa (degradación suave)."""
    now = datetime.now()
    entry = _cache.get(key)
    if entry and (now - entry["at"]).total_seconds() < ttl_seconds:
        return entry["data"]
    try:
        data = producer()
        _cache[key] = {"data": data, "at": now}
        return data
    except Exception as e:
        if entry:
            return entry["data"]
        raise HTTPException(status_code=502, detail=f"No se pudo consultar la API externa: {e}")


@app.get("/api/standings")
def get_standings():
    """Tabla de posiciones por grupo (desde worldcup26.ir, traducida y cacheada)."""
    from worldcup_api import standings
    return _cached("standings", 300, standings)


@app.get("/api/stadiums")
def get_stadiums():
    """Sedes del Mundial 2026 (desde worldcup26.ir, cacheadas 6 h)."""
    from worldcup_api import stadiums_list
    return _cached("stadiums", 21600, stadiums_list)


@app.post("/api/matches/{match_id}/result")
def set_result(match_id: str, body: ResultUpdate):
    if body.admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Clave de administrador incorrecta")
    conn = get_conn()
    cursor = conn.cursor()
    m = cursor.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not m:
        conn.close()
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    cursor.execute(
        "UPDATE matches SET home_goals = ?, away_goals = ?, status = 'FT' WHERE id = ?",
        (body.home_goals, body.away_goals, match_id),
    )
    conn.commit()
    conn.close()
    recalculate_scores()
    return {"status": "ok"}


@app.post("/api/recalculate")
def force_recalculate(body: dict):
    if body.get("admin_key") != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Clave de administrador incorrecta")
    recalculate_scores()
    return {"status": "ok"}


# La raíz redirige a la web para que el enlace "pelado" funcione al compartir.
@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")


# Servir archivos estáticos
if os.path.exists("web"):
    app.mount("/static", StaticFiles(directory="web", html=True), name="static")


# ---------- Sincronización automática de resultados ----------
SYNC_INTERVAL_MINUTES = 15


def start_auto_sync():
    """Sincroniza fixture y resultados desde la API en vivo worldcup26.ir cada
    15 minutos en un hilo de fondo (sin clave). Cubre los 104 partidos (grupos +
    eliminatoria). Desactivable con AUTO_SYNC=0; el panel de administración de la
    web sigue disponible para correcciones manuales."""
    if os.environ.get("AUTO_SYNC", "1") == "0":
        print("Auto-sync desactivado (AUTO_SYNC=0); usa el panel admin.")
        return
    import threading

    def loop():
        from worldcup_api import sync_all
        first = True
        while True:
            try:
                # En el primer ciclo forzamos la siembra completa del fixture.
                sync_all(force=first)
                first = False
            except Exception as e:
                print(f"[AVISO] Falló la sincronización automática: {e}")
            threading.Event().wait(SYNC_INTERVAL_MINUTES * 60)

    threading.Thread(target=loop, daemon=True).start()
    print(f"Auto-sync activado: fixture y resultados cada {SYNC_INTERVAL_MINUTES} min.")


if __name__ == "__main__":
    init_db()
    start_auto_sync()
    port = int(os.environ.get("PORT", "8000"))
    print(f"Iniciando servidor en http://localhost:{port}")
    print(f"Web: http://localhost:{port}/static/index.html")
    uvicorn.run(app, host="0.0.0.0", port=port)
