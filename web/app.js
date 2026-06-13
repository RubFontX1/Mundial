let state = {
    players: [],
    matches: [],
    currentPlayer: null,
    pin: sessionStorage.getItem('prode_pin') || null,
    adminKey: sessionStorage.getItem('prode_admin') || null,
    predictions: {},
    view: 'llaves',
    standings: null,
    bracketTab: 'grupos',   // sub-vista de "El Mundial": 'grupos' | 'llaves'
    fixtureStage: 'group',  // fase mostrada en "Mis jugadas"
    detailId: null,         // jugador abierto desde el ranking
    boards: {}              // cache de pronósticos por jugador (solo partidos cerrados)
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Fases del torneo en orden, con su etiqueta para los encabezados.
const STAGES = [
    ['group', 'Fase de grupos'],
    ['r32', '16avos de final'],
    ['r16', 'Octavos de final'],
    ['qf', 'Cuartos de final'],
    ['sf', 'Semifinales'],
    ['third', 'Tercer puesto'],
    ['final', 'Final']
];

function fmtDate(s) {
    if (!s) return '';
    // Las fechas llegan en UTC ISO ('2026-06-11T19:00:00Z'); Date las convierte
    // automáticamente a la hora local del navegador de cada usuario.
    const d = new Date(s);
    if (!isNaN(d.getTime()) && /[TZ]/.test(s)) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}`;
    }
    // Respaldo para formatos antiguos sin zona.
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return s.slice(0, 16);
    return `${parseInt(m[3])} ${MONTHS[parseInt(m[2]) - 1]} · ${m[4]}:${m[5]}`;
}

async function init() {
    try {
        const [resPlayers, resMatches] = await Promise.all([
            fetch('/api/players'),
            fetch('/api/matches')
        ]);
        state.players = await resPlayers.json();
        state.matches = await resMatches.json();
    } catch (e) {
        renderSession();
        document.getElementById('content').innerHTML = `
            <div class="card empty-state">
                <div class="emoji">⚠️</div>
                <h2>No se pudo conectar</h2>
                <p>Abre la app desde <b>http://localhost:8000/static/index.html</b> con el
                servidor (<code>python main.py</code>) en marcha. No abras el archivo directamente.</p>
            </div>`;
        return;
    }

    const savedId = localStorage.getItem('prode_player_id');
    if (savedId) {
        state.currentPlayer = state.players.find(p => p.id == savedId) || null;
        if (state.currentPlayer) await loadPredictions();
    }

    renderSession();
    switchView(state.view);
}

async function loadPredictions() {
    state.predictions = {};
    const res = await fetch(`/api/predictions/${state.currentPlayer.id}`);
    const preds = await res.json();
    preds.forEach(p => {
        state.predictions[p.match_id] = { h: p.home_score, a: p.away_score };
    });
}

function switchView(view) {
    state.view = view;
    if (view !== 'ranking') state.detailId = null;  // salir del detalle de jugador
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-view="${view}"]`);
    if (btn) btn.classList.add('active');

    if (view === 'ranking') renderRanking();
    if (view === 'pronosticos') renderPronosticos();
    if (view === 'llaves') renderBracket();
    if (view === 'admin') renderAdmin();
}

// Puntos de un pronóstico vs el resultado real (null si el partido no terminó)
function predPoints(ph, pa, m) {
    if (m.home_goals === null || m.away_goals === null) return null;
    if (ph === m.home_goals && pa === m.away_goals) return 3;
    const sign = x => x > 0 ? 1 : x < 0 ? -1 : 0;
    return sign(ph - pa) === sign(m.home_goals - m.away_goals) ? 1 : 0;
}

function toast(msg, ok = true) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = ok ? 'toast-ok' : 'toast-err';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Sesión en el header ----------
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
                    <div class="session-meta">Sesión activa</div>
                </div>
                <button class="logout-btn" title="Cerrar sesión" onclick="logout()">⎋</button>
            </div>`;
    } else {
        slot.innerHTML = `<button class="header-cta" onclick="switchView('pronosticos')">Anotarme</button>`;
    }
}

// ---------- Ranking ----------
function renderRanking() {
    // Si hay un jugador abierto, mostramos su detalle en vez de la tabla.
    if (state.detailId) return renderPlayerDetail(state.detailId);

    const content = document.getElementById('content');
    const rows = state.players.length === 0
        ? '<div class="card empty-state"><div class="emoji">🥅</div><h2>Sin jugadores</h2><p>¡Sé el primero en anotarte y abrir la tabla!</p></div>'
        : `<div class="leaderboard">${state.players.map((p, i) => {
            const me = state.currentPlayer?.id == p.id;
            const top = i < 3 ? `top${i + 1}` : '';
            return `
            <div class="lb-row ${top} ${me ? 'is-me' : ''}" style="animation-delay:${i * 0.04}s"
                 role="button" tabindex="0" onclick="openPlayer(${p.id})" title="Ver pronósticos de ${p.name}">
                <div class="lb-pos">${i + 1}</div>
                <div>
                    <div class="lb-name">${p.name}${me ? ' <span class="badge open">tú</span>' : ''}</div>
                    <div class="lb-detail">${p.exact_hits} exactos · ${p.partial_hits} parciales</div>
                </div>
                <div class="lb-pts">${p.points}<small>PTS</small></div>
                <div class="lb-go" aria-hidden="true">›</div>
            </div>`;
        }).join('')}</div>`;

    content.innerHTML = `
        <div class="section-head">
            <div>
                <div class="section-title">Tabla de posiciones</div>
                <div class="section-sub">Toca a un jugador para ver sus pronósticos · 3 pts exacto · 1 pt resultado</div>
            </div>
            <span class="pill">${state.players.length} jugadores</span>
        </div>
        ${rows}`;
}

// ---------- Detalle de jugador (pronósticos + comparación) ----------
function openPlayer(id) {
    state.detailId = id;
    state.view = 'ranking';
    renderPlayerDetail(id);
}

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

async function renderPlayerDetail(id) {
    const content = document.getElementById('content');
    const player = state.players.find(p => p.id == id);
    if (!player) { state.detailId = null; return renderRanking(); }

    content.innerHTML = `
        <div class="section-head">
            <button class="btn-ghost back-btn" onclick="closePlayer()">‹ Ranking</button>
            <div style="flex:1; min-width:0;">
                <div class="section-title">${player.name}</div>
                <div class="section-sub">${player.points} pts · ${player.exact_hits} exactos · ${player.partial_hits} parciales</div>
            </div>
        </div>
        <div id="detail-body"><div class="card" style="text-align:center; padding:2rem; color:var(--ink-soft);">Cargando pronósticos…</div></div>`;

    // Cargamos las boletas de todos para poder comparar por partido.
    await Promise.all(state.players.map(p => loadBoard(p.id)));

    const body = document.getElementById('detail-body');
    if (!body) return;
    const revealed = state.matches.filter(m => m.locked);
    if (!revealed.length) {
        body.innerHTML = '<div class="card empty-state"><div class="emoji">🔒</div><h2>Aún nada que ver</h2><p>Los pronósticos se revelan cuando cada partido cierra (1 min antes de empezar).</p></div>';
        return;
    }
    body.innerHTML = fixtureSections(m => detailRow(m, id), revealed);
}

function closePlayer() {
    state.detailId = null;
    renderRanking();
}

// Tarjeta de un partido en el detalle: resultado real + lo que puso cada jugador.
function detailRow(m, focusId) {
    const finished = m.home_goals !== null && m.away_goals !== null;
    const real = finished ? `${m.home_goals} : ${m.away_goals}` : 'en juego';
    const picks = [...state.players]
        .map(p => {
            const pr = (state.boards[p.id] || {})[m.id];
            const pts = pr ? predPoints(pr.h, pr.a, m) : null;
            return { p, pr, pts };
        })
        .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));

    const list = picks.map(({ p, pr, pts }) => {
        const sel = p.id == focusId;
        const val = pr ? `${pr.h}-${pr.a}` : '—';
        const badge = pts === null ? '' :
            pts === 3 ? '<span class="pts-badge p3">+3</span>' :
            pts === 1 ? '<span class="pts-badge p1">+1</span>' :
            '<span class="pts-badge p0">0</span>';
        return `
            <div class="pp-row ${sel ? 'pp-me' : ''} ${pr ? '' : 'pp-empty'}">
                <span class="pp-name">${p.name}${sel ? ' ·' : ''}</span>
                <span class="pp-pick">${val}</span>
                ${badge}
            </div>`;
    }).join('');

    return `
        <div class="fixture detail-fix">
            <div class="fx-meta"><span>${fmtDate(m.date)}</span>${m.city ? `<span class="fx-venue">📍 ${m.city}</span>` : ''}<span class="cmp-real">real ${real}</span></div>
            <div class="fx-grid">
                <div class="fx-team">
                    <img src="${m.home_logo || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
                    <span>${m.home_team}</span>
                </div>
                <div class="cmp-mid"><span class="cmp-pred">${finished ? `${m.home_goals}-${m.away_goals}` : '·'}</span></div>
                <div class="fx-team away">
                    <img src="${m.away_logo || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
                    <span>${m.away_team}</span>
                </div>
            </div>
            <div class="pp-list">${list}</div>
        </div>`;
}

// ---------- Pronósticos (agrupado por fase) ----------
function renderPronosticos() {
    const content = document.getElementById('content');
    if (!state.currentPlayer) {
        content.innerHTML = renderAuth();
        return;
    }

    const stages = byStage();
    const available = STAGES.filter(([k]) => (stages[k] || []).length);
    if (!available.some(([k]) => k === state.fixtureStage)) {
        state.fixtureStage = available[0] ? available[0][0] : 'group';
    }
    const chips = available.map(([k, label]) =>
        `<button class="chip ${k === state.fixtureStage ? 'active' : ''}" onclick="setFixtureStage('${k}')">${STAGE_SHORT[k] || label} <b>${stages[k].length}</b></button>`
    ).join('');

    content.innerHTML = `
        <div class="section-head">
            <div>
                <div class="section-title">Mis jugadas</div>
                <div class="section-sub">Se guardan solas al cargar ambos goles · cierran 1 min antes · horarios en tu hora local</div>
            </div>
            <span class="pill">${state.matches.length} partidos</span>
        </div>
        <div class="chips-row chips-scroll">${chips}</div>
        <div id="fixture-body"></div>`;
    renderFixtureBody();
}

// Etiquetas cortas por fase para los chips del selector.
const STAGE_SHORT = {
    group: 'Grupos', r32: '16avos', r16: 'Octavos', qf: 'Cuartos',
    sf: 'Semis', third: '3er puesto', final: 'Final'
};

function setFixtureStage(key) {
    state.fixtureStage = key;
    document.querySelectorAll('.chips-row .chip').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.chips-row .chip[onclick*="'${key}'"]`);
    if (btn) btn.classList.add('active');
    renderFixtureBody();
}

// Renderiza SOLO la fase seleccionada para no saturar de scroll vertical.
function renderFixtureBody() {
    const body = document.getElementById('fixture-body');
    if (!body) return;
    const stages = byStage();
    const key = state.fixtureStage;
    const ms = stages[key] || [];

    if (key === 'group') {
        const groups = {};
        ms.forEach(m => { const g = m.group_name || '?'; (groups[g] = groups[g] || []).push(m); });
        body.innerHTML = `<div class="groups-grid">${Object.keys(groups).sort().map(g => `
            <section class="group-card">
                <div class="group-head">
                    <span class="group-tag">${g}</span>
                    <span class="group-name">Grupo ${g}</span>
                    <span class="group-count">${groups[g].length} partidos</span>
                </div>
                ${groups[g].map(m => fixture(m, false)).join('')}
            </section>`).join('')}</div>`;
    } else {
        // Eliminatorias: una tarjeta compacta por partido en grilla densa.
        body.innerHTML = `<div class="fixture-grid">${[...ms].sort(byMatchNumber).map(m =>
            `<section class="group-card ko-fix">${fixture(m, false)}</section>`).join('')}</div>`;
    }
}

// Índice de partidos por fase (stage).
function byStage(matches = state.matches) {
    const map = {};
    matches.forEach(m => {
        const s = m.stage || 'group';
        (map[s] = map[s] || []).push(m);
    });
    return map;
}

// Construye las secciones del fixture por fase. `renderItem(m)` devuelve el HTML
// de un partido. La fase de grupos se subdivide por grupo (A..L); el resto va
// en una sola tarjeta por fase.
function fixtureSections(renderItem, matches = state.matches) {
    const stages = byStage(matches);
    return STAGES.filter(([k]) => (stages[k] || []).length).map(([key, label], si) => {
        const ms = stages[key];
        let inner;
        if (key === 'group') {
            const groups = {};
            ms.forEach(m => { const g = m.group_name || '?'; (groups[g] = groups[g] || []).push(m); });
            inner = Object.keys(groups).sort().map(g => `
                <section class="group-card">
                    <div class="group-head">
                        <span class="group-tag">${g}</span>
                        <span class="group-name">Grupo ${g}</span>
                        <span class="group-count">${groups[g].length} partidos</span>
                    </div>
                    ${groups[g].map(renderItem).join('')}
                </section>`).join('');
        } else {
            inner = `<section class="group-card">${ms.map(renderItem).join('')}</section>`;
        }
        return `
            <div class="phase-block" style="animation-delay:${si * 0.04}s">
                <div class="phase-head"><span class="phase-label">${label}</span><span class="phase-count">${ms.length}</span></div>
                <div class="groups-grid">${inner}</div>
            </div>`;
    }).join('');
}

function fixture(m, admin) {
    const pred = state.predictions[m.id] || { h: '', a: '' };
    const finished = m.home_goals !== null && m.away_goals !== null;
    const badge = finished
        ? `<span class="badge ft">Final</span>`
        : m.locked ? `<span class="badge locked">Cerrado</span>` : `<span class="badge open">Abierto</span>`;

    const center = admin
        ? `<div class="fx-score">
               <input class="goal" id="adm-${m.id}-h" type="number" min="0" max="20" placeholder="-" value="${m.home_goals ?? ''}">
               <span class="sep">:</span>
               <input class="goal" id="adm-${m.id}-a" type="number" min="0" max="20" placeholder="-" value="${m.away_goals ?? ''}">
           </div>`
        : finished
            ? `<div class="fx-score"><span class="final">${m.home_goals} : ${m.away_goals}</span></div>`
            : `<div class="fx-score">
                   <input class="goal" type="number" min="0" max="20" placeholder="-" value="${pred.h ?? ''}" ${m.locked ? 'disabled' : ''} onchange="savePrediction('${m.id}','h',this.value)">
                   <span class="sep">:</span>
                   <input class="goal" type="number" min="0" max="20" placeholder="-" value="${pred.a ?? ''}" ${m.locked ? 'disabled' : ''} onchange="savePrediction('${m.id}','a',this.value)">
               </div>`;

    const venue = m.stadium ? `<span class="fx-venue" title="${m.stadium}${m.city ? ' · ' + m.city : ''}">📍 ${m.city || m.stadium}</span>` : '';
    return `
        <div class="fixture ${m.locked && !admin ? 'locked' : ''}">
            <div class="fx-meta"><span>${fmtDate(m.date)}</span>${venue}${badge}
                ${admin ? `<button class="btn-ghost" style="margin-left:auto; padding:5px 12px;" onclick="saveResult('${m.id}')">Guardar</button>` : ''}
            </div>
            <div class="fx-grid">
                <div class="fx-team">
                    <img src="${m.home_logo || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
                    <span>${m.home_team}</span>
                </div>
                ${center}
                <div class="fx-team away">
                    <img src="${m.away_logo || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
                    <span>${m.away_team}</span>
                </div>
            </div>
        </div>`;
}

async function savePrediction(matchId, type, value) {
    if (!state.currentPlayer || !state.pin) return;
    if (!state.predictions[matchId]) state.predictions[matchId] = { h: null, a: null };
    state.predictions[matchId][type] = value === '' ? null : parseInt(value);
    const pred = state.predictions[matchId];
    if (pred.h === null || pred.a === null) return;

    try {
        const res = await fetch('/api/predictions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player_id: state.currentPlayer.id, pin: state.pin,
                match_id: matchId, home_score: pred.h, away_score: pred.a
            })
        });
        if (res.ok) toast('Guardado ✓');
        else { const e = await res.json(); toast(e.detail || 'No se pudo guardar', false); }
    } catch (e) { toast('Error de conexión', false); }
}

// ---------- El Mundial: posiciones de grupos + eliminatorias ----------
async function renderBracket() {
    const content = document.getElementById('content');
    const seg = (key, label) => `<button class="seg-btn ${state.bracketTab === key ? 'active' : ''}" onclick="setBracketTab('${key}')">${label}</button>`;
    content.innerHTML = `
        <div class="section-head">
            <div>
                <div class="section-title">El Mundial</div>
                <div class="section-sub">Posiciones reales de los grupos y cuadro de eliminatorias</div>
            </div>
        </div>
        <div class="seg">${seg('grupos', '📊 Posiciones')}${seg('llaves', '🏆 Eliminatorias')}</div>
        <div id="bracket-body"><div class="card" style="text-align:center; padding:2rem; color:var(--ink-soft);">Cargando…</div></div>`;

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
    if (!state.standings || !state.standings.length) return '';
    const tables = state.standings.map(grp => {
        const rows = grp.teams.map((t, i) => `
            <tr class="${i < 2 ? 'qualifies' : ''}">
                <td class="st-pos">${i + 1}</td>
                <td class="st-team">
                    <img src="${t.flag || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
                    <span>${t.team}</span>
                </td>
                <td>${t.mp}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
                <td>${t.gd > 0 ? '+' : ''}${t.gd}</td><td class="st-pts">${t.pts}</td>
            </tr>`).join('');
        return `
        <section class="group-card standings-card">
            <div class="group-head"><span class="group-tag">${grp.name}</span><span class="group-name">Grupo ${grp.name}</span></div>
            <table class="standings">
                <thead><tr><th></th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </section>`;
    }).join('');
    return `
        <div class="phase-block">
            <div class="phase-head"><span class="phase-label">Posiciones de grupos</span><span class="phase-count">12</span></div>
            <div class="groups-grid">${tables}</div>
        </div>`;
}

// Eliminatorias: vista ronda por ronda con tarjetas grandes y pulidas.
const KO_ROUNDS = [
    ['r32', '16avos de final'], ['r16', 'Octavos de final'],
    ['qf', 'Cuartos de final'], ['sf', 'Semifinales'],
    ['third', 'Tercer puesto'], ['final', 'Final']
];

// Orden oficial dentro de una ronda: por número de partido (P73..P104).
function byMatchNumber(a, b) {
    return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
}

function renderKnockout() {
    const stages = byStage();
    const blocks = KO_ROUNDS.filter(([k]) => (stages[k] || []).length).map(([key, label], i) => {
        const ms = [...stages[key]].sort(byMatchNumber);
        return `
        <section class="ko-round ko-${key}" style="animation-delay:${i * 0.05}s">
            <div class="ko-round-head">
                <span class="ko-round-num">${i + 1}</span>
                <div>
                    <h3 class="ko-round-title">${label}</h3>
                    <span class="ko-round-sub">${ms.length} ${ms.length === 1 ? 'partido' : 'partidos'}</span>
                </div>
            </div>
            <div class="ko-grid">${ms.map(koCard).join('')}</div>
        </section>`;
    }).join('');
    return blocks || '<div class="card empty-state"><div class="emoji">🏟️</div><h2>Eliminatorias por definir</h2><p>El cuadro se llena cuando termine la fase de grupos.</p></div>';
}

function koCard(m) {
    const finished = m.home_goals !== null && m.away_goals !== null;
    const homeWin = finished && m.home_goals > m.away_goals;
    const awayWin = finished && m.away_goals > m.home_goals;
    const myPred = state.predictions[m.id];
    const predTag = myPred && myPred.h != null && myPred.a != null
        ? `<div class="ko-pred">Tu pronóstico: <b>${myPred.h}-${myPred.a}</b></div>` : '';
    const status = finished
        ? '<span class="badge ft">Final</span>'
        : (m.locked ? '<span class="badge locked">En juego</span>' : '<span class="badge open">Próximo</span>');
    const teamRow = (name, logo, goals, win) => `
        <div class="ko-team ${win ? 'ko-win' : ''}">
            <img src="${logo || 'https://flagcdn.com/w80/un.png'}" onerror="this.src='https://flagcdn.com/w80/un.png'">
            <span class="ko-name">${name}</span>
            <span class="ko-goal">${finished ? goals : ''}</span>
            ${win ? '<span class="ko-check">✓</span>' : ''}
        </div>`;
    return `
        <div class="ko-card ${finished ? 'is-final' : ''}">
            <div class="ko-meta"><span>${fmtDate(m.date)}</span>${status}</div>
            ${teamRow(m.home_team, m.home_logo, m.home_goals, homeWin)}
            ${teamRow(m.away_team, m.away_logo, m.away_goals, awayWin)}
            <div class="ko-foot">${m.stadium ? `📍 ${m.stadium}${m.city ? ' · ' + m.city : ''}` : ''}</div>
            ${predTag}
        </div>`;
}

// ---------- Registro / Login ----------
function renderAuth() {
    return `
        <div class="auth-wrap">
            <div class="auth-card">
                <div class="auth-title">Entrar al juego</div>
                <p class="section-sub" style="margin-top:0.3rem;">Tu PIN de 4 dígitos protege tus pronósticos.</p>
                <label class="field-label">Nombre</label>
                <input id="auth-name" class="field" type="text" placeholder="Tu nombre" autocomplete="off">
                <label class="field-label">PIN (4 dígitos)</label>
                <input id="auth-pin" class="field" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
                <button onclick="doRegister()" class="btn-primary">Registrarme</button>
                <button onclick="doLogin()" class="btn-ghost" style="width:100%; margin-top:0.6rem;">Ya estoy anotado, iniciar sesión</button>
            </div>
        </div>`;
}

function authInputs() {
    return {
        name: document.getElementById('auth-name').value.trim(),
        pin: document.getElementById('auth-pin').value.trim()
    };
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
        const res = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
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

// ---------- Admin ----------
function renderAdmin() {
    const content = document.getElementById('content');
    if (!state.adminKey) {
        content.innerHTML = `
            <div class="auth-wrap">
                <div class="auth-card">
                    <div class="auth-title">🔐 Admin</div>
                    <p class="section-sub" style="margin-top:0.3rem;">Ingresa la clave para cargar resultados oficiales.</p>
                    <label class="field-label">Clave de administrador</label>
                    <input id="admin-key" class="field" type="password" placeholder="••••••••">
                    <button onclick="enterAdmin()" class="btn-primary">Entrar</button>
                </div>
            </div>`;
        return;
    }

    const cards = fixtureSections(m => fixture(m, true));

    const inactivos = state.players.filter(p => (p.pred_count || 0) === 0).length;
    const playerRows = state.players.length === 0
        ? '<p style="color:var(--ink-soft); font-size:0.85rem;">Aún no hay jugadores.</p>'
        : state.players.map(p => `
            <div class="adm-player ${(p.pred_count || 0) === 0 ? 'inactive' : ''}">
                <div class="avatar" style="width:34px; height:34px; font-size:0.9rem;">${p.name[0].toUpperCase()}</div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.9rem;">${p.name}</div>
                    <div style="font-size:0.68rem; color:var(--ink-soft); font-weight:600;">
                        ${p.pred_count || 0} jugadas · ${p.points} pts${(p.pred_count || 0) === 0 ? ' · sin jugar' : ''}
                    </div>
                </div>
                <button class="del-btn" title="Eliminar jugador" onclick="deletePlayer(${p.id}, '${p.name.replace(/'/g, "\\'")}')">🗑</button>
            </div>`).join('');

    content.innerHTML = `
        <div class="section-head">
            <div>
                <div class="section-title">Panel de administración</div>
                <div class="section-sub">Gestiona jugadores y carga resultados</div>
            </div>
            <button class="btn-ghost" onclick="exitAdmin()">Salir de admin</button>
        </div>

        <div class="card" style="margin-bottom:1.5rem;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; flex-wrap:wrap;">
                <h3 style="font-family:'Anton',sans-serif; font-size:1.1rem; text-transform:uppercase; color:var(--green-900);">Jugadores (${state.players.length})</h3>
                <button class="btn-ghost" ${inactivos === 0 ? 'disabled style="opacity:.5;"' : ''} onclick="cleanupInactive()">
                    🧹 Eliminar inactivos${inactivos ? ` (${inactivos})` : ''}
                </button>
            </div>
            <div class="adm-players">${playerRows}</div>
        </div>

        <h3 style="font-family:'Anton',sans-serif; font-size:1.1rem; text-transform:uppercase; color:var(--green-900); margin-bottom:1rem;">Cargar resultados</h3>
        ${cards}`;
}

async function deletePlayer(id, name) {
    if (!confirm(`¿Eliminar a "${name}" y todas sus jugadas? Esta acción no se puede deshacer.`)) return;
    try {
        const res = await fetch(`/api/players/${id}/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_key: state.adminKey })
        });
        const data = await res.json();
        if (res.ok) {
            await refreshPlayers();
            toast(`"${name}" eliminado`);
            renderAdmin();
        } else {
            if (res.status === 403) exitAdmin();
            toast(data.detail || 'No se pudo eliminar', false);
        }
    } catch (e) { toast('Error de conexión', false); }
}

async function cleanupInactive() {
    if (!confirm('¿Eliminar a todos los jugadores que se registraron pero no cargaron ninguna jugada?')) return;
    try {
        const res = await fetch('/api/players/cleanup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_key: state.adminKey })
        });
        const data = await res.json();
        if (res.ok) {
            await refreshPlayers();
            toast(`${data.deleted} jugador(es) inactivo(s) eliminado(s)`);
            renderAdmin();
        } else {
            if (res.status === 403) exitAdmin();
            toast(data.detail || 'Error', false);
        }
    } catch (e) { toast('Error de conexión', false); }
}

async function refreshPlayers() {
    state.players = await (await fetch('/api/players')).json();
    state.boards = {}; // invalidar cache de boletas para comparación
}

function enterAdmin() {
    const key = document.getElementById('admin-key').value.trim();
    if (!key) return;
    state.adminKey = key;
    sessionStorage.setItem('prode_admin', key);
    renderAdmin();
}

function exitAdmin() {
    state.adminKey = null;
    sessionStorage.removeItem('prode_admin');
    renderAdmin();
}

async function saveResult(matchId) {
    const h = document.getElementById(`adm-${matchId}-h`).value;
    const a = document.getElementById(`adm-${matchId}-a`).value;
    if (h === '' || a === '') return toast('Completa ambos marcadores', false);
    try {
        const res = await fetch(`/api/matches/${matchId}/result`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ home_goals: parseInt(h), away_goals: parseInt(a), admin_key: state.adminKey })
        });
        const data = await res.json();
        if (res.ok) {
            const m = state.matches.find(x => x.id === matchId);
            m.home_goals = parseInt(h); m.away_goals = parseInt(a);
            state.players = await (await fetch('/api/players')).json();
            toast('Resultado guardado ✓');
        } else {
            if (res.status === 403) { exitAdmin(); }
            toast(data.detail || 'Error al guardar', false);
        }
    } catch (e) { toast('Error de conexión', false); }
}

init();
