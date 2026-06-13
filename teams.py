# -*- coding: utf-8 -*-
"""Datos puros de equipos: mapeo de nombres inglés -> español y normalizador.

Antes vivía dentro de `sync_api.py` (sincronización vía ESPN sobre SQLite, ya
retirada). Lo extrajimos aquí para que `worldcup_api.py` lo use sin arrastrar
código de base de datos legado.
"""
import unicodedata

# Nombre de equipo en inglés -> nombre usado en la UI (español).
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
