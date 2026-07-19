// Motor de distribuição inteligente de telhas.
// Para cada "água" (plano de cobertura desenhado no editor CAD), calcula a divisão em
// faixas (largura útil da telha), o fatiamento em peças respeitando os comprimentos
// mínimo/ideal/máximo/transporte, as emendas necessárias, o desconto da pingadeira e
// classifica cada peça por cor conforme a especificação.
//
// A "otimização" é uma busca heurística determinística sobre um conjunto de direções
// candidatas (não é aprendizado de máquina): para cada direção calcula-se a distribuição
// completa e escolhe-se a de menor "custo" (desperdício, nº de cortes, nº de emendas,
// peças muito pequenas). Isso cobre os itens 5, 6, 7 e 16 da especificação de forma
// explicável e auditável.

import { rotatePolygon, polygonBounds, verticalCoverage, degToRad } from './geometry.js';

const MIN_USEFUL_TIER = 250; // mm — abaixo disso, uma peça é considerada "peça pequena" a evitar

export function distributeAgua(agua, profile, pingadeira, opts = {}) {
  const directionDeg = opts.directionDeg || 0;
  const pingadeiraOn = !!opts.pingadeiraOn && !!pingadeira;
  const larguraUtil = profile.larguraUtil;
  const lens = profile.comprimentos;
  const aba = profile.aba;
  const overlap = clamp((aba.sobreposicaoMin + aba.sobreposicaoMax) / 2, aba.sobreposicaoMin, aba.sobreposicaoMax);

  const rotated = rotatePolygon(agua.points, degToRad(-directionDeg), centroidOf(agua.points));
  const b = polygonBounds(rotated);
  const totalWidth = b.w;
  if (totalWidth <= 0 || b.h <= 0) return emptyResult(agua, directionDeg);

  const nFullCols = Math.floor(totalWidth / larguraUtil);
  const remainder = totalWidth - nFullCols * larguraUtil;
  const nCols = remainder > 1 ? nFullCols + 1 : nFullCols;

  const columns = [];
  for (let c = 0; c < nCols; c++) {
    const x0 = b.minX + c * larguraUtil;
    const isCut = c === nCols - 1 && remainder > 1;
    const widthMM = isCut ? remainder : larguraUtil;
    const xSample = x0 + widthMM / 2;
    const { spans } = verticalCoverage(rotated, xSample);
    if (!spans.length) continue;
    // usa o maior vão coberto (limita geometrias muito côncavas na mesma faixa a um único trecho contínuo)
    const span = spans.reduce((a, s) => (s[1] - s[0] > a[1] - a[0] ? s : a), spans[0]);
    const runLength = span[1] - span[0];

    const tiers = buildTiers(runLength, lens, overlap, pingadeiraOn, pingadeira);
    columns.push({ index: c, x0, x1: x0 + widthMM, widthMM, isCut, y0: span[0], y1: span[1], runLength, tiers });
  }

  return finalize(agua, directionDeg, columns, profile, pingadeira, overlap);
}

function buildTiers(runLength, lens, overlap, pingadeiraOn, pingadeira) {
  const pingLen = pingadeiraOn ? pingadeira.comprimento : 0;
  const netRun = Math.max(0, runLength - pingLen); // desconta a região da pingadeira no vão

  if (netRun <= lens.max) {
    return [{ role: netRun === runLength ? 'unico' : 'unico', lengthMM: netRun, hasPingadeira: pingadeiraOn }];
  }

  // nº de faixas: usa o comprimento ideal como alvo para equilibrar as emendas
  let n = Math.ceil((netRun + overlap) / (lens.ideal + overlap));
  let tierLen = (netRun + (n - 1) * overlap) / n;
  // respeita o máximo
  while (tierLen > lens.max && n < 12) { n++; tierLen = (netRun + (n - 1) * overlap) / n; }
  // evita peça abaixo do mínimo — reduz nº de faixas se possível
  while (n > 1 && tierLen < lens.min) { n--; tierLen = (netRun + (n - 1) * overlap) / n; }

  const tiers = [];
  for (let i = 0; i < n; i++) {
    const role = n === 1 ? 'unico' : i === 0 ? 'superior' : i === n - 1 ? 'inferior' : 'intermediaria';
    tiers.push({ role, lengthMM: tierLen, hasPingadeira: pingadeiraOn && i === n - 1, seamOverlapMM: i < n - 1 ? overlap : 0 });
  }
  return tiers;
}

function finalize(agua, directionDeg, columns, profile, pingadeira, overlap) {
  const pesoM2 = profile.pesoM2 || 0;
  let areaUtil = 0, areaPerdida = 0, areaSobreposta = 0, comprimentoLinear = 0;
  let nTelhas = 0, nEmendas = 0, nPingadeiras = 0, pesoTotal = 0;
  const smallPieces = [];

  for (const col of columns) {
    const widthLossFromCut = col.isCut ? profile.larguraUtil - col.widthMM : 0;
    for (const tier of col.tiers) {
      nTelhas++;
      const areaPc = (col.widthMM / 1000) * (tier.lengthMM / 1000);
      areaUtil += areaPc;
      pesoTotal += areaPc * pesoM2;
      comprimentoLinear += tier.lengthMM / 1000;
      if (tier.seamOverlapMM) { areaSobreposta += (col.widthMM / 1000) * (tier.seamOverlapMM / 1000); nEmendas++; }
      if (tier.hasPingadeira) nPingadeiras++;
      if (tier.lengthMM < MIN_USEFUL_TIER) smallPieces.push(tier);
      // perda por recorte de largura (última coluna) e perda de aba, em área
      areaPerdida += (widthLossFromCut / 1000) * (tier.lengthMM / 1000) + (profile.aba.perda / 1000) * (tier.lengthMM / 1000);
    }
  }
  const areaTotal = areaUtil + areaPerdida;
  const wastePct = areaTotal > 0 ? (areaPerdida / areaTotal) * 100 : 0;
  const nCortes = columns.filter(c => c.isCut).length + columns.reduce((s, c) => s + Math.max(0, c.tiers.length - 1), 0);

  return {
    aguaId: agua.id, directionDeg, columns, overlap,
    summary: {
      areaTotal, areaUtil, areaPerdida, areaSobreposta, wastePct,
      nTelhas, nEmendas, nPingadeiras, pesoTotal, comprimentoLinear, nCortes,
      nPecasPequenas: smallPieces.length
    }
  };
}

function emptyResult(agua, directionDeg) {
  return { aguaId: agua.id, directionDeg, columns: [], overlap: 0, summary: { areaTotal: 0, areaUtil: 0, areaPerdida: 0, areaSobreposta: 0, wastePct: 0, nTelhas: 0, nEmendas: 0, nPingadeiras: 0, pesoTotal: 0, comprimentoLinear: 0, nCortes: 0, nPecasPequenas: 0 } };
}

function centroidOf(pts) {
  const b = polygonBounds(pts);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Busca heurística da melhor direção de assentamento das telhas.
// candidateAngles: além de 0/90, inclui os ângulos das arestas da água (coberturas trapezoidais/L/triangulares).
export function optimizeAgua(agua, profile, pingadeira, opts = {}) {
  const angles = new Set([0, 90]);
  for (let i = 0; i < agua.points.length; i++) {
    const a = agua.points[i], b = agua.points[(i + 1) % agua.points.length];
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
    angles.add(((ang % 180) + 180) % 180);
  }
  const pingadeiraOn = opts.pingadeiraOn !== false;
  const candidates = [...angles].map(directionDeg => {
    const result = distributeAgua(agua, profile, pingadeira, { directionDeg, pingadeiraOn });
    const s = result.summary;
    const score = s.wastePct * 3 + s.nCortes * 2 + s.nEmendas * 1.5 + s.nPecasPequenas * 5;
    return { directionDeg, result, score };
  }).filter(c => c.result.columns.length > 0);

  candidates.sort((a, b) => a.score - b.score);
  return { best: candidates[0] || null, candidates };
}

// Numera globalmente as peças (T-001…), emendas (E-001…) e pingadeiras (P-001…) de todo o projeto,
// na ordem: água → coluna → faixa (eave → cumeeira).
export function numberProject(resultsByAgua) {
  let t = 0, e = 0, p = 0;
  const pieces = [];
  for (const res of resultsByAgua) {
    for (const col of res.columns) {
      for (let i = 0; i < col.tiers.length; i++) {
        const tier = col.tiers[i];
        t++;
        const code = `T-${String(t).padStart(3, '0')}`;
        const color = pieceColor(col, tier);
        pieces.push({ code, aguaId: res.aguaId, colIndex: col.index, tierIndex: i, role: tier.role, color, lengthMM: tier.lengthMM, widthMM: col.widthMM, hasPingadeira: tier.hasPingadeira, seamOverlapMM: tier.seamOverlapMM || 0 });
        tier.code = code; tier.color = color;
        if (tier.seamOverlapMM) { e++; tier.seamCode = `E-${String(e).padStart(3, '0')}`; }
        if (tier.hasPingadeira) { p++; tier.pingadeiraCode = `P-${String(p).padStart(3, '0')}`; }
      }
    }
  }
  return { pieces, totals: { telhas: t, emendas: e, pingadeiras: p } };
}

function pieceColor(col, tier) {
  if (tier.role === 'superior') return 'blue';
  if (tier.role === 'inferior') return 'orange';
  if (tier.role === 'intermediaria') return 'blue';
  return col.isCut ? 'yellow' : 'green';
}

export { MIN_USEFUL_TIER };
