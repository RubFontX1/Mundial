# 🏆 Prode Mundial 2026

Una aplicación web moderna y robusta para gestionar quinielas (apuestas) del Mundial 2026 entre amigos y compañeros. Diseñada con un enfoque "mobile-first", estética premium y persistencia real de datos.

## 🚀 Características principales

- **Mundial completo (104 partidos):** Fase de grupos + toda la eliminatoria (16avos → final), con sedes/estadios, alimentado en vivo desde la API pública `worldcup26.ir`.
- **Registro con PIN:** Cada jugador se anota con un nombre y un PIN de 4 dígitos que protege sus pronósticos (nadie más puede editarlos).
- **Pronósticos con guardado automático:** Carga tus marcadores; se guardan solos al ingresar ambos goles, agrupados por fase.
- **Cierre automático de apuestas:** Cada partido se bloquea 1 minuto antes de su inicio.
- **Ranking que se calcula solo:** Tabla de posiciones con puntaje automático (3 pts marcador exacto, 1 pt acierto de resultado).
- **Vista "El Mundial":** Posiciones reales de cada grupo + cuadro (bracket) de eliminatorias en tiempo real.
- **Resultados oficiales (en vivo + manual):** Se sincronizan solos desde `worldcup26.ir` cada 15 min; también puedes corregirlos a mano desde la pestaña Admin.
- **Persistencia con SQLite:** Los datos viven en una base de datos real en el servidor; todos los compañeros ven la misma tabla.

## 🛠️ Stack Tecnológico

- **Frontend:** HTML5, CSS, JavaScript (Vanilla ES6+).
- **Backend:** Python con **FastAPI** (Rápido, moderno y eficiente).
- **Base de Datos:** SQLite (Sencillo, sin configuración pesada).
- **Fuente de datos en vivo:** API pública `worldcup26.ir` (proyecto [rezarahiminia/worldcup2026](https://github.com/rezarahiminia/worldcup2026)) para fixture, sedes y resultados de los 104 partidos. Sin clave.
- **Respaldo opcional:** ESPN (`sync_api.py`) sigue disponible como sincronizador alternativo de la fase de grupos.

## 📦 Instalación y Despliegue

### Requisitos previos
- Python 3.9 o superior.
- Una API Key de [API-Football](https://dashboard.api-football.com/).

### Pasos para ejecutar localmente

1. **Clonar el proyecto y entrar a la carpeta:**
   ```bash
   cd mundial
   ```

2. **Instalar dependencias:**
   ```bash
   pip install fastapi uvicorn requests openpyxl
   ```

3. **Ejecutar el servidor:**
   ```bash
   python main.py
   ```
   En el primer arranque siembra solo los 104 partidos desde `worldcup26.ir`
   (no necesitas `seed_db.py`). Para sembrar a mano sin levantar el servidor:
   ```bash
   python worldcup_api.py --force
   ```
   *Alternativa offline:* `python seed_db.py` carga la fase de grupos desde el Excel.
   *El servidor iniciará en `http://localhost:8000`*

4. **Acceder a la Web:**
   Abre tu navegador en `http://localhost:8000/static/index.html`.

### 🔑 Configuración (variables de entorno)

| Variable | Para qué sirve | Por defecto |
|----------|----------------|-------------|
| `ADMIN_KEY` | Clave para cargar resultados desde la pestaña **Admin**. | `mundial2026` |
| `DB_PATH` | Ruta del archivo SQLite. En la nube apúntala a un disco persistente. | `prode.db` |
| `WC_API_BASE` | Base de la API de datos del Mundial. | `https://worldcup26.ir` |
| `AUTO_SYNC` | `0` desactiva la sincronización automática en vivo. | `1` |

En PowerShell, antes de lanzar el servidor:
```powershell
$env:ADMIN_KEY = "miClaveSecreta"
```

## ☁️ Publicar en internet (Render)

Esta app necesita un proceso **siempre encendido** (el auto-sync corre en segundo
plano) y un archivo SQLite **persistente**. Por eso **Render** (servicio Docker) es
el lugar ideal. **Vercel no sirve** aquí: es serverless, no mantiene procesos vivos
ni conserva la base de datos entre peticiones.

Pasos:

1. Sube el proyecto a un repositorio de **GitHub** (`git init`, commit y push).
2. En [Render](https://render.com): **New + → Blueprint** y conecta tu repo. Render
   lee el archivo [`render.yaml`](./render.yaml) incluido y configura todo solo.
3. En el panel del servicio, en **Environment**, define `ADMIN_KEY` con tu clave secreta.
4. **Deploy**. Tu web quedará en `https://<nombre>.onrender.com` lista para compartir.

> **Persistencia:** `render.yaml` reserva un disco de 1 GB para `DB_PATH=/data/prode.db`
> (requiere plan *starter*, ~7 USD/mes). En plan **free** la app funciona igual, pero
> los jugadores/pronósticos se reinician al redeployar o al dormirse el servicio; el
> fixture y los resultados siempre se re-sincronizan solos desde `worldcup26.ir`.

### 📥 Cargar resultados oficiales

- **Automático (en vivo):** el servidor sincroniza fixture y resultados desde
  `worldcup26.ir` cada 15 min. Forzar a mano: `python worldcup_api.py --force`.
- **A mano:** entra a la pestaña **Admin** en la web, escribe la `ADMIN_KEY` y teclea
  los marcadores finales. El ranking se recalcula solo.

## 📏 Reglas del Juego

1. **Marcador Exacto (3 Puntos):** Aciertas el resultado final exacto.
2. **Resultado Parcial (1 Punto):** Aciertas quién gana o si hay empate, pero no los goles exactos.
3. **Cierre de Apuestas:** Los partidos se bloquean automáticamente 1 minuto antes del inicio oficial.

## 📝 Notas de Desarrollo
Este proyecto ha sido migrado de una versión estática a una arquitectura cliente-servidor para permitir que múltiples personas participen desde diferentes dispositivos viendo la misma tabla de posiciones.

---
Hecho para disfrutar el Mundial entre amigos ⚽
