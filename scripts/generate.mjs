// Gera os cards em SVG do README do perfil (estilo terminal).
// Uso: GITHUB_TOKEN=... node scripts/generate.mjs [login]
import { mkdir, writeFile } from 'node:fs/promises';

const LOGIN = process.argv[2] ?? process.env.GH_LOGIN ?? 'Ph20sr';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('Defina GITHUB_TOKEN');

const C = {
  bg: '#0d1117', panel: '#010409', border: '#30363d', text: '#c9d1d9', muted: '#8b949e',
  green: '#3fb950', blue: '#58a6ff', purple: '#d2a8ff', orange: '#ffa657',
  levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
};
const FONT = `ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(n);

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-cards' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

const { user } = await graphql(`query($login: String!) {
  user(login: $login) {
    login avatarUrl(size: 256)
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes { stargazerCount languages(first: 8, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
    contributionsCollection {
      totalCommitContributions restrictedContributionsCount totalPullRequestContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } }
    }
  }
}`, { login: LOGIN });

// ---------- Estatísticas ----------
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const calendar = user.contributionsCollection.contributionCalendar;
const weeks = calendar.weeks;
const days = weeks.flatMap((w) => w.contributionDays);

function streaks(list) {
  let longest = 0;
  let run = 0;
  for (const d of list) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Streak atual: hoje sem contribuição ainda não quebra a sequência
  let current = 0;
  let i = list.length - 1;
  if (list[i]?.contributionCount === 0) i--;
  for (; i >= 0 && list[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

const { current, longest } = streaks(days);
const total = calendar.totalContributions;
// O calendário traz semanas completas (até 371 dias); as métricas usam os últimos 365
const year = days.slice(-365);
const activeDays = year.filter((d) => d.contributionCount > 0).length;
const best = year.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), year[0]);
const perActiveDay = activeDays ? Math.round((total / activeDays) * 10) / 10 : 0;

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const byWeekday = Array(7).fill(0);
for (const d of year) byWeekday[new Date(`${d.date}T12:00:00Z`).getUTCDay()] += d.contributionCount;
const topWeekday = byWeekday.indexOf(Math.max(...byWeekday));

// Contribuições por mês (últimos 12 meses)
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthTotals = new Map();
for (const d of year) monthTotals.set(d.date.slice(0, 7), (monthTotals.get(d.date.slice(0, 7)) ?? 0) + d.contributionCount);
const monthly = [...monthTotals.entries()].slice(-12)
  .map(([ym, n]) => ({ label: MONTHS[Number(ym.slice(5)) - 1], n }));

// Linguagens: cada projeto pesa igual (um repositório antigo e grande não
// distorce o retrato do que você usa hoje)
const projects = user.repositories.nodes.filter((r) => r.languages.edges.length);
const langTotals = new Map();
for (const repo of projects) {
  const repoSize = repo.languages.edges.reduce((s, e) => s + e.size, 0) || 1;
  for (const { size, node } of repo.languages.edges) {
    const cur = langTotals.get(node.name) ?? { share: 0, color: node.color ?? C.muted };
    cur.share += size / repoSize;
    langTotals.set(node.name, cur);
  }
}
const langSum = [...langTotals.values()].reduce((s, l) => s + l.share, 0) || 1;
const langs = [...langTotals.entries()].sort((a, b) => b[1].share - a[1].share).slice(0, 5)
  .map(([name, l]) => ({ name, color: l.color, pct: l.share / langSum }));
const publicProjects = projects.length;

// ---------- Moldura de terminal ----------
function terminal({ width, height, title, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <style>
    text { font-family: ${FONT}; fill: ${C.text}; }
    .muted { fill: ${C.muted}; } .green { fill: ${C.green}; } .blue { fill: ${C.blue}; }
    .purple { fill: ${C.purple}; } .orange { fill: ${C.orange}; }
    .cursor { animation: blink 1.1s steps(1) infinite; }
    /* Visível por padrão: a animação só faz a entrada (fill "backwards"),
       assim renderizadores sem animação mostram o card completo. */
    .fade { animation: fade .5s ease-out backwards; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes fade { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .cursor, .fade { animation: none; opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${C.bg}" stroke="${C.border}"/>
  <path d="M0.5 12.5a12 12 0 0 1 12-12h${width - 25}a12 12 0 0 1 12 12v24h-${width - 1}z" fill="${C.panel}"/>
  <line x1="0.5" y1="36.5" x2="${width - 0.5}" y2="36.5" stroke="${C.border}"/>
  <circle cx="22" cy="18.5" r="6" fill="#ff5f56"/><circle cx="42" cy="18.5" r="6" fill="#ffbd2e"/><circle cx="62" cy="18.5" r="6" fill="#27c93f"/>
  <text x="${width / 2}" y="23" text-anchor="middle" font-size="12" class="muted">${esc(title)}</text>
  ${body}
</svg>`;
}

const prompt = (x, y, cmd, delay = 0) => `<text x="${x}" y="${y}" font-size="14" class="fade" style="animation-delay:${delay}s" xml:space="preserve">`
  + `<tspan class="green">${esc(LOGIN.toLowerCase())}@github</tspan><tspan class="muted"> ~ </tspan><tspan class="blue">$</tspan> ${esc(cmd)}</text>`;

// ---------- Mascote: passeia pelos dias com contribuição ----------
const HOP = 0.6; // segundos por pulo
const MAX_STOPS = 60;

/** keyTimes/values estritamente crescentes entre 0 e 1 (exigência do SMIL). */
function timeline(points) {
  const sorted = points
    .map(([t, v]) => [Math.min(1, Math.max(0, t)), v])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0] + 1e-6);
  if (sorted[0][0] !== 0) sorted.unshift([0, sorted[0][1]]);
  if (sorted.at(-1)[0] !== 1) sorted.push([1, sorted.at(-1)[1]]);
  return {
    keyTimes: sorted.map(([t]) => +t.toFixed(5)).join(';'),
    values: sorted.map(([, v]) => v).join(';'),
  };
}

function petTour(grid, cell) {
  // Paradas: dias com contribuição em ordem cronológica (os mais recentes, se forem muitos)
  const stops = grid.filter((d) => d.contributionCount > 0).slice(-MAX_STOPS);
  const visitAt = new Map();
  const n = stops.length;
  const dur = Math.max(1, n - 1) * HOP;

  stops.forEach((s, i) => visitAt.set(s.date, n > 1 ? i / (n - 1) : 0));

  const cells = grid.map((d) => {
    let glow = '';
    if (visitAt.has(d.date) && n > 1) {
      const t = visitAt.get(d.date);
      const step = 1 / (n - 1);
      const { keyTimes, values } = timeline([
        [0, d.fill], [t - step * 0.05, d.fill], [t, '#7ee787'], [t + step * 0.9, d.fill], [1, d.fill],
      ]);
      glow = `<animate attributeName="fill" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimes}" values="${values}"/>`;
    }
    return `<rect x="${d.x}" y="${d.y}" width="${cell}" height="${cell}" rx="2.5" fill="${d.fill}">${glow}<title>${d.date}: ${d.contributionCount}</title></rect>`;
  }).join('');

  if (n === 0) return { cells, pet: '' };

  // Centro de cada célula; o mascote "pisa" no meio do quadrado
  const pts = stops.map((s) => [s.x + cell / 2, s.y + cell / 2 + 1]);
  const [x0, y0] = pts[0];
  // Caminho relativo à primeira parada: sem suporte a animação, o mascote
  // fica parado ali em vez de sumir na origem do SVG.
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x - x0} ${y - y0}`).join(' ');
  let motion = '';
  if (n > 1) {
    // keyPoints proporcionais ao comprimento, para cada pulo durar o mesmo tempo
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum.at(-1) || 1;
    motion = `<animateMotion dur="${dur}s" repeatCount="indefinite" calcMode="linear" path="${path}"
      keyTimes="${cum.map((_, i) => +(i / (n - 1)).toFixed(5)).join(';')}"
      keyPoints="${cum.map((c) => +(c / total).toFixed(5)).join(';')}"/>`;
  }
  // Morceguinho: bate as asas, pisca e voa de quadrado em quadrado
  const wing = 'M-2 -11 C-6 -15.5 -11.5 -16.5 -16 -13 C-14.2 -11 -13.8 -9 -14.4 -6.6 C-12.2 -8.2 -10 -8.2 -8.4 -6.6 C-7.2 -8.6 -5 -9.6 -2 -8.4 Z';
  const flap = `<animateTransform attributeName="transform" type="rotate" values="16 -2 -10;-24 -2 -10;16 -2 -10" dur=".34s" repeatCount="indefinite"/>`;
  const blink = `<animate attributeName="ry" values="1.3;1.3;.2;1.3" keyTimes="0;.9;.95;1" dur="3.3s" repeatCount="indefinite"/>`;
  const pet = `
  <g transform="translate(${x0} ${y0})"><g>${motion}
    <ellipse cx="0" cy="1.5" rx="6" ry="1.5" fill="#000" opacity=".4">
      <animate attributeName="rx" values="6;3.8;6" dur="${HOP}s" repeatCount="indefinite"/>
    </ellipse>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 -3;0 -10;0 -3" keyTimes="0;.5;1"
        calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1" dur="${HOP}s" repeatCount="indefinite"/>
      <g fill="#8957e5" stroke="#b392f0" stroke-width=".6" stroke-linejoin="round">
        <g><path d="${wing}"/>${flap}</g>
        <g transform="scale(-1 1)"><g><path d="${wing}"/>${flap}</g></g>
      </g>
      <path d="M-3.6 -12.4 L-2.7 -16.6 L-1 -13.2 Z M3.6 -12.4 L2.7 -16.6 L1 -13.2 Z" fill="#6e40c9"/>
      <ellipse cx="0" cy="-9" rx="4.3" ry="5.1" fill="#6e40c9"/>
      <ellipse cx="0" cy="-7.4" rx="2.6" ry="3" fill="#8957e5"/>
      <ellipse cx="-1.7" cy="-10.6" rx="1.25" ry="1.3" fill="#ffd33d">${blink}</ellipse>
      <ellipse cx="1.7" cy="-10.6" rx="1.25" ry="1.3" fill="#ffd33d">${blink}</ellipse>
      <circle cx="-1.5" cy="-10.5" r=".5" fill="#0d1117"/><circle cx="1.9" cy="-10.5" r=".5" fill="#0d1117"/>
      <path d="M-1 -7.9 L-.6 -6.8 L-.2 -7.9 Z M.2 -7.9 L.6 -6.8 L1 -7.9 Z" fill="#fff"/>
    </g>
  </g></g>`;
  return { cells, pet };
}

// ---------- Card 1: contributions.svg ----------
function contributionsCard() {
  const cell = 12;
  const gap = 3;
  const left = 52;
  const top = 96;
  const width = left + weeks.length * (cell + gap) + 30;
  const grid = [];
  let months = '';
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const x = left + wi * (cell + gap);
    week.contributionDays.forEach((d) => {
      const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      const lvl = LEVEL[d.contributionLevel] ?? 0;
      grid.push({ ...d, x, y: top + dow * (cell + gap), fill: C.levels[lvl] });
    });
    const month = new Date(`${week.contributionDays[0].date}T12:00:00Z`).getUTCMonth();
    if (month !== lastMonth && wi < weeks.length - 2) {
      months += `<text x="${x}" y="${top - 10}" font-size="11" class="muted">${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][month]}</text>`;
      lastMonth = month;
    }
  });
  const dayLabels = [[1, 'Seg'], [3, 'Qua'], [5, 'Sex']]
    .map(([r, l]) => `<text x="16" y="${top + r * (cell + gap) + 10}" font-size="11" class="muted">${l}</text>`).join('');
  const legendX = width - 30 - 5 * (cell + 3) - 80;
  const legend = `<text x="${legendX - 8}" y="${top + 7 * (cell + gap) + 30}" font-size="11" class="muted" text-anchor="end">menos</text>`
    + C.levels.map((c, i) => `<rect x="${legendX + i * (cell + 3)}" y="${top + 7 * (cell + gap) + 20}" width="${cell}" height="${cell}" rx="2.5" fill="${c}"/>`).join('')
    + `<text x="${legendX + 5 * (cell + 3) + 6}" y="${top + 7 * (cell + gap) + 30}" font-size="11" class="muted">mais</text>`;

  const { cells, pet } = petTour(grid, cell);

  const body = `${prompt(20, 64, './contributions.sh')}
    ${months}${dayLabels}<g class="fade" style="animation-delay:.25s">${cells}</g>${pet}
    <text x="${left}" y="${top + 7 * (cell + gap) + 30}" font-size="13" class="fade" style="animation-delay:.5s"><tspan class="green" font-weight="700">${fmt(total)}</tspan> contribuições no último ano</text>
    ${legend}
    <text x="20" y="${top + 7 * (cell + gap) + 64}" font-size="14" xml:space="preserve"><tspan class="green">${esc(LOGIN.toLowerCase())}@github</tspan><tspan class="muted"> ~ </tspan><tspan class="blue">$</tspan> <tspan class="cursor">▋</tspan></text>`;
  return terminal({ width, height: top + 7 * (cell + gap) + 84, title: `${LOGIN.toLowerCase()}@github: ~/contributions`, body });
}

// ---------- Card 2: whoami.svg ----------
// Símbolo de morcego vetorial (desenho próprio). Meia asa direita; a
// esquerda é o espelho dela. Coordenadas num quadro de 200×110.
const BAT_HALF = 'M100 31 L104.5 31 L108.5 15 L112 34 C117 37 121 34 123 27 C140 20 163 21 190 35 '
  + 'C180 42 176 52 178 64 C169 55 157 55 151 66 C144 57 132 57 127 70 C117 76 108 82 100 96 Z';

function emblem(x, y, scale) {
  const shape = `<path d="${BAT_HALF}"/><path d="${BAT_HALF}" transform="translate(200 0) scale(-1 1)"/>`;
  return `
    <defs>
      <linearGradient id="batFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#e3a008"/>
      </linearGradient>
      <radialGradient id="batHalo" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#e3a008" stop-opacity=".18"/><stop offset="1" stop-color="#e3a008" stop-opacity="0"/>
      </radialGradient>
      <filter id="batGlow" x="-25%" y="-40%" width="150%" height="180%"><feGaussianBlur stdDeviation="4"/></filter>
    </defs>
    <ellipse cx="${x + 100 * scale}" cy="${y + 55 * scale}" rx="${130 * scale}" ry="${80 * scale}" fill="url(#batHalo)"/>
    <g transform="translate(${x} ${y}) scale(${scale})">
      <g fill="#ffd33d" filter="url(#batGlow)" opacity=".55">${shape}
        <animate attributeName="opacity" values=".35;.75;.35" dur="4s" repeatCount="indefinite"/>
      </g>
      <g fill="url(#batFill)">${shape}</g>
    </g>`;
}

async function whoamiCard() {
  const width = 860;
  const height = 430;
  const pctYear = Math.round((activeDays / 365) * 100);

  const boxes = [
    ['contribuições', fmt(total), `≈ ${perActiveDay} por dia ativo`],
    ['streak atual', `${current}`, current === 1 ? 'dia seguido' : 'dias seguidos'],
    ['maior streak', `${longest}`, longest === 1 ? 'dia' : 'dias'],
    ['dias ativos', `${activeDays}`, `${pctYear}% do ano`],
    ['dia mais ativo', WEEKDAYS[topWeekday], `${byWeekday[topWeekday]} contribuições`],
    ['projetos', `${publicProjects}`, 'open source'],
  ];
  const bx = 400;
  const bw = 140;
  const bh = 70;
  const grid = boxes.map(([label, value, sub], i) => {
    const x = bx + (i % 3) * (bw + 10);
    const y = 84 + Math.floor(i / 3) * (bh + 10);
    const size = String(value).length > 6 ? 18 : 22;
    return `<g class="fade" style="animation-delay:${0.2 + i * 0.08}s">
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${C.panel}" stroke="${C.border}"/>
      <text x="${x + 12}" y="${y + 20}" font-size="11" class="muted">${esc(label)}</text>
      <text x="${x + 12}" y="${y + 44}" font-size="${size}" font-weight="700" class="green">${esc(value)}</text>
      <text x="${x + 12}" y="${y + 60}" font-size="10" class="muted">${esc(sub)}</text>
    </g>`;
  }).join('');

  // Contribuições por mês (12 meses)
  const chartTop = 272;
  const chartH = 50;
  const inner = bw * 3 + 20;
  const maxMonth = Math.max(1, ...monthly.map((m) => m.n));
  const slot = inner / monthly.length;
  const bars = monthly.map((m, i) => {
    const h = m.n ? Math.max(3, (m.n / maxMonth) * chartH) : 2;
    const x = bx + i * slot + 3;
    const w = slot - 6;
    const level = m.n ? C.levels[Math.min(4, 1 + Math.floor((m.n / maxMonth) * 3.99))] : C.levels[0];
    const value = m.n ? `<text x="${x + w / 2}" y="${chartTop + chartH - h - 4}" font-size="9" text-anchor="middle" class="muted">${m.n}</text>` : '';
    return `<rect x="${x}" y="${chartTop + chartH - h}" width="${w}" height="${h}" rx="2" fill="${level}"><title>${m.label}: ${m.n}</title></rect>${value}`
      + `<text x="${x + w / 2}" y="${chartTop + chartH + 13}" font-size="9" text-anchor="middle" class="muted">${m.label}</text>`;
  }).join('');

  let lx = bx;
  const langBar = langs.map((l) => {
    const w = Math.max(3, l.pct * inner);
    const r = `<rect x="${lx}" y="372" width="${w}" height="8" fill="${l.color}"/>`;
    lx += w;
    return r;
  }).join('');
  // Posição de cada legenda calculada pelo tamanho do texto (monoespaçada ≈ 6.6px/char a 11px)
  let legendX = bx;
  const langLabels = langs.map((l) => {
    const pct = `${Math.max(1, Math.round(l.pct * 100))}%`;
    const out = `<circle cx="${legendX + 5}" cy="398" r="4" fill="${l.color}"/><text x="${legendX + 14}" y="402" font-size="11">${esc(l.name)} <tspan class="muted">${pct}</tspan></text>`;
    legendX += 14 + (l.name.length + 1 + pct.length) * 6.6 + 16;
    return legendX <= bx + inner ? out : '';
  }).join('');

  const body = `${prompt(20, 64, 'whoami')}
    <rect x="20" y="84" width="360" height="326" rx="8" fill="${C.panel}" stroke="${C.border}"/>
    <g class="fade" style="animation-delay:.15s">${emblem(50, 112, 1.5)}</g>
    <text x="200" y="330" font-size="13" text-anchor="middle" xml:space="preserve"><tspan class="green">&gt;</tspan> desenvolvedor full stack</text>
    <text x="200" y="352" font-size="12" text-anchor="middle" class="muted">sites · CRMs · cobrança recorrente</text>
    <text x="200" y="384" font-size="11" text-anchor="middle" class="muted" xml:space="preserve">vynex systems  ·  brasil</text>
    ${grid}
    <text x="${bx}" y="${chartTop - 10}" font-size="11" class="muted">contribuições por mês</text>
    <g class="fade" style="animation-delay:.7s">${bars}</g>
    <clipPath id="lang"><rect x="${bx}" y="372" width="${inner}" height="8" rx="4"/></clipPath>
    <text x="${bx}" y="362" font-size="11" class="muted">linguagens (cada projeto com o mesmo peso)</text>
    <g clip-path="url(#lang)">${langBar}</g>
    ${langLabels}`;
  return terminal({ width, height, title: `${LOGIN.toLowerCase()}@github: ~`, body });
}

await mkdir('assets', { recursive: true });
await writeFile('assets/contributions.svg', contributionsCard());
await writeFile('assets/whoami.svg', await whoamiCard());
console.log(`ok: ${total} contribuições, streak ${current}/${longest}, ${activeDays} dias ativos, ${langs.map((l) => l.name).join(', ')}`);
