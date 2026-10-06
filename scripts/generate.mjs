// Gera os cards em SVG do README do perfil (estilo terminal).
// Uso: GITHUB_TOKEN=... node scripts/generate.mjs [login]
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

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
const activeDays = days.filter((d) => d.contributionCount > 0).length;
const best = days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), days[0]);
const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const weekly = weeks.slice(-16).map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));

const langTotals = new Map();
for (const repo of user.repositories.nodes) {
  for (const { size, node } of repo.languages.edges) {
    const cur = langTotals.get(node.name) ?? { size: 0, color: node.color ?? C.muted };
    cur.size += size;
    langTotals.set(node.name, cur);
  }
}
const langSum = [...langTotals.values()].reduce((s, l) => s + l.size, 0) || 1;
const langs = [...langTotals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5)
  .map(([name, l]) => ({ name, color: l.color, pct: l.size / langSum }));

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
  const pet = `
  <g transform="translate(${x0} ${y0})"><g>${motion}
    <ellipse cx="0" cy="1" rx="6" ry="1.6" fill="#000" opacity=".45">
      <animate attributeName="rx" values="6;3.5;6" dur="${HOP}s" repeatCount="indefinite"/>
    </ellipse>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 0" keyTimes="0;.5;1"
        calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1" dur="${HOP}s" repeatCount="indefinite"/>
      <rect x="-8" y="-15" width="16" height="14" rx="6" fill="#a371f7" stroke="#d2a8ff" stroke-width="1"/>
      <path d="M-2 -15 Q0 -20 3 -18" stroke="#d2a8ff" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <circle cx="3.4" cy="-18.4" r="1.4" fill="#ffa657"/>
      <g fill="#fff">
        <ellipse cx="-3.2" cy="-9" rx="2.2" ry="2.6"><animate attributeName="ry" values="2.6;2.6;.3;2.6" keyTimes="0;.92;.96;1" dur="3.7s" repeatCount="indefinite"/></ellipse>
        <ellipse cx="3.2" cy="-9" rx="2.2" ry="2.6"><animate attributeName="ry" values="2.6;2.6;.3;2.6" keyTimes="0;.92;.96;1" dur="3.7s" repeatCount="indefinite"/></ellipse>
      </g>
      <circle cx="-2.6" cy="-8.6" r="1.1" fill="#0d1117"/><circle cx="3.8" cy="-8.6" r="1.1" fill="#0d1117"/>
      <ellipse cx="-5.6" cy="-5.2" rx="1.4" ry=".8" fill="#ff7b9c" opacity=".75"/>
      <ellipse cx="5.6" cy="-5.2" rx="1.4" ry=".8" fill="#ff7b9c" opacity=".75"/>
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
// Emblema de morcego desenhado aqui mesmo (oval com o morcego recortado).
// Meia asa direita; a esquerda é o espelho dela.
const BAT_HALF = 'M100 78 L104 78 L108.5 60 L112 81 C119 83 124 79 126 70 C143 69 166 74 190 92 '
  + 'C181 97 176 106 176 117 C168 104 157 104 150 118 C142 106 132 106 126 121 C117 129 107 136 100 152 Z';
// Borda branca (vira caracteres densos) + miolo cinza (caracteres médios) = oval com contorno
const EMBLEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#000"/>
  <ellipse cx="100" cy="100" rx="97" ry="63" fill="#fff"/>
  <ellipse cx="100" cy="100" rx="91" ry="57" fill="#bbb"/>
  <g fill="#000"><path d="${BAT_HALF}"/><path d="${BAT_HALF}" transform="translate(200 0) scale(-1 1)"/></g>
</svg>`;

async function asciiEmblem(cols, rows) {
  // 'fill' estica o quadrado para cols×rows: como cada caractere é ~2x mais
  // alto que largo, isso compensa a proporção e o emblema não fica achatado.
  const { data } = await sharp(Buffer.from(EMBLEM_SVG))
    .resize(cols, rows, { fit: 'fill' })
    .grayscale().raw().toBuffer({ resolveWithObject: true });
  // Oval = caracteres densos; morcego e fundo = espaço; bordas suavizadas = intermediários
  const ramp = ' .:-=+*#%@';
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const v = data[y * cols + x] / 255;
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
    }
    lines.push(line);
  }
  return lines;
}

async function whoamiCard() {
  const width = 860;
  const height = 430;
  const cols = 84;
  const rows = 42;
  const fontSize = 6.6;
  const lineH = 7.3;
  const art = await asciiEmblem(cols, rows);
  const artX = 20 + (360 - cols * fontSize * 0.6) / 2; // monoespaçada ≈ 0.6em por caractere
  // Duas tonalidades: borda (@ %) em amarelo claro, miolo em amarelo escuro
  const shade = (ch) => ('@%'.includes(ch) ? 'b' : ch === ' ' ? 's' : 'm');
  const artText = art.map((line, i) => {
    let runs = '';
    for (let j = 0; j < line.length;) {
      let k = j;
      while (k < line.length && shade(line[k]) === shade(line[j])) k++;
      const chunk = esc(line.slice(j, k));
      const kind = shade(line[j]);
      runs += kind === 's' ? chunk : `<tspan fill="${kind === 'b' ? '#ffe066' : '#d9a514'}">${chunk}</tspan>`;
      j = k;
    }
    return `<tspan x="${artX}" dy="${i === 0 ? 0 : lineH}">${runs}</tspan>`;
  }).join('');

  const boxes = [
    ['streak atual', `${current}`, current === 1 ? 'dia' : 'dias'],
    ['maior streak', `${longest}`, longest === 1 ? 'dia' : 'dias'],
    ['contribuições', fmt(total), 'no último ano'],
    ['dias ativos', `${activeDays}`, `de ${days.length}`],
    ['melhor dia', `${best.contributionCount}`, best.date.split('-').reverse().slice(0, 2).join('/')],
    ['repos públicos', `${user.repositories.totalCount}`, `${stars} ★`],
  ];
  const bx = 400;
  const bw = 140;
  const bh = 70;
  const grid = boxes.map(([label, value, sub], i) => {
    const x = bx + (i % 3) * (bw + 10);
    const y = 84 + Math.floor(i / 3) * (bh + 10);
    return `<g class="fade" style="animation-delay:${0.2 + i * 0.08}s">
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${C.panel}" stroke="${C.border}"/>
      <text x="${x + 12}" y="${y + 20}" font-size="11" class="muted">${esc(label)}</text>
      <text x="${x + 12}" y="${y + 44}" font-size="22" font-weight="700" class="green">${esc(value)}</text>
      <text x="${x + 12}" y="${y + 60}" font-size="10" class="muted">${esc(sub)}</text>
    </g>`;
  }).join('');

  const chartY = 282;
  const chartH = 58;
  const maxWeek = Math.max(1, ...weekly);
  const barW = (bw * 3 + 20) / weekly.length - 6;
  const bars = weekly.map((v, i) => {
    const h = Math.max(2, (v / maxWeek) * chartH);
    const x = bx + i * (barW + 6);
    return `<rect x="${x}" y="${chartY + chartH - h}" width="${barW}" height="${h}" rx="2" fill="${v ? C.levels[Math.min(4, 1 + Math.floor((v / maxWeek) * 3.99))] : C.levels[0]}"><title>${v}</title></rect>`;
  }).join('');

  let lx = bx;
  const langBar = langs.map((l) => {
    const w = Math.max(3, l.pct * (bw * 3 + 20));
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
    return legendX <= bx + bw * 3 + 20 ? out : '';
  }).join('');

  const body = `${prompt(20, 64, 'whoami')}
    <rect x="20" y="84" width="360" height="326" rx="8" fill="${C.panel}" stroke="${C.border}"/>
    <text y="${84 + (326 - rows * lineH) / 2 + 6}" font-size="${fontSize}" font-weight="700" fill="#e3b341" class="fade" style="fill:#e3b341;animation-delay:.15s;white-space:pre" xml:space="preserve">${artText}</text>
    ${grid}
    <text x="${bx}" y="${chartY - 10}" font-size="11" class="muted">contribuições por semana (últimas ${weekly.length})</text>
    <g class="fade" style="animation-delay:.7s">${bars}</g>
    <clipPath id="lang"><rect x="${bx}" y="372" width="${bw * 3 + 20}" height="8" rx="4"/></clipPath>
    <text x="${bx}" y="362" font-size="11" class="muted">linguagens (repos públicos)</text>
    <g clip-path="url(#lang)">${langBar}</g>
    ${langLabels}`;
  return terminal({ width, height, title: `${LOGIN.toLowerCase()}@github: ~`, body });
}

await mkdir('assets', { recursive: true });
await writeFile('assets/contributions.svg', contributionsCard());
await writeFile('assets/whoami.svg', await whoamiCard());
console.log(`ok: ${total} contribuições, streak ${current}/${longest}, ${activeDays} dias ativos, ${langs.map((l) => l.name).join(', ')}`);
