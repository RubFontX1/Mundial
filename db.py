"""Conexión a PostgreSQL (Supabase).

La app usa una base PostgreSQL persistente. La cadena de conexión se toma de la
variable de entorno DATABASE_URL (pooler de Supabase, IPv4):

    postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
"""
import os

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def get_conn():
    """Abre una conexión nueva con filas tipo dict (como sqlite3.Row)."""
    if not DATABASE_URL:
        raise RuntimeError(
            "Falta DATABASE_URL: define la cadena de conexión de Postgres/Supabase."
        )
    # prepare_threshold=None: el pooler de Supabase en modo 'transaction' no
    # mantiene prepared statements entre transacciones.
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None)
