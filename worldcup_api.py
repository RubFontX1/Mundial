# -*- coding: utf-8 -*-
"""Fuente de datos en vivo del Mundial 2026 desde la API pública worldcup26.ir
(proyecto rezarahiminia/worldcup2026).

A diferencia de la sincronización con ESPN (`sync_api.py`, que solo cubría la
fase de grupos y dependía de un mapeo frágil de nombres), esta API entrega el
dataset oficial completo en una sola fuente:

  - 48 equipos con escudo y código FIFA      -> /get/teams
  - 104 partidos (grupos + toda la eliminatoria) con marcador y estado -> /get/games
  - 16 estadios con ciudad/país/capacidad     -> /get/stadiums
  - Tabla de posiciones por grupo             -> /get/groups

`sync_all()` siembra/actualiza la tabla `matches` (fixture, sedes y resultados)
y recalcula el ranking. Corre solo cada 15 min desde `main.py` y también puede
ejecutarse a mano:  `python worldcup_api.py [--force]`.
"""
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import requests

# Reutilizamos el mapeo inglés->español y el normalizador ya existentes.
from sync_api import TEAM_MAP, norm

BASE = os.environ.get("WC_API_BASE", "https://worldcup26.ir").rstrip("/")
DB_PATH = os.environ.get("DB_PATH", "prode.db")
TIMEOUT = 30

# type de la API -> orden de fase (para ordenar/agrupar en el frontend).
STAGE_ORDER = {
    "group": 0, "r32": 1, "r16": 2, "qf": 3, "sf": 4, "third": 5, "final": 6,
}

# La API entrega la hora LOCAL de cada sede sin zona horaria. Mapa
# stadium_id -> offset UTC (en horas) válido para jun/jul 2026.
# EE.UU. y Canadá están en horario de verano (DST); México no usa DST.
STADIUM_UTC_OFFSET = {
    "1": -6,   # Ciudad de México (Estadio Azteca)
    "2": -6,   # Guadalajara
    "3": -6,   # Monterrey
    "4": -5,   # Dallas (Central, DST)
    "5": -5,   # Houston (Central)
    "6": -5,   # Kansas City (Central)
    "7": -4,   # Atlanta (Eastern, DST)
    "8": -4,   # Miami (Eastern)
    "9": -4,   # Boston/Foxborough (Eastern)
    "10": -4,  # Filadelfia (Eastern)
    "11": -4,  # Nueva York/Nueva Jersey (Eastern)
    "12": -4,  # Toronto (Eastern)
    "13": -7,  # Vancouver (Pacific, DST)
    "14": -7,  # Seattle (Pacific)
    "15": -7,  # San Francisco Bay Area (Pacific)
    "16": -7,  # Los Ángeles (Pacific)
}
DEFAULT_UTC_OFFSET = -5  # por si apareciera una sede no mapeada


# ---------- Acceso HTTP ----------
def _get(path: str):
    resp = requests.get(f"{BASE}{path}", timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_teams():
    return _get("/get/teams")["teams"]


def fetch_games():
    return _get("/get/games")["games"]


def fetch_stadiums():
    return _get("/get/stadiums")["stadiums"]


def fetch_groups():
    return _get("/get/groups")["groups"]


# ---------- Traducción de nombres ----------
def en_to_es(name_en: str | None) -> str | None:
    """Traduce un nombre de equipo en inglés al español usado en la UI.
    Si no hay mapeo, devuelve el original (mejor mostrar algo que nada)."""
    if not name_en:
        return None
    if name_en in TEAM_MAP:
        return TEAM_MAP[name_en]
    target = norm(name_en)
    for en, es in TEAM_MAP.items():
        if norm(en) == target or norm(es) == target:
            return es
    return name_en


def translate_label(label: str | None) -> str | None:
    """Traduce los rótulos de equipos por definir de la eliminatoria.
    'Winner Group A' -> '1° Grupo A', 'Runner-up Group B' -> '2° Grupo B',
    '3rd Group C/D/F/G/H' -> '3° Grupo C/D/F/G/H', 'Winner Match 73' -> 'Ganador P73',
    'Loser Match 101' -> 'Perdedor P101'."""
    if not label:
        return None
    m = re.match(r"Winner Group (.+)", label)
    if m:
        return f"1° Grupo {m.group(1)}"
    m = re.match(r"Runner-up Group (.+)", label)
    if m:
        return f"2° Grupo {m.group(1)}"
    m = re.match(r"3rd Group (.+)", label)
    if m:
        return f"3° Grupo {m.group(1)}"
    m = re.match(r"Winner Match (\d+)", label)
    if m:
        return f"Ganador P{m.group(1)}"
    m = re.match(r"Loser Match (\d+)", label)
    if m:
        return f"Perdedor P{m.group(1)}"
    return label


def parse_date(local_date: str | None, offset_hours: int = 0) -> str:
    """Convierte la hora LOCAL de la sede a un timestamp UTC ISO-8601.
    '06/11/2026 13:00' (hora de la sede) + offset -6  ->  '2026-06-11T19:00:00Z'.
    El frontend lo muestra después en la hora local de cada usuario."""
    if not local_date:
        return ""
    try:
        dt = datetime.strptime(local_date.strip(), "%m/%d/%Y %H:%M")
    except ValueError:
        return ""
    # UTC = hora_local - offset (offset es negativo en América, así que suma).
    utc = dt - timedelta(hours=offset_hours)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def _int(val):
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


# ---------- Resolución de equipos y estado ----------
def _resolve_team(game: dict, side: str, team_idx: dict):
    """Devuelve (nombre, escudo_url) para 'home' o 'away'.
    Equipos confirmados se resuelven por id (nombre ES + escudo de la API);
    los de eliminatoria sin definir muestran su rótulo traducido y sin escudo."""
    tid = game.get(f"{side}_team_id")
    if tid and tid != "0" and tid in team_idx:
        t = team_idx[tid]
        return t["name"], t["flag"]
    # Respaldo: nombre en inglés provisto por el partido.
    en = game.get(f"{side}_team_name_en")
    if en:
        return en_to_es(en), None
    # Equipo por definir (eliminatoria).
    return translate_label(game.get(f"{side}_team_label")) or "Por definir", None


def _status_and_scores(game: dict):
    """Devuelve (status, home_goals, away_goals). Solo registra goles cuando el
    partido terminó o está en vivo: los 0-0 de partidos no jugados quedan NULL."""
    finished = game.get("finished") == "TRUE" or game.get("time_elapsed") == "finished"
    elapsed = (game.get("time_elapsed") or "").lower()
    if finished:
        return "FT", _int(game.get("home_score")), _int(game.get("away_score"))
    if elapsed and elapsed not in ("notstarted", "not started", "ns", ""):
        return "LIVE", _int(game.get("home_score")), _int(game.get("away_score"))
    return "NS", None, None


# ---------- Índice local para preservar pronósticos existentes ----------
def _existing_index(cur) -> dict:
    """(home_norm, away_norm) -> id, para casar los partidos de grupo ya
    sembrados (M01..M72) y conservar sus pronósticos al re-sincronizar."""
    idx = {}
    for r in cur.execute("SELECT id, home_team, away_team FROM matches").fetchall():
        idx[(norm(r["home_team"]), norm(r["away_team"]))] = r["id"]
    return idx


def _pending_sync(cur) -> bool:
    """True si vale la pena consultar la API: hay un partido ya empezado sin
    resultado final. Evita golpear la API cuando no hay nada que actualizar."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    row = cur.execute(
        "SELECT home_team, away_team FROM matches "
        "WHERE status != 'FT' AND date != '' AND date <= ? ORDER BY date LIMIT 1",
        (now,),
    ).fetchone()
    if row:
        print(f"[..] Partidos por actualizar (ej: {row['home_team']} vs {row['away_team']}).")
        return True
    nxt = cur.execute(
        "SELECT home_team, away_team, date FROM matches "
        "WHERE status != 'FT' AND date != '' ORDER BY date LIMIT 1"
    ).fetchone()
    if nxt:
        print(f"[OK] Sin pendientes. Próximo: {nxt['home_team']} vs {nxt['away_team']} "
              f"el {nxt['date'][:16]}. No se consulta la API.")
    else:
        print("[OK] Todos los partidos tienen resultado. No se consulta la API.")
    return False


# ---------- Sincronización principal ----------
def sync_all(force: bool = False):
    """Siembra/actualiza fixture, sedes y resultados de los 104 partidos desde
    worldcup26.ir y recalcula el ranking. Idempotente."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Si ya hay 104 partidos y nada por actualizar, no gastamos la consulta.
    seeded = cur.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    if not force and seeded >= 104 and not _pending_sync(cur):
        conn.close()
        return

    print("[..] Consultando worldcup26.ir (Mundial 2026)...")
    teams = fetch_teams()
    stadiums = fetch_stadiums()
    games = fetch_games()
    print(f"[OK] {len(teams)} equipos, {len(stadiums)} estadios, {len(games)} partidos.")

    team_idx = {
        t["id"]: {"name": en_to_es(t.get("name_en")), "flag": t.get("flag")}
        for t in teams
    }
    stad_idx = {
        s["id"]: {
            "name": s.get("name_en") or s.get("fifa_name") or "",
            "city": s.get("city_en") or "",
            "country": s.get("country_en") or "",
        }
        for s in stadiums
    }
    existing = _existing_index(cur)

    upserted = 0
    for g in games:
        stage = g.get("type", "group")
        home, home_flag = _resolve_team(g, "home", team_idx)
        away, away_flag = _resolve_team(g, "away", team_idx)
        status, hg, ag = _status_and_scores(g)
        sid = g.get("stadium_id")
        date = parse_date(g.get("local_date"), STADIUM_UTC_OFFSET.get(sid, DEFAULT_UTC_OFFSET))
        stad = stad_idx.get(sid, {})

        # Preservar el id de partidos de grupo ya sembrados (M01..M72).
        key, rkey = (norm(home), norm(away)), (norm(away), norm(home))
        if key in existing:
            mid = existing[key]
        elif rkey in existing:
            # La BD los tiene invertidos: mantener su orientación y dar vuelta el marcador.
            mid = existing[rkey]
            home, away = away, home
            home_flag, away_flag = away_flag, home_flag
            hg, ag = ag, hg
        else:
            mid = str(g["id"])

        cur.execute(
            """INSERT INTO matches
                 (id, home_team, away_team, home_logo, away_logo, date, group_name,
                  stage, stadium, city, matchday, home_goals, away_goals, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 home_team = excluded.home_team,
                 away_team = excluded.away_team,
                 home_logo = excluded.home_logo,
                 away_logo = excluded.away_logo,
                 date = excluded.date,
                 group_name = excluded.group_name,
                 stage = excluded.stage,
                 stadium = excluded.stadium,
                 city = excluded.city,
                 matchday = excluded.matchday,
                 home_goals = excluded.home_goals,
                 away_goals = excluded.away_goals,
                 status = excluded.status""",
            (mid, home, away, home_flag, away_flag, date, g.get("group", ""),
             stage, stad.get("name", ""), stad.get("city", ""), g.get("matchday", ""),
             hg, ag, status),
        )
        upserted += 1

    conn.commit()
    conn.close()

    from main import recalculate_scores
    recalculate_scores()
    print(f"[OK] {upserted} partidos sincronizados, ranking recalculado.")


# ---------- Standings traducidos (para /api/standings) ----------
def standings():
    """Devuelve las tablas de posiciones por grupo con nombres en español y
    escudos. No toca la BD: se arma en vivo desde la API."""
    teams = fetch_teams()
    team_idx = {
        t["id"]: {"name": en_to_es(t.get("name_en")), "flag": t.get("flag")}
        for t in teams
    }
    out = []
    for grp in fetch_groups():
        rows = []
        for r in grp.get("teams", []):
            t = team_idx.get(r.get("team_id"), {})
            rows.append({
                "team": t.get("name", "?"),
                "flag": t.get("flag"),
                "mp": _int(r.get("mp")) or 0, "w": _int(r.get("w")) or 0,
                "d": _int(r.get("d")) or 0, "l": _int(r.get("l")) or 0,
                "gf": _int(r.get("gf")) or 0, "ga": _int(r.get("ga")) or 0,
                "gd": _int(r.get("gd")) or 0, "pts": _int(r.get("pts")) or 0,
            })
        rows.sort(key=lambda x: (-x["pts"], -x["gd"], -x["gf"], x["team"]))
        out.append({"name": grp.get("name", ""), "teams": rows})
    out.sort(key=lambda x: x["name"])
    return out


def stadiums_list():
    """Lista de sedes con nombre/ciudad/país/capacidad para la vista de estadios."""
    return [
        {
            "id": s.get("id"),
            "name": s.get("name_en") or s.get("fifa_name") or "",
            "fifa_name": s.get("fifa_name") or "",
            "city": s.get("city_en") or "",
            "country": s.get("country_en") or "",
            "capacity": _int(s.get("capacity")),
            "region": s.get("region") or "",
        }
        for s in fetch_stadiums()
    ]


if __name__ == "__main__":
    import sys
    sync_all(force="--force" in sys.argv)
