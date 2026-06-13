"""Siembra los partidos del Mundial 2026 en la BD leyendo el calendario
oficial desde el Excel original (DOC-20260611-WA0002..xlsx).

Uso: python seed_db.py
"""
import os
import sqlite3
import openpyxl

DB_PATH = os.environ.get("DB_PATH", "prode.db")
EXCEL_PATH = "DOC-20260611-WA0002..xlsx"

# Mapeo nombre de país -> código de bandera para flagcdn.com (ISO 3166-1 alpha-2).
FLAGS = {
    "Alemania": "de", "Arabia Saudita": "sa", "Argelia": "dz", "Argentina": "ar",
    "Australia": "au", "Austria": "at", "Bosnia y Herzegovina": "ba", "Brasil": "br",
    "Bélgica": "be", "Cabo Verde": "cv", "Canadá": "ca", "Catar": "qa",
    "Colombia": "co", "Corea del Sur": "kr", "Costa de Marfil": "ci", "Croacia": "hr",
    "Curazao": "cw", "EEUU": "us", "Ecuador": "ec", "Egipto": "eg",
    "Escocia": "gb-sct", "España": "es", "Francia": "fr", "Ghana": "gh",
    "Haití": "ht", "Inglaterra": "gb-eng", "Irak": "iq", "Irán": "ir",
    "Japón": "jp", "Jordania": "jo", "Marruecos": "ma", "México": "mx",
    "Noruega": "no", "Nueva Zelanda": "nz", "Panamá": "pa", "Paraguay": "py",
    "Países Bajos": "nl", "Portugal": "pt", "RD Congo": "cd",
    "República Checa": "cz", "Senegal": "sn", "Sudáfrica": "za", "Suecia": "se",
    "Suiza": "ch", "Turquía": "tr", "Túnez": "tn", "Uruguay": "uy",
    "Uzbekistán": "uz",
}


def flag(team: str) -> str:
    code = FLAGS.get(team, "un")  # "un" = bandera ONU como fallback
    return f"https://flagcdn.com/w80/{code}.png"


def read_matches():
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb["PARTIDOS"]
    matches = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        mid, fecha, local, visita, grupo = row[0], row[1], row[2], row[3], row[4]
        if not mid:
            continue
        # fecha viene como datetime de Excel.
        date_str = fecha.strftime("%Y-%m-%d %H:%M:%S") if fecha else ""
        matches.append({
            "id": str(mid),
            "home": local,
            "away": visita,
            "date": date_str,
            "group": grupo or "",
        })
    return matches


def populate_matches():
    if not os.path.exists(DB_PATH):
        from main import init_db
        init_db()

    matches = read_matches()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    for m in matches:
        cursor.execute('''
            INSERT INTO matches
                (id, home_team, away_team, home_logo, away_logo, date, group_name, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'NS')
            ON CONFLICT(id) DO UPDATE SET
                home_team = excluded.home_team,
                away_team = excluded.away_team,
                home_logo = excluded.home_logo,
                away_logo = excluded.away_logo,
                date = excluded.date,
                group_name = excluded.group_name
        ''', (m["id"], m["home"], m["away"], flag(m["home"]), flag(m["away"]),
              m["date"], m["group"]))
    conn.commit()
    conn.close()
    print(f"[OK] {len(matches)} partidos cargados en la base de datos.")


if __name__ == "__main__":
    populate_matches()
