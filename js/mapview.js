// Mapa visual (SVG) da distribuição de telhas por água, com codificação de cores,
// numeração de peças, emendas e pingadeiras — item 9/10/11 da especificação.

const COLOR = {
  green: '#2e8b4f', yellow: '#c9a227', blue: '#3a6ea5', orange: '#d17a2a',
  red: '#8c1d18', gray: '#6b7280', purple: '#7b4fa6'
};

export function renderAguaMapSVG(agua, result, opts = {}) {
  const cols = result.columns;
  if (!cols.length) return `<svg viewBox="0 0 400 80"><text x="10" y="40" fill="#6e7178" font-size="13">Sem geometria válida para "${escXml(agua.label)}".</text></svg>`;

  const minX = Math.min(...cols.map(c => c.x0));
  const maxX = Math.max(...cols.map(c => c.x1));
  const maxRun = Math.max(...cols.map(c => c.tiers.reduce((s, t) => s + t.lengthMM + (t.seamOverlapMM || 0) + (t.hasPingadeira ? 190 : 0), 0)));

  const PAD = 60, SCALE = Math.min(0.35, 900 / (maxX - minX || 1));
  const W = (maxX - minX) * SCALE + PAD * 2;
  const H = maxRun * SCALE + PAD * 2 + 30;

  let body = '';
  for (const col of cols) {
    const x = PAD + (col.x0 - minX) * SCALE;
    const w = Math.max(2, col.widthMM * SCALE);
    let y = PAD;
    for (const tier of col.tiers) {
      const h = Math.max(2, tier.lengthMM * SCALE);
      const fill = COLOR[tier.color] || COLOR.gray;
      body += rect(x, y, w, h, fill);
      body += label(x + w / 2, y + h / 2, tier.code || '', w);
      if (col.widthMM > 55) body += smallText(x + w / 2, y + h / 2 + 12, `${Math.round(tier.lengthMM)}mm`, w);
      y += h;
      if (tier.seamOverlapMM) {
        const oh = Math.max(2, tier.seamOverlapMM * SCALE);
        body += rect(x, y, w, oh, COLOR.red, 0.85);
        if (col.widthMM > 55) body += smallText(x + w / 2, y + oh / 2 + 3, tier.seamCode || 'E', w);
        y += oh;
      }
      if (tier.hasPingadeira) {
        const ph = Math.max(2, 190 * SCALE);
        body += rect(x, y, w, ph, COLOR.gray, 0.9);
        if (col.widthMM > 55) body += smallText(x + w / 2, y + ph / 2 + 3, tier.pingadeiraCode || 'P', w);
        y += ph;
      }
    }
    body += smallText(x + w / 2, PAD - 8, `#${col.index + 1}`, w, '#6e7178');
  }

  const legend = opts.legend === false ? '' : renderLegend(W, H);

  return `<svg viewBox="0 0 ${W} ${H + (opts.legend === false ? 0 : 34)}" xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
    <text x="${PAD}" y="20" fill="#16171a" font-size="13" font-weight="700">${escXml(agua.label)} — ${cols.length} coluna(s)</text>
    ${body}
    ${legend}
  </svg>`;
}

function rect(x, y, w, h, fill, opacity) {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${opacity || 1}" stroke="#ffffff" stroke-width="1"/>`;
}
function label(cx, cy, text, w) {
  if (w < 16) return '';
  return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="#fff" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escXml(text)}</text>`;
}
function smallText(cx, cy, text, w, color) {
  if (w < 40) return '';
  return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${color || '#16171a'}" font-size="9" text-anchor="middle">${escXml(text)}</text>`;
}

function renderLegend(W, H) {
  const items = [
    ['green', 'Peça inteira'], ['yellow', 'Peça cortada'], ['blue', 'Peça superior'],
    ['orange', 'Peça inferior'], ['red', 'Emenda'], ['gray', 'Pingadeira'], ['purple', 'Área perdida']
  ];
  let x = 8;
  let out = '';
  for (const [k, t] of items) {
    out += `<rect x="${x}" y="${H + 8}" width="12" height="12" fill="${COLOR[k]}"/><text x="${x + 16}" y="${H + 18}" fill="#6e7178" font-size="10">${t}</text>`;
    x += 16 + t.length * 5.6 + 14;
  }
  return out;
}

function escXml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export { COLOR };
