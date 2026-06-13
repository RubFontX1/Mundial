"""Conexión a PostgreSQL (Supabase) con pool de conexiones.

La app usa una base PostgreSQL persistente. La cadena de conexión se toma de la
variable de entorno DATABASE_URL (pooler de Supabase, IPv4):

    postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres

En vez de abrir/cerrar una conexión nueva por request (frágil y lento contra el
pooler gratuito de Supabase), mantenemos un pool pequeño y reutilizable. Usa
siempre el context manager `db_conn()` para que la conexión se devuelva al pool y
se haga commit/rollback automáticamente, incluso si una consulta lanza error.
"""
import os
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Pool perezoso: se crea en el primer uso para no fallar al importar el módulo.
_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError(
                "Falta DATABASE_URL: define la cadena de conexión de Postgres/Supabase."
            )
        _pool = ConnectionPool(
            conninfo=DATABASE_URL,
            min_size=1,
            max_size=5,
            # Cierra conexiones inactivas para no agotar el pooler de Supabase.
            max_idle=300,
            kwargs={
                "row_factory": dict_row,
                # El pooler de Supabase en modo 'transaction' no mantiene
                # prepared statements entre transacciones.
                "prepare_threshold": None,
                "autocommit": False,
            },
        )
    return _pool


@contextmanager
def db_conn():
    """Toma una conexión del pool y la devuelve al terminar.

    - Hace commit si el bloque termina bien.
    - Hace rollback si se lanza una excepción.
    - La conexión SIEMPRE vuelve al pool (no se fuga aunque haya error).
    """
    pool = _get_pool()
    with pool.connection() as conn:  # gestiona commit/rollback/devolución al pool
        yield conn


def get_conn():
    """Compatibilidad: abre una conexión suelta del pool.

    Preferir `with db_conn() as conn:`. Quien use esto debe cerrar la conexión.
    """
    return _get_pool().getconn()
