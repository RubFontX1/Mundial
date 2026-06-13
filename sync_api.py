# -*- coding: utf-8 -*-
"""Sincroniza los resultados reales del Mundial 2026 desde la API pública
de ESPN (gratis, sin clave).

No inserta partidos nuevos: busca cada partido de ESPN por nombres de
equipos (inglés -> español) y actualiza los goles del partido M01..M72
correspondiente. Así los pronósticos nunca quedan huérfanos.

Uso: python sync_api.py
(También corre solo cada 15 min cuando el servidor está levantado.)
"""
import os
import sqlite3
import unicodedata
from datetime import datetime, timedelta

import requests

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
DB_PATH = os.environ.get("DB_PATH", "prode.db")
TOURNAMENT_START = datetime(2026, 6, 11)

# Estados de ESPN.
FINISHED = {"STATUS_FULL_TIME", "STATUS_FINAL"}
LIVE = {"STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_FIRST_HALF", "STATUS_SECOND_HALF"}

# Nombre de equipo en ESPN (inglés) -> nombre usado en la BD (español).
TEAM_MAP = {
    "Mexico": "México", "South Africa": "Sudáfrica", "South Korea": "Corea del Sur",
    "Korea Republic": "Corea del Sur", "Czech Republic": "República Checa",
    "Czechia": "República Checa", "Canada": "Canadá",
    "Bosnia and Herzegovina": "Bosnia y Herzegovina",
    "Bosnia & Herzegovina": "Bosnia y Herzegovina", "Qatar": "Catar",
    "Switzerland": "Suiza", "Brazil": "Brasil", "Morocco": "Marruecos",
    "Haiti": "Haití", "Scotland": "Escocia", "USA": "EEUU",
    "United States": "EEUU", "Paraguay": "Paraguay", "Australia": "Australia",
    "Turkey": "Turquía", "Türkiye": "Turquía", "Germany": "Alemania",
    "Curacao": "Curazao", "Curaçao": "Curazao",
    "Ivory Coast": "Costa de Marfil", "Côte d'Ivoire": "Costa de Marfil",
    "Cote d'Ivoire": "Costa de Marfil", "Ecuador": "Ecuador",
    "Netherlands": "Países Bajos", "Japan": "Japón", "Tunisia": "Túnez",
    "Sweden": "Suecia", "Belgium": "Bélgica", "Egypt": "Egipto",
    "Iran": "Irán", "New Zealand": "Nueva Zelanda", "Spain": "España",
    "Cape Verde Islands": "Cabo Verde", "Cape Verde": "Cabo Verde",
    "Cabo Verde": "Cabo Verde", "Saudi Arabia": "Arabia Saudita",
    "Uruguay": "Uruguay", "France": "Francia", "Senegal": "Senegal",
    "Iraq": "Irak", "Norway": "Noruega", "Argentina": "Argentina",
    "Algeria": "Argelia", "Austria": "Austria", "Jordan": "Jordania",
    "Portugal": "Portugal", "Colombia": "Colombia", "Uzbekistan": "Uzbekistán",
    "Congo DR": "RD Congo", "DR Congo": "RD Congo",
    "Democratic Republic of the Congo": "RD Congo", "England": "Inglaterra",
    "Croatia": "Croacia", "Ghana": "Ghana", "Panama": "Panamá",
}


def norm(name: str) -> str:
    """Normaliza un nombre para comparar: minúsculas y sin tildes."""
    s = unicodedata.normalize("NFD", name or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


def to_spanish(api_name: str) -> str | None:
    if api_name in TEAM_MAP:
        return TEAM_MAP[api_name]
    # Fallback: comparar normalizado por si ESPN cambia mayúsculas/tildes.
    target = norm(api_name)
    for en, es in TEAM_MAP.items():
        if norm(en) == target or norm(es) == target:
            return es
    return None


def pending_sync(cur) -> bool:
    """True si vale la pena consultar la API: hay algún partido en vivo o
    uno que ya comenzó y aún no tiene resultado final. Si el próximo partido
    sin resultado todavía no empieza, no se gasta la consulta."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    row = cur.execute(
        "SELECT id, home_team, away_team, date FROM matches "
        "WHERE status != 'FT' AND date <= ? ORDER BY date LIMIT 1", (now,)
    ).fetchone()
    if row:
        print(f"[..] Hay partidos por actualizar (ej: {row['home_team']} vs {row['away_team']}).")
        return True
    nxt = cur.execute(
        "SELECT home_team, away_team, date FROM matches "
        "WHERE status != 'FT' ORDER BY date LIMIT 1"
    ).fetchone()
    if nxt:
        print(f"[OK] Sin partidos pendientes. Próximo: {nxt['home_team']} vs "
              f"{nxt['away_team']} el {nxt['date'][:16]}. No se consulta la API.")
    else:
        print("[OK] Todos los partidos tienen resultado. No se consulta la API.")
    return False


def fetch_events():
    """Trae los eventos de ESPN desde el inicio del torneo hasta mañana."""
    start = TOURNAMENT_START.strftime("%Y%m%d")
    end = (datetime.now() + timedelta(days=1)).strftime("%Y%m%d")
    resp = requests.get(
        SCOREBOARD_URL,
        params={"dates": f"{start}-{end}", "limit": 200},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("events", [])


def sync_results(force: bool = False):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Evitar consultas innecesarias: solo llamar a la API si hay un partido
    # en curso o terminado sin resultado registrado.
    if not force and not pending_sync(cur):
        conn.close()
        return

    print("[..] Consultando ESPN (Mundial 2026)...")
    events = fetch_events()
    print(f"[OK] {len(events)} partidos recibidos.")

    # Índice de partidos locales: (local, visita) normalizados -> fila.
    local_idx = {}
    for m in cur.execute("SELECT id, home_team, away_team, date FROM matches"):
        local_idx[(norm(m["home_team"]), norm(m["away_team"]))] = dict(m)

    updated, skipped = 0, []
    for ev in events:
        comp = ev.get("competitions", [{}])[0]
        status = ev.get("status", {}).get("type", {}).get("name", "")
        if status not in FINISHED | LIVE:
            continue  # aún no empieza: nada que actualizar

        teams = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        if "home" not in teams or "away" not in teams:
            continue
        h_name = teams["home"].get("team", {}).get("displayName", "")
        a_name = teams["away"].get("team", {}).get("displayName", "")
        try:
            h_goals = int(teams["home"].get("score"))
            a_goals = int(teams["away"].get("score"))
        except (TypeError, ValueError):
            continue

        home, away = to_spanish(h_name), to_spanish(a_name)
        if not home or not away:
            skipped.append(f"{h_name} vs {a_name} (equipo sin mapear)")
            continue

        match = local_idx.get((norm(home), norm(away))) or local_idx.get((norm(away), norm(home)))
        if not match:
            skipped.append(f"{home} vs {away} (no está en la BD)")
            continue

        # Si ESPN lo tiene invertido respecto a nuestra BD, invertir goles.
        if norm(match["home_team"]) != norm(home):
            h_goals, a_goals = a_goals, h_goals

        # Verificación extra: la fecha debe coincidir (+/- 1 día por husos horarios).
        try:
            api_dt = datetime.strptime(ev["date"][:16], "%Y-%m-%dT%H:%M")
            local_dt = datetime.strptime(match["date"][:19], "%Y-%m-%d %H:%M:%S")
            if abs(api_dt - local_dt) > timedelta(days=1):
                skipped.append(f"{home} vs {away} (fecha no coincide)")
                continue
        except (ValueError, KeyError):
            pass

        db_status = "FT" if status in FINISHED else "LIVE"
        cur.execute(
            "UPDATE matches SET home_goals = ?, away_goals = ?, status = ? WHERE id = ?",
            (h_goals, a_goals, db_status, match["id"]),
        )
        updated += 1

    conn.commit()
    conn.close()

    from main import recalculate_scores
    recalculate_scores()
    print(f"[OK] {updated} partidos actualizados, ranking recalculado.")
    if skipped:
        print("[AVISO] Partidos sin mapear:")
        for s in skipped:
            print(f"   - {s}")


if __name__ == "__main__":
    import sys
    # --force salta el chequeo y consulta la API siempre (útil para pruebas
    # o para corregir un resultado que ESPN haya cambiado a posteriori).
    sync_results(force="--force" in sys.argv)
