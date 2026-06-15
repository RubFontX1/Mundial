/* ============================================================
   MUNDIAL 2026 · Prode entre amigos — lógica de la app
   ============================================================ */

let state = {
    players: [],
    matches: [],
    currentPlayer: null,
    pin: sessionStorage.getItem('prode_pin') || null,
    adminKey: sessionStorage.getItem('prode_admin') || null,
    predictions: {},
    view: 'hoy',
    standings: null,
    bracketTab: 'grupos',   // Grupos: 'grupos' (posiciones) | 'llaves'
    rankingTab: 'tabla',    // Ranking: 'tabla' | 'resumen'
    calFilter: 'prox',      // Hoy/calendario: 'prox' | 'todos' | 'jugados'
    misFilter: 'prox',      // Mis pronósticos: 'prox' | 'todos'
    liveMatchId: null,      // partido enfocado en la vista Live
    detailId: null,         // jugador abierto desde el ranking
    boards: {},             // cache de boletas por jugador (solo partidos cerrados)
    settings: { asado_total: 0, currency: '$' }
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const FALLBACK_FLAG = 'https://flagcdn.com/w80/un.png';

const STAGES = [
    ['group', 'Fase de grupos'], ['r32', '16avos de final'], ['r16', 'Octavos de final'],
    ['qf', 'Cuartos de final'], ['sf', 'Semifinales'], ['third', 'Tercer puesto'], ['final', 'Final']
];
const STAGE_SHORT = {
    group: 'Grupos', r32: '16avos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semis', third: '3er puesto', final: 'Final'
};
const KO_ROUNDS = [
    ['r32', '16avos de final'], ['r16', 'Octavos de final'], ['qf', 'Cuartos de final'],
    ['sf', 'Semifinales'], ['third', 'Tercer puesto'], ['final', 'Final']
];

/* ---------- Utilidades ---------- */
function money(n) {
    const v = Number(n) || 0;
    const s = Number.isInteger(v) ? v.toLocaleString('es-CL') : v.toLocaleString('es-CL', { minimumFractionDigits: 2 });
    return `${state.settings.currency || '$'}${s}`;
}
function parseD(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}
function fmtTime(s) {
    const d = parseD(s);
    if (!d) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDate(s) {
    const d = parseD(s);
    if (!d) return (s || '').slice(0, 16);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${fmtTime(s)}`;
}
function dayKey(s) {
    const d = parseD(s);
    if (!d) return 'zzzz';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(s) {
    const d = parseD(s);
    if (!d) return 'Por definir';
    const today = dayKey(new Date().toISOString());
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    if (dayKey(s) === today) return 'Hoy';
    if (dayKey(s) === dayKey(tmr.toISOString())) return 'Mañana';
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function finishedM(m) { return m.home_goals !== null && m.home_goals !== undefined && m.away_goals !== null && m.away_goals !== undefined; }
function startMs(m) { const d = parseD(m.date); return d ? d.getTime() : null; }
function isLiveM(m) {
    if (finishedM(m) && m.status === 'FT') return false;
    if (m.status === 'LIVE') return true;
    const t = startMs(m); if (t === null) return false;
    const now = Date.now();
    return now >= t && now <= t + 2.5 * 3600 * 1000 && !finishedM(m);
}
function isToday(s) { return dayKey(s) === dayKey(new Date().toISOString()); }
function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
function predPoints(ph, pa, m) {
    if (!finishedM(m)) return null;
    if (ph === m.home_goals && pa === m.away_goals) return 3;
    return sign(ph - pa) === sign(m.home_goals - m.away_goals) ? 1 : 0;
}
function liveMatches() { return state.matches.filter(isLiveM).sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0)); }
function nextMatch() {
    const now = Date.now();
    return state.matches
        .filter(m => !finishedM(m) && !isLiveM(m) && (startMs(m) || 0) > now)
        .sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0))[0] || null;
}
function byMatchNumber(a, b) { return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0); }
function byStage(matches = state.matches) {
    const map = {};
    matches.forEach(m => { const s = m.stage || 'group'; (map[s] = map[s] || []).push(m); });
    return map;
}
function logo(url) { return url || FALLBACK_FLAG; }
function esc(s) { return (s || '').replace(/'/g, "\\'"); }

function toast(msg, ok = true) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = ok ? 'toast-ok' : 'toast-err';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============================================================
   ARRANQUE Y SINCRONIZACIÓN
   ============================================================ */
async function init() {
    try {
        const [resPlayers, resMatches, resSettings] = await Promise.all([
            fetch('/api/players'), fetch('/api/matches'), fetch('/api/settings')
        ]);
        state.players = await resPlayers.json();
        state.matches = await resMatches.json();
        state.settings = await resSettings.json();
    } catch (e) {
        renderSession();
        document.getElementById('content').innerHTML = `
            <div class="card empty-state">
                <div class="emoji">⚠️</div>
                <h2>No se pudo conectar</h2>
                <p>Revisa tu conexión. Si corres local, levanta el servidor con
                <code>python main.py</code> y abre /static/index.html.</p>
            </div>`;
        return;
    }

    const savedId = localStorage.getItem('prode_player_id');
    if (savedId) {
        state.currentPlayer = state.players.find(p => p.id == savedId) || null;
        if (state.currentPlayer) {
            await loadPredictions();
        } else {
            localStorage.removeItem('prode_player_id');
            sessionStorage.removeItem('prode_pin');
            state.pin = null;
        }
    }

    renderSession();
    renderTicker();
    switchView(state.view);
    startAutoRefresh();
}

async function loadPredictions() {
    state.predictions = {};
    if (!state.currentPlayer) return;
    try {
        const res = await fetch(`/api/predictions/${state.currentPlayer.id}`);
        const preds = await res.json();
        preds.forEach(p => { state.predictions[p.match_id] = { h: p.home_score, a: p.away_score }; });
    } catch (e) { /* sin pronósticos */ }
}

let _refreshing = false;
async function refreshData(rerender = true) {
    if (_refreshing) return;
    _refreshing = true;
    try {
        const [pl, ms, st] = await Promise.all([
            fetch('/api/players').then(r => r.json()),
            fetch('/api/matches').then(r => r.json()),
            fetch('/api/settings').then(r => r.json()).catch(() => state.settings)
        ]);
        state.players = pl; state.matches = ms; state.settings = st;
        state.boards = {};
        if (state.currentPlayer) {
            const me = pl.find(p => p.id == state.currentPlayer.id);
            if (me) state.currentPlayer = me;
        }
        if (rerender) { renderSession(); renderTicker(); switchView(state.view, true); }
        else { renderTicker(); }
    } catch (e) { /* reintenta al próximo ciclo */ }
    finally { _refreshing = false; }
}

let _refreshTimer = null;
function startAutoRefresh() {
    if (_refreshTimer) return;
    _refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
            // Check if we shouldn't rerender because the user might be typing
            const hasFocus = document.activeElement &&
                           (document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA');
            const preventRerender = hasFocus || (!state.currentPlayer && state.view === 'mis') || (!state.adminKey && state.view === 'admin');
            refreshData(!preventRerender);
        }
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshData(true);
        }
    });
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */
function switchView(view, preserveScroll = false) {
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
    state.view = view;
    if (view !== 'ranking') state.detailId = null;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-view="${view}"]`);
    if (btn) btn.classList.add('active');

    if (view === 'hoy') renderHoy();
    else if (view === 'grupos') renderGrupos();
    else if (view === 'live') renderLive();
    else if (view === 'ranking') renderRanking();
    else if (view === 'mis') renderMis();
    else if (view === 'admin') renderAdmin();
    if (!preserveScroll) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/* ---------- Sesión y ticker ---------- */
function renderSession() {
    const slot = document.getElementById('session-slot');
    if (!slot) return;
    if (state.currentPlayer) {
        const p = state.currentPlayer;
        slot.innerHTML = `
            <div class="session-chip">
                <div class="avatar">${p.name[0].toUpperCase()}</div>
                <div>
                    <div class="session-name">${p.name}</div>
                    <div class="session-meta">jugando</div>
                </div>
                <button class="logout-btn" title="Salir" onclick="logout()">⎋</button>
            </div>`;
    } else {
        slot.innerHTML = `<button class="header-cta" onclick="switchView('mis')">Anotarme</button>`;
    }
}

function renderTicker() {
    const el = document.getElementById('ticker');
    if (!el) return;
    const live = liveMatches();
    const today = state.matches.filter(m => isToday(m.date) && !isLiveM(m));
    const pool = [...live, ...today].slice(0, 12);
    if (!pool.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const item = m => {
        if (isLiveM(m)) {
            return `<span class="ticker-item"><span class="tk-live">● VIVO</span> <b>${m.home_team}</b> <span class="tk-sc">${m.home_goals ?? 0}-${m.away_goals ?? 0}</span> <b>${m.away_team}</b></span>`;
        }
        return `<span class="ticker-item"><span class="tk-sc">${fmtTime(m.date)}</span> <b>${m.home_team}</b> vs <b>${m.away_team}</b></span>`;
    };
    const seq = pool.map(item).join('<span class="ticker-sep">◆</span>');
    el.innerHTML = `<div class="ticker-track">${seq}<span class="ticker-sep">◆</span>${seq}</div>`;
}

/* ============================================================
   VISTA: HOY (hero + calendario cronológico)
   ============================================================ */
let _countdownTimer = null;

async function renderHoy() {
    const content = document.getElementById('content');
    content.innerHTML = `<div id="hero-slot"></div>${renderCalendar()}`;
    await renderHero();
    bindCalFilters();
}

async function renderHero() {
    const slot = document.getElementById('hero-slot');
    if (!slot) return;
    const live = liveMatches()[0];
    const todays = state.matches.filter(m => isToday(m.date));

    if (live) {
        slot.innerHTML = heroScore(live, true);
        await fillHeroPicks(live);
        return;
    }
    if (todays.length) {
        const pend = todays.filter(m => !finishedM(m)).sort((a, b) => startMs(a) - startMs(b));
        const rows = (pend.length ? pend : todays).map(m => `
            <div class="today-row" role="button" onclick="openLive('${m.id}')">
                <span class="today-time">${finishedM(m) ? `${m.home_goals}-${m.away_goals}` : fmtTime(m.date)}</span>
                <span class="today-teams">
                    <img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'">${m.home_team}
                    <span class="today-vs">vs</span>
                    <img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'">${m.away_team}
                </span>
                <span class="m-tag ${finishedM(m) ? 'ft' : 'open'}">${finishedM(m) ? 'Final' : 'Hoy'}</span>
            </div>`).join('');
        slot.innerHTML = `
            <section class="hero">
                <div class="hero-top"><span>⚽ Partidos de hoy</span><span class="hero-tag">${todays.length} en cancha</span></div>
                <div class="today-list">${rows}</div>
            </section>`;
        return;
    }
    const nx = nextMatch();
    if (nx) {
        slot.innerHTML = heroScore(nx, false);
        startCountdown(nx);
        return;
    }
    slot.innerHTML = `<section class="hero"><div class="hero-top"><span>Mundial 2026</span></div>
        <div class="empty-state"><div class="emoji">🏟️</div><h2>Sin partidos cargados</h2><p>El fixture se sincroniza solo desde la API del Mundial.</p></div></section>`;
}

// Marcador grande para un partido (modo live o próximo).
function heroScore(m, live) {
    const fin = finishedM(m);
    const showScore = live || fin;
    const nums = showScore
        ? `<div class="score-nums">${m.home_goals ?? 0}<span class="sep">:</span>${m.away_goals ?? 0}</div>`
        : `<div class="score-nums soft">vs</div>`;
    const topRight = m.group_name ? `Grupo ${m.group_name}` : (STAGE_SHORT[m.stage] || '');
    const status = live
        ? `<span class="live-dot">EN VIVO</span>`
        : fin ? `<span>Finalizado</span>` : `<span>⏱ Próximo partido</span>`;
    const when = live ? `${m.stadium ? '📍 ' + (m.city || m.stadium) : ''}`
        : fin ? `${fmtDate(m.date)}` : `<span id="cd" class="count">—</span>`;
    return `
        <section class="hero">
            <div class="hero-top">${status}<span class="hero-tag">${topRight}</span></div>
            <div class="score">
                <div class="score-team">
                    <img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'">
                    <span class="nm">${m.home_team}</span>
                </div>
                <div class="score-mid">${nums}<div class="score-when">${when}</div></div>
                <div class="score-team">
                    <img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'">
                    <span class="nm">${m.away_team}</span>
                </div>
            </div>
            ${live ? '<div class="hero-picks" id="hero-picks"></div>' : `
            <div style="text-align:center;margin-top:14px;">
                <button class="btn-ghost" onclick="openLive('${m.id}')">Ver pronósticos del grupo ›</button>
            </div>`}
        </section>`;
}

async function fillHeroPicks(m) {
    const wrap = document.getElementById('hero-picks');
    if (!wrap) return;
    await Promise.all(state.players.map(p => loadBoard(p.id)));
    const picks = state.players.map(p => ({ p, pr: (state.boards[p.id] || {})[m.id] }))
        .filter(x => x.pr);
    if (!picks.length) { wrap.innerHTML = `<div style="font-size:.7rem;color:var(--ink-soft);padding:4px 0;">Pronósticos revelados al cerrar el partido.</div>`; return; }
    wrap.innerHTML = picks.map(({ p, pr }) => {
        const pts = predPoints(pr.h, pr.a, m);
        const cls = pts === 3 ? 'hit' : pts === 1 ? 'part' : '';
        return `<div class="pchip ${cls}">
            <span class="pc-name">${p.name}</span>
            <span class="pc-pick">${pr.h}-${pr.a}</span>
        </div>`;
    }).join('');
}

function startCountdown(m) {
    const t = startMs(m); if (t === null) return;
    const tick = () => {
        const el = document.getElementById('cd');
        if (!el) { clearInterval(_countdownTimer); _countdownTimer = null; return; }
        let diff = Math.max(0, t - Date.now());
        const d = Math.floor(diff / 86400000); diff -= d * 86400000;
        const h = Math.floor(diff / 3600000); diff -= h * 3600000;
        const mi = Math.floor(diff / 60000); diff -= mi * 60000;
        const s = Math.floor(diff / 1000);
        el.textContent = d > 0 ? `${d}d ${h}h ${mi}m` : `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    tick();
    _countdownTimer = setInterval(tick, 1000);
}

// Calendario cronológico (no por grupo).
function renderCalendar() {
    const f = state.calFilter;
    const now = Date.now();
    let list;
    if (f === 'prox') list = state.matches.filter(m => !finishedM(m) && (startMs(m) || 0) > now - 2.5 * 3600 * 1000).sort((a, b) => startMs(a) - startMs(b));
    else if (f === 'jugados') list = state.matches.filter(finishedM).sort((a, b) => startMs(b) - startMs(a));
    else list = [...state.matches].sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0));

    const chip = (k, label) => `<button class="chip ${f === k ? 'active' : ''}" data-cal="${k}">${label}</button>`;
    const head = `
        <div class="section-head">
            <div><div class="section-title">Calendario</div>
            <div class="section-sub">Todos los partidos en orden · toca uno para ver pronósticos</div></div>
        </div>
        <div class="chips-row">${chip('prox', 'Próximos')}${chip('todos', 'Todos')}${chip('jugados', 'Jugados')}</div>`;

    if (!list.length) return head + `<div class="card empty-state"><div class="emoji">📅</div><h2>Nada por aquí</h2><p>No hay partidos en este filtro.</p></div>`;

    // agrupar por día
    const groups = [];
    let cur = null;
    list.forEach(m => {
        const k = dayKey(m.date);
        if (!cur || cur.key !== k) { cur = { key: k, label: dayLabel(m.date), items: [] }; groups.push(cur); }
        cur.items.push(m);
    });
    const body = groups.map(g => `
        <div class="day-group">
            <div class="day-head">${g.label}<span class="dh-line"></span><span class="dh-count">${g.items.length}</span></div>
            ${g.items.map(matchRow).join('')}
        </div>`).join('');
    return head + body;
}

function matchRow(m) {
    const fin = finishedM(m);
    const live = isLiveM(m);
    const hw = fin && m.home_goals > m.away_goals;
    const aw = fin && m.away_goals > m.home_goals;
    const tag = live ? '<span class="m-tag live">● Vivo</span>'
        : fin ? '<span class="m-tag ft">Final</span>'
        : m.locked ? '<span class="m-tag lock">Cerrado</span>' : '<span class="m-tag open">Abierto</span>';
    const end = (fin || live)
        ? `<div class="m-goal">${m.home_goals ?? 0} : ${m.away_goals ?? 0}</div>${tag}`
        : `<div class="m-time"><div class="t">${fmtTime(m.date)}</div></div>${tag}`;
    const mine = state.predictions[m.id];
    const minePick = (mine && mine.h != null && mine.a != null) ? `<div class="m-mypick">tú <b>${mine.h}-${mine.a}</b></div>` : '';
    return `
        <div class="match ${live ? 'is-live' : ''} ${fin ? 'is-ft' : ''}" role="button" onclick="openLive('${m.id}')">
            <div class="m-time"><div class="d">${m.group_name ? 'GR ' + m.group_name : (STAGE_SHORT[m.stage] || '')}</div><div class="t" style="font-size:.7rem">${fmtTime(m.date)}</div></div>
            <div class="m-teams">
                <div class="m-team ${hw ? 'win' : ''}"><img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="mt-nm">${m.home_team}</span></div>
                <div class="m-team ${aw ? 'win' : ''}"><img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="mt-nm">${m.away_team}</span></div>
            </div>
            <div class="m-end">${end}${minePick}</div>
        </div>`;
}

function bindCalFilters() {
    document.querySelectorAll('[data-cal]').forEach(b => {
        b.onclick = () => { state.calFilter = b.dataset.cal; renderHoy(); };
    });
}

/* ============================================================
   VISTA: LIVE (partido + pronósticos de todos)
   ============================================================ */
function openLive(matchId) { state.liveMatchId = matchId; switchView('live'); }

async function loadBoard(playerId) {
    if (state.boards[playerId]) return state.boards[playerId];
    try {
        const arr = await (await fetch(`/api/players/${playerId}/board`)).json();
        const map = {};
        arr.forEach(p => { map[p.match_id] = { h: p.home_score, a: p.away_score }; });
        state.boards[playerId] = map;
    } catch (e) { state.boards[playerId] = {}; }
    return state.boards[playerId];
}

async function renderLive() {
    const content = document.getElementById('content');
    // Elegir partido enfocado.
    let m = state.matches.find(x => x.id === state.liveMatchId);
    if (!m) m = liveMatches()[0] || nextMatch() || state.matches.filter(finishedM).sort((a, b) => startMs(b) - startMs(a))[0] || state.matches[0];
    if (!m) {
        content.innerHTML = `<div class="card empty-state"><div class="emoji">⚡</div><h2>Nada en vivo</h2><p>Cuando empiece un partido aparecerá acá con los pronósticos de todos.</p></div>`;
        return;
    }
    state.liveMatchId = m.id;

    // Selector de partidos (vivos + hoy + próximos).
    const live = liveMatches();
    const today = state.matches.filter(x => isToday(x.date) && !isLiveM(x));
    const upcoming = state.matches.filter(x => !finishedM(x) && !isLiveM(x) && !isToday(x.date)).sort((a, b) => startMs(a) - startMs(b)).slice(0, 6);
    const sel = [...live, ...today, ...upcoming];
    const seen = new Set();
    const chips = sel.filter(x => !seen.has(x.id) && seen.add(x.id)).map(x =>
        `<button class="chip ${x.id === m.id ? 'active' : ''}" onclick="openLive('${x.id}')">${isLiveM(x) ? '● ' : fmtTime(x.date) + ' '}${x.home_team.slice(0, 3).toUpperCase()}-${x.away_team.slice(0, 3).toUpperCase()}</button>`
    ).join('');

    const live0 = isLiveM(m) || finishedM(m);
    content.innerHTML = `
        <div class="section-head"><div><div class="section-title">Live</div>
        <div class="section-sub">El partido y cómo va la apuesta de cada uno</div></div></div>
        ${sel.length ? `<div class="chips-row">${chips}</div>` : ''}
        <div id="live-hero">${heroScore(m, isLiveM(m))}</div>
        <div id="live-board"></div>`;

    const board = document.getElementById('live-board');
    if (!m.locked) {
        board.innerHTML = `<div class="card empty-state"><div class="emoji">🔒</div><h2>Pronósticos ocultos</h2>
            <p>Se revelan cuando cierra el partido (1 min antes de empezar). Mientras, carga el tuyo.</p>
            <button class="btn-primary" style="max-width:240px;margin:14px auto 0;" onclick="switchView('mis')">Ir a mis pronósticos</button></div>`;
        return;
    }
    if (isLiveM(m)) await fillHeroPicks(m);
    await Promise.all(state.players.map(p => loadBoard(p.id)));
    const picks = state.players
        .map(p => { const pr = (state.boards[p.id] || {})[m.id]; return { p, pr, pts: pr ? predPoints(pr.h, pr.a, m) : null }; })
        .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
    const rows = picks.map(({ p, pr, pts }) => {
        const me = state.currentPlayer && p.id == state.currentPlayer.id;
        const val = pr ? `${pr.h}-${pr.a}` : '—';
        const badge = pts === null ? '' :
            pts === 3 ? '<span class="pts-badge p3">+3</span>' :
            pts === 1 ? '<span class="pts-badge p1">+1</span>' : '<span class="pts-badge p0">0</span>';
        return `<div class="pp-row ${me ? 'pp-me' : ''} ${pr ? '' : 'pp-empty'}">
            <span class="pp-name">${p.name}${me ? ' · tú' : ''}</span>
            <span class="pp-pick">${val}</span>${badge}</div>`;
    }).join('');
    board.innerHTML = `<div class="live-board"><div class="lvb-head">${finishedM(m) ? 'Resultado y aciertos' : 'Cómo va la apuesta'}</div>${rows || '<div class="card empty-state"><p>Nadie pronosticó este partido.</p></div>'}</div>`;
}

/* ============================================================
   VISTA: GRUPOS (posiciones + eliminatorias)
   ============================================================ */
async function renderGrupos() {
    const content = document.getElementById('content');
    const seg = (key, label) => `<button class="seg-btn ${state.bracketTab === key ? 'active' : ''}" onclick="setBracketTab('${key}')">${label}</button>`;
    content.innerHTML = `
        <div class="section-head"><div><div class="section-title">El Mundial</div>
        <div class="section-sub">Posiciones reales y cuadro de eliminatorias</div></div></div>
        <div class="seg">${seg('grupos', '📊 Posiciones')}${seg('llaves', '🏆 Eliminatorias')}</div>
        <div id="bracket-body"><div class="card" style="text-align:center;padding:2rem;color:var(--ink-soft);">Cargando…</div></div>`;
    if (state.standings === null) {
        try { state.standings = await (await fetch('/api/standings')).json(); }
        catch (e) { state.standings = []; }
    }
    renderBracketBody();
}
function setBracketTab(tab) {
    state.bracketTab = tab;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.seg-btn[onclick*="${tab}"]`);
    if (btn) btn.classList.add('active');
    renderBracketBody();
}
function renderBracketBody() {
    const body = document.getElementById('bracket-body');
    if (!body) return;
    body.innerHTML = state.bracketTab === 'llaves' ? renderKnockout() : renderStandings();
}
function renderStandings() {
    if (!state.standings || !state.standings.length) return '<div class="card empty-state"><div class="emoji">📊</div><h2>Sin posiciones</h2><p>Aparecen cuando arranca la fase de grupos.</p></div>';
    const tables = state.standings.map(grp => {
        const rows = grp.teams.map((t, i) => `
            <tr class="${i < 2 ? 'qualifies' : ''}">
                <td class="st-pos">${i + 1}</td>
                <td class="st-team"><img src="${logo(t.flag)}" onerror="this.src='${FALLBACK_FLAG}'"><span>${t.team}</span></td>
                <td>${t.mp}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
                <td>${t.gd > 0 ? '+' : ''}${t.gd}</td><td class="st-pts">${t.pts}</td>
            </tr>`).join('');
        return `<section class="group-card">
            <div class="group-head"><span class="group-tag">${grp.name}</span><span class="group-name">Grupo ${grp.name}</span></div>
            <table class="standings"><thead><tr><th></th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead>
            <tbody>${rows}</tbody></table></section>`;
    }).join('');
    return `<div class="groups-grid">${tables}</div>`;
}
function renderKnockout() {
    const stages = byStage();
    const blocks = KO_ROUNDS.filter(([k]) => (stages[k] || []).length).map(([key, label], i) => {
        const ms = [...stages[key]].sort(byMatchNumber);
        return `<section class="ko-round">
            <div class="ko-round-head"><span class="ko-round-num">${i + 1}</span>
            <div><h3 class="ko-round-title">${label}</h3><span class="ko-round-sub">${ms.length} ${ms.length === 1 ? 'partido' : 'partidos'}</span></div></div>
            <div class="ko-grid">${ms.map(koCard).join('')}</div></section>`;
    }).join('');
    return blocks || '<div class="card empty-state"><div class="emoji">🏟️</div><h2>Eliminatorias por definir</h2><p>El cuadro se llena cuando termine la fase de grupos.</p></div>';
}
function koCard(m) {
    const fin = finishedM(m);
    const hw = fin && m.home_goals > m.away_goals;
    const aw = fin && m.away_goals > m.home_goals;
    const myPred = state.predictions[m.id];
    const predTag = myPred && myPred.h != null && myPred.a != null ? `<div class="ko-pred">Tu pronóstico: <b>${myPred.h}-${myPred.a}</b></div>` : '';
    const status = fin ? '<span class="badge ft">Final</span>' : (isLiveM(m) ? '<span class="badge locked">En juego</span>' : '<span class="badge open">Próximo</span>');
    const teamRow = (name, lg, goals, win) => `
        <div class="ko-team ${win ? 'ko-win' : ''}">
            <img src="${logo(lg)}" onerror="this.src='${FALLBACK_FLAG}'">
            <span class="ko-name">${name}</span>
            <span class="ko-goal">${fin ? goals : ''}</span>
            ${win ? '<span class="ko-check">✓</span>' : ''}</div>`;
    return `<div class="ko-card ${fin ? 'is-final' : ''}">
        <div class="ko-meta"><span>${fmtDate(m.date)}</span>${status}</div>
        ${teamRow(m.home_team, m.home_logo, m.home_goals, hw)}
        ${teamRow(m.away_team, m.away_logo, m.away_goals, aw)}
        <div class="ko-foot">${m.stadium ? `📍 ${m.stadium}${m.city ? ' · ' + m.city : ''}` : ''}</div>${predTag}</div>`;
}

/* ============================================================
   VISTA: RANKING (tabla + resumen)
   ============================================================ */
function renderRanking() {
    if (state.detailId) return renderPlayerDetail(state.detailId);
    const content = document.getElementById('content');
    const seg = (key, label) => `<button class="seg-btn ${state.rankingTab === key ? 'active' : ''}" onclick="setRankingTab('${key}')">${label}</button>`;
    content.innerHTML = `
        ${renderAsadoPanel()}
        <div class="section-head"><div><div class="section-title">Ranking</div>
        <div class="section-sub">3 pts exacto · 1 pt resultado</div></div><span class="pill">${state.players.length} jugadores</span></div>
        <div class="seg">${seg('tabla', '🏆 Tabla')}${seg('resumen', '🧮 Resumen')}</div>
        <div id="rank-body"></div>`;
    renderRankBody();
}
function setRankingTab(tab) {
    state.rankingTab = tab;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.seg-btn[onclick*="${tab}"]`);
    if (btn) btn.classList.add('active');
    renderRankBody();
}
async function renderRankBody() {
    const body = document.getElementById('rank-body');
    if (!body) return;
    if (state.rankingTab === 'resumen') { body.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--ink-soft);">Cargando…</div>'; return renderSummary(body); }
    body.innerHTML = renderLeaderboard();
}
function renderLeaderboard() {
    const hasPrize = (state.settings.asado_total || 0) > 0;
    if (!state.players.length) return '<div class="card empty-state"><div class="emoji">🥅</div><h2>Sin jugadores</h2><p>¡Sé el primero en anotarte!</p></div>';
    return `<div class="leaderboard">${state.players.map((p, i) => {
        const me = state.currentPlayer?.id == p.id;
        const top = i < 3 ? `top${i + 1}` : '';
        const cost = !hasPrize ? '' : p.is_winner ? '<div class="lb-pay free">come gratis 🔥</div>' : `<div class="lb-pay">paga ${money(p.pays)}</div>`;
        return `<div class="lb-row ${top} ${me ? 'is-me' : ''}" style="animation-delay:${i * 0.04}s" role="button" onclick="openPlayer(${p.id})">
            <div class="lb-pos">${i + 1}</div>
            <div class="lb-id"><div class="lb-name">${p.name}${me ? ' <span class="badge open">tú</span>' : ''}</div>
            <div class="lb-detail">${p.exact_hits} exactos · ${p.partial_hits} parciales · ${p.pred_count || 0} jugadas</div></div>
            <div class="lb-end"><div class="lb-pts">${p.points}<small>PTS</small></div>${cost}</div>
            <div class="lb-go">›</div></div>`;
    }).join('')}</div>`;
}
async function renderSummary(body) {
    await Promise.all(state.players.map(p => loadBoard(p.id)));
    const finished = state.matches.filter(finishedM).sort((a, b) => startMs(a) - startMs(b));
    if (!finished.length || !state.players.length) {
        body.innerHTML = '<div class="card empty-state"><div class="emoji">🧮</div><h2>Aún sin datos</h2><p>El resumen aparece cuando haya partidos jugados.</p></div>';
        return;
    }
    const head = `<tr><th class="su-match">Partido</th><th>Real</th>${state.players.map(p => `<th>${p.name.slice(0, 6)}</th>`).join('')}</tr>`;
    const rows = finished.map(m => {
        const cells = state.players.map(p => {
            const pr = (state.boards[p.id] || {})[m.id];
            if (!pr) return '<td class="cell p0">·</td>';
            const pts = predPoints(pr.h, pr.a, m);
            return `<td class="cell p${pts}">${pr.h}-${pr.a}</td>`;
        }).join('');
        return `<tr><td class="su-match">${m.home_team.slice(0, 8)}–${m.away_team.slice(0, 8)}</td><td class="su-real">${m.home_goals}-${m.away_goals}</td>${cells}</tr>`;
    }).join('');
    const totals = `<tr class="su-total"><td class="su-match">Puntos</td><td></td>${state.players.map(p => `<td class="cell">${p.points}</td>`).join('')}</tr>`;
    body.innerHTML = `<div class="summary-wrap"><table class="summary"><thead>${head}</thead><tbody>${rows}${totals}</tbody></table></div>
        <div class="section-sub" style="margin-top:10px;text-align:center;">Verde = exacto (+3) · dorado = resultado (+1) · solo partidos cerrados</div>`;
}
function renderAsadoPanel() {
    const total = state.settings.asado_total || 0;
    const me = state.currentPlayer && state.players.find(p => p.id == state.currentPlayer.id);
    let mine = '';
    if (total > 0 && me) {
        mine = me.is_winner ? `<div class="asado-you win">Vas 1º · <b>comés gratis</b> 🏆🔥</div>`
            : `<div class="asado-you">Si terminara hoy, pagás <b>${money(me.pays)}</b></div>`;
    }
    const body = total > 0
        ? `<div class="asado-amount">${money(total)}</div><p class="asado-line">El <b>1º</b> no pone un peso. Los demás dividen el asado.</p>${mine}`
        : `<div class="asado-amount soft">Sin monto aún</div><p class="asado-line">El admin define cuánto sale el asado. <b>El que gana, come gratis.</b></p>`;
    return `<section class="asado-card"><div class="asado-embers"></div>
        <div class="asado-head"><span class="asado-ico">🔥🥩</span><div><div class="asado-kicker">El premio en juego</div><h2 class="asado-title">El Asado</h2></div></div>${body}</section>`;
}
function openPlayer(id) { state.detailId = id; state.view = 'ranking'; renderPlayerDetail(id); }
function closePlayer() { state.detailId = null; renderRanking(); }
async function renderPlayerDetail(id) {
    const content = document.getElementById('content');
    const player = state.players.find(p => p.id == id);
    if (!player) { state.detailId = null; return renderRanking(); }
    content.innerHTML = `
        <div class="section-head"><button class="btn-ghost back-btn" onclick="closePlayer()">‹ Ranking</button>
        <div style="flex:1;min-width:0;"><div class="section-title">${player.name}</div>
        <div class="section-sub">${player.points} pts · ${player.exact_hits} exactos · ${player.partial_hits} parciales</div></div></div>
        <div id="detail-body"><div class="card" style="text-align:center;padding:2rem;color:var(--ink-soft);">Cargando…</div></div>`;
    await Promise.all(state.players.map(p => loadBoard(p.id)));
    const body = document.getElementById('detail-body');
    if (!body) return;
    const revealed = state.matches.filter(m => m.locked).sort((a, b) => startMs(b) - startMs(a));
    if (!revealed.length) { body.innerHTML = '<div class="card empty-state"><div class="emoji">🔒</div><h2>Aún nada que ver</h2><p>Los pronósticos se revelan cuando cada partido cierra.</p></div>'; return; }
    body.innerHTML = revealed.map(m => detailRow(m, id)).join('');
}
function detailRow(m, focusId) {
    const fin = finishedM(m);
    const real = fin ? `${m.home_goals} : ${m.away_goals}` : 'en juego';
    const picks = state.players.map(p => {
        const pr = (state.boards[p.id] || {})[m.id];
        return { p, pr, pts: pr ? predPoints(pr.h, pr.a, m) : null };
    }).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
    const list = picks.map(({ p, pr, pts }) => {
        const sel = p.id == focusId;
        const val = pr ? `${pr.h}-${pr.a}` : '—';
        const badge = pts === null ? '' : pts === 3 ? '<span class="pts-badge p3">+3</span>' : pts === 1 ? '<span class="pts-badge p1">+1</span>' : '<span class="pts-badge p0">0</span>';
        return `<div class="pp-row ${sel ? 'pp-me' : ''} ${pr ? '' : 'pp-empty'}"><span class="pp-name">${p.name}</span><span class="pp-pick">${val}</span>${badge}</div>`;
    }).join('');
    return `<div class="fixture"><div class="fx-meta"><span>${fmtDate(m.date)}</span>${m.city ? `<span class="fx-venue">📍 ${m.city}</span>` : ''}<span style="margin-left:auto;color:var(--volt);font-family:var(--font-mono)">real ${real}</span></div>
        <div class="fx-grid">
            <div class="fx-team"><img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span>${m.home_team}</span></div>
            <div class="final">${fin ? `${m.home_goals}-${m.away_goals}` : '·'}</div>
            <div class="fx-team away"><span>${m.away_team}</span><img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'"></div>
        </div><div class="live-board" style="margin-top:10px;">${list}</div></div>`;
}

/* ============================================================
   VISTA: MIS PRONÓSTICOS (chips 0-5, cronológico)
   ============================================================ */
function renderMis() {
    const content = document.getElementById('content');
    if (!state.currentPlayer) { content.innerHTML = renderAuth(); return; }

    const now = Date.now();
    const f = state.misFilter;
    let list = [...state.matches].sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0));
    if (f === 'prox') list = list.filter(m => !m.locked && (startMs(m) || 0) > now - 60000);

    const open = list.filter(m => !m.locked);
    const closed = (f === 'todos') ? list.filter(m => m.locked) : [];

    const chip = (k, label) => `<button class="chip ${f === k ? 'active' : ''}" onclick="setMisFilter('${k}')">${label}</button>`;
    const cards = open.length ? open.map(predCard).join('')
        : '<div class="card empty-state"><div class="emoji">✅</div><h2>Todo pronosticado</h2><p>No quedan partidos abiertos. ¡A esperar los goles!</p></div>';
    const closedBlock = closed.length ? `<div class="day-head" style="margin-top:18px;">Cerrados<span class="dh-line"></span><span class="dh-count">${closed.length}</span></div>${closed.map(closedCard).join('')}` : '';

    content.innerHTML = `
        <div class="section-head"><div><div class="section-title">Mis pronósticos</div>
        <div class="section-sub">Toca el marcador de cada equipo · se guarda solo</div></div><span class="pill">${open.length} abiertos</span></div>
        <div class="chips-row">${chip('prox', 'Por jugar')}${chip('todos', 'Todos')}</div>
        ${cards}${closedBlock}`;
}
function setMisFilter(k) { state.misFilter = k; renderMis(); }

function chipRow(matchId, side, current) {
    const opts = [0, 1, 2, 3, 4, 5];
    const chips = opts.map(v => `<button class="sc-chip ${current === v ? 'sel' : ''}" onclick="setScore('${matchId}','${side}',${v},this)">${v}</button>`).join('');
    const moreSel = current != null && current > 5;
    const more = `<button class="sc-chip more ${moreSel ? 'sel' : ''}" onclick="setScoreMore('${matchId}','${side}',this)">${moreSel ? current : '+'}</button>`;
    return `<div class="score-chips">${chips}${more}</div>`;
}
function predCard(m) {
    const pr = state.predictions[m.id] || {};
    const both = pr.h != null && pr.a != null;
    return `
        <div class="pred-card" id="pc-${m.id}">
            <div class="pred-head"><span class="ph-when">${dayLabel(m.date)} ${fmtTime(m.date)}</span>
                <span>· ${m.group_name ? 'Grupo ' + m.group_name : (STAGE_SHORT[m.stage] || '')}</span>
                <span class="ph-tag m-tag open">Abierto</span></div>
            <div class="pred-team-row">
                <div class="pred-team"><img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="pt-nm">${m.home_team}</span></div>
                ${chipRow(m.id, 'h', pr.h)}
            </div>
            <div class="pred-team-row">
                <div class="pred-team"><img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="pt-nm">${m.away_team}</span></div>
                ${chipRow(m.id, 'a', pr.a)}
            </div>
            <div class="pred-saved ${both ? '' : 'dim'}" id="saved-${m.id}">${both ? `Tu pronóstico: ${pr.h}-${pr.a} ✓` : 'Elige ambos marcadores'}</div>
        </div>`;
}
function closedCard(m) {
    const pr = state.predictions[m.id];
    const fin = finishedM(m);
    const mine = pr && pr.h != null ? `${pr.h}-${pr.a}` : 'sin jugar';
    const pts = (pr && fin) ? predPoints(pr.h, pr.a, m) : null;
    const badge = pts === null ? '' : pts === 3 ? '<span class="pts-badge p3">+3</span>' : pts === 1 ? '<span class="pts-badge p1">+1</span>' : '<span class="pts-badge p0">0</span>';
    return `<div class="match is-ft">
        <div class="m-time"><div class="d">${fmtTime(m.date)}</div></div>
        <div class="m-teams"><div class="m-team"><img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="mt-nm">${m.home_team}</span></div>
        <div class="m-team"><img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span class="mt-nm">${m.away_team}</span></div></div>
        <div class="m-end"><div class="m-goal">${fin ? `${m.home_goals}:${m.away_goals}` : '–'}</div><div class="m-mypick">tú <b>${mine}</b> ${badge}</div></div></div>`;
}

function setScoreMore(matchId, side, el) {
    const v = prompt('Marcador (número de goles):');
    if (v === null) return;
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0 || n > 30) return toast('Número inválido', false);
    // marcar visualmente
    const row = el.parentElement;
    row.querySelectorAll('.sc-chip').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel'); el.textContent = n;
    applyScore(matchId, side, n);
}
function setScore(matchId, side, value, el) {
    const row = el.parentElement;
    row.querySelectorAll('.sc-chip').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
    const more = row.querySelector('.sc-chip.more');
    if (more) more.textContent = '+';
    applyScore(matchId, side, value);
}
async function applyScore(matchId, side, value) {
    if (!state.currentPlayer || !state.pin) { toast('Inicia sesión primero', false); return; }
    if (!state.predictions[matchId]) state.predictions[matchId] = { h: null, a: null };
    state.predictions[matchId][side === 'h' ? 'h' : 'a'] = value;
    const pred = state.predictions[matchId];
    const savedEl = document.getElementById(`saved-${matchId}`);
    if (pred.h == null || pred.a == null) {
        if (savedEl) { savedEl.textContent = 'Elige ambos marcadores'; savedEl.classList.add('dim'); }
        return;
    }
    if (savedEl) { savedEl.textContent = 'Guardando…'; savedEl.classList.add('dim'); }
    try {
        const res = await fetch('/api/predictions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: state.currentPlayer.id, pin: state.pin, match_id: matchId, home_score: pred.h, away_score: pred.a })
        });
        if (res.ok) {
            if (savedEl) { savedEl.textContent = `Tu pronóstico: ${pred.h}-${pred.a} ✓`; savedEl.classList.remove('dim'); }
            toast('Guardado ✓');
            refreshData(false);
        } else {
            const e = await res.json();
            if (savedEl) { savedEl.textContent = e.detail || 'No se pudo guardar'; }
            toast(e.detail || 'No se pudo guardar', false);
        }
    } catch (e) { toast('Error de conexión', false); }
}

/* ============================================================
   AUTH
   ============================================================ */
function renderAuth() {
    return `<div class="auth-wrap"><div class="auth-card">
        <div class="auth-title">Entrar al juego</div>
        <p class="section-sub" style="margin-top:.3rem;">Tu PIN de 4 dígitos protege tus pronósticos.</p>
        <label class="field-label">Nombre</label>
        <input id="auth-name" class="field" type="text" placeholder="Tu nombre" autocomplete="off">
        <label class="field-label">PIN (4 dígitos)</label>
        <input id="auth-pin" class="field" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
        <button onclick="doRegister()" class="btn-primary">Registrarme</button>
        <button onclick="doLogin()" class="btn-ghost" style="width:100%;margin-top:.6rem;">Ya estoy anotado, iniciar sesión</button>
    </div></div>`;
}
function authInputs() {
    return { name: document.getElementById('auth-name').value.trim(), pin: document.getElementById('auth-pin').value.trim() };
}
async function doRegister() {
    const { name, pin } = authInputs();
    if (!name || !/^\d{4}$/.test(pin)) return toast('Nombre y PIN de 4 dígitos requeridos', false);
    await authRequest('/api/players', { name, pin }, 'No se pudo registrar');
}
async function doLogin() {
    const { name, pin } = authInputs();
    if (!name || !pin) return toast('Ingresa nombre y PIN', false);
    await authRequest('/api/login', { name, pin }, 'No se pudo iniciar sesión');
}
async function authRequest(url, body, errMsg) {
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('prode_player_id', data.id);
            sessionStorage.setItem('prode_pin', body.pin);
            location.reload();
        } else toast(data.detail || errMsg, false);
    } catch (e) { toast('Error de conexión', false); }
}
function logout() {
    localStorage.removeItem('prode_player_id');
    sessionStorage.removeItem('prode_pin');
    location.reload();
}

/* ============================================================
   ADMIN
   ============================================================ */
function renderAdmin() {
    const content = document.getElementById('content');
    if (!state.adminKey) {
        content.innerHTML = `<div class="auth-wrap"><div class="auth-card">
            <div class="auth-title">🔐 Admin</div>
            <p class="section-sub" style="margin-top:.3rem;">Clave para cargar resultados y gestionar el juego.</p>
            <label class="field-label">Clave de administrador</label>
            <input id="admin-key" class="field" type="password" placeholder="••••••••">
            <button onclick="enterAdmin()" class="btn-primary">Entrar</button>
        </div></div>`;
        return;
    }
    const cards = fixtureSectionsAdmin();
    const inactivos = state.players.filter(p => (p.pred_count || 0) === 0).length;
    const playerRows = state.players.length === 0
        ? '<p style="color:var(--ink-soft);font-size:.85rem;">Aún no hay jugadores.</p>'
        : state.players.map(p => `<div class="adm-player ${(p.pred_count || 0) === 0 ? 'inactive' : ''}">
            <div class="avatar">${p.name[0].toUpperCase()}</div>
            <div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:.9rem;">${p.name}</div>
            <div style="font-size:.68rem;color:var(--ink-soft);font-weight:600;">${p.pred_count || 0} jugadas · ${p.points} pts${(p.pred_count || 0) === 0 ? ' · sin jugar' : ''}</div></div>
            <button class="del-btn" onclick="deletePlayer(${p.id}, '${esc(p.name)}')">🗑</button></div>`).join('');

    content.innerHTML = `
        <div class="section-head"><div><div class="section-title">Admin</div><div class="section-sub">Jugadores, premio y resultados</div></div>
        <button class="btn-ghost" onclick="exitAdmin()">Salir</button></div>
        <div class="card" style="margin-bottom:18px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;">
                <h3 style="font-family:var(--font-display);font-size:1.1rem;">Jugadores (${state.players.length})</h3>
                <button class="btn-ghost" ${inactivos === 0 ? 'disabled style="opacity:.5;"' : ''} onclick="cleanupInactive()">🧹 Eliminar inactivos${inactivos ? ` (${inactivos})` : ''}</button>
            </div>
            <div class="adm-players">${playerRows}</div>
        </div>
        <div class="asado-admin" style="margin-bottom:18px;">
            <h3 style="font-family:var(--font-display);font-size:1.1rem;margin-bottom:.3rem;">🔥 El premio (asado)</h3>
            <p class="section-sub" style="margin-bottom:1rem;">El 1º no paga; el resto divide el total.</p>
            <div class="asado-admin-row">
                <div><label class="field-label">Moneda</label><input id="asado-currency" class="field" type="text" maxlength="4" value="${state.settings.currency || '$'}" style="text-align:center;"></div>
                <div style="flex:1;"><label class="field-label">Monto total</label><input id="asado-total" class="field" type="number" min="0" step="1000" placeholder="30000" value="${state.settings.asado_total || ''}"></div>
            </div>
            <button onclick="saveAsado()" class="btn-primary" style="margin-top:.8rem;">Guardar premio</button>
        </div>
        <h3 style="font-family:var(--font-display);font-size:1.1rem;margin-bottom:1rem;">Cargar resultados</h3>
        ${cards}`;
}

// Fixture para admin: cronológico por día (no por grupo), con inputs.
function fixtureSectionsAdmin() {
    const list = [...state.matches].sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0));
    const groups = [];
    let cur = null;
    list.forEach(m => { const k = dayKey(m.date); if (!cur || cur.key !== k) { cur = { key: k, label: dayLabel(m.date), items: [] }; groups.push(cur); } cur.items.push(m); });
    return groups.map(g => `<div class="day-group"><div class="day-head">${g.label}<span class="dh-line"></span><span class="dh-count">${g.items.length}</span></div>${g.items.map(adminFixture).join('')}</div>`).join('');
}
function adminFixture(m) {
    return `<div class="fixture">
        <div class="fx-meta"><span>${fmtTime(m.date)}</span><span>${m.group_name ? 'Gr ' + m.group_name : (STAGE_SHORT[m.stage] || '')}</span>
        <button class="btn-ghost" style="margin-left:auto;padding:5px 12px;" onclick="saveResult('${m.id}')">Guardar</button></div>
        <div class="fx-grid">
            <div class="fx-team"><img src="${logo(m.home_logo)}" onerror="this.src='${FALLBACK_FLAG}'"><span>${m.home_team}</span></div>
            <div class="fx-score"><input class="goal" id="adm-${m.id}-h" type="number" min="0" max="20" placeholder="-" value="${m.home_goals ?? ''}"><span class="sep">:</span><input class="goal" id="adm-${m.id}-a" type="number" min="0" max="20" placeholder="-" value="${m.away_goals ?? ''}"></div>
            <div class="fx-team away"><span>${m.away_team}</span><img src="${logo(m.away_logo)}" onerror="this.src='${FALLBACK_FLAG}'"></div>
        </div></div>`;
}
function enterAdmin() {
    const key = document.getElementById('admin-key').value.trim();
    if (!key) return;
    state.adminKey = key; sessionStorage.setItem('prode_admin', key); renderAdmin();
}
function exitAdmin() { state.adminKey = null; sessionStorage.removeItem('prode_admin'); renderAdmin(); }
async function saveAsado() {
    const total = parseFloat(document.getElementById('asado-total').value) || 0;
    const currency = document.getElementById('asado-currency').value.trim() || '$';
    try {
        const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_key: state.adminKey, asado_total: total, currency }) });
        const data = await res.json();
        if (res.ok) { state.settings = { asado_total: total, currency }; await refreshPlayersQuiet(); toast('Premio actualizado 🔥'); }
        else { if (res.status === 403) exitAdmin(); toast(data.detail || 'No se pudo guardar', false); }
    } catch (e) { toast('Error de conexión', false); }
}
async function deletePlayer(id, name) {
    if (!confirm(`¿Eliminar a "${name}" y todas sus jugadas?`)) return;
    try {
        const res = await fetch(`/api/players/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_key: state.adminKey }) });
        const data = await res.json();
        if (res.ok) { await refreshPlayersQuiet(); toast(`"${name}" eliminado`); renderAdmin(); }
        else { if (res.status === 403) exitAdmin(); toast(data.detail || 'No se pudo eliminar', false); }
    } catch (e) { toast('Error de conexión', false); }
}
async function cleanupInactive() {
    if (!confirm('¿Eliminar a los jugadores que se registraron pero no jugaron?')) return;
    try {
        const res = await fetch('/api/players/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_key: state.adminKey }) });
        const data = await res.json();
        if (res.ok) { await refreshPlayersQuiet(); toast(`${data.deleted} inactivo(s) eliminado(s)`); renderAdmin(); }
        else { if (res.status === 403) exitAdmin(); toast(data.detail || 'Error', false); }
    } catch (e) { toast('Error de conexión', false); }
}
async function saveResult(matchId) {
    const h = document.getElementById(`adm-${matchId}-h`).value;
    const a = document.getElementById(`adm-${matchId}-a`).value;
    if (h === '' || a === '') return toast('Completa ambos marcadores', false);
    try {
        const res = await fetch(`/api/matches/${matchId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ home_goals: parseInt(h), away_goals: parseInt(a), admin_key: state.adminKey }) });
        const data = await res.json();
        if (res.ok) {
            const m = state.matches.find(x => x.id === matchId);
            if (m) { m.home_goals = parseInt(h); m.away_goals = parseInt(a); m.status = 'FT'; }
            await refreshPlayersQuiet();
            toast('Resultado guardado ✓');
        } else { if (res.status === 403) exitAdmin(); toast(data.detail || 'Error al guardar', false); }
    } catch (e) { toast('Error de conexión', false); }
}
async function refreshPlayersQuiet() {
    try {
        const [pl, st] = await Promise.all([
            fetch('/api/players').then(r => r.json()),
            fetch('/api/settings').then(r => r.json()).catch(() => state.settings)
        ]);
        state.players = pl; state.settings = st; state.boards = {};
        if (state.currentPlayer) { const me = pl.find(p => p.id == state.currentPlayer.id); if (me) state.currentPlayer = me; }
    } catch (e) { /* nada */ }
}

init();
