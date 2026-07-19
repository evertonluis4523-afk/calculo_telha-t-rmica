// Listas de fabricação e montagem, e relatórios consolidados (itens 12, 13 e 14 da especificação).
import { polygonArea } from './geometry.js';

export function buildManufacturingList(project, resultsByAgua, profile) {
  const rows = [];
  for (const res of resultsByAgua) {
    const agua = project.aguas.find(a => a.id === res.aguaId);
    for (const col of res.columns) {
      for (const tier of col.tiers) {
        rows.push({
          codigo: tier.code, agua: agua ? agua.label : res.aguaId, coluna: col.index + 1,
          comprimento: Math.round(tier.lengthMM), largura: Math.round(col.widthMM),
          espessura: profile.espessura, tipo: labelRole(tier.role), cor: tier.color,
          peso: +(((col.widthMM / 1000) * (tier.lengthMM / 1000) * (profile.pesoM2 || 0)).toFixed(2)),
          area: +(((col.widthMM / 1000) * (tier.lengthMM / 1000)).toFixed(3)),
          observacoes: [tier.seamCode ? `emenda ${tier.seamCode}` : '', tier.hasPingadeira ? `pingadeira ${tier.pingadeiraCode}` : ''].filter(Boolean).join('; ')
        });
      }
    }
  }
  return rows;
}

export function groupManufacturingList(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.comprimento, r.largura, r.espessura, r.tipo].join('|');
    if (!map.has(key)) map.set(key, { comprimento: r.comprimento, largura: r.largura, espessura: r.espessura, tipo: r.tipo, quantidade: 0, pesoTotal: 0, areaTotal: 0, codigos: [] });
    const g = map.get(key);
    g.quantidade++; g.pesoTotal += r.peso; g.areaTotal += r.area; g.codigos.push(r.codigo);
  }
  return [...map.values()].map(g => ({ ...g, pesoTotal: +g.pesoTotal.toFixed(2), areaTotal: +g.areaTotal.toFixed(3) }));
}

export function buildAssemblyList(project, resultsByAgua) {
  const rows = [];
  let seq = 0;
  for (const res of resultsByAgua) {
    const agua = project.aguas.find(a => a.id === res.aguaId);
    for (const col of res.columns) {
      // ordem de montagem: da pingadeira/inferior para a cumeeira/superior (i.e. de trás pra frente na lista de tiers)
      const ordered = [...col.tiers].reverse();
      for (const tier of ordered) {
        seq++;
        rows.push({
          seq, codigo: tier.code, agua: agua ? agua.label : res.aguaId,
          posicao: `Coluna ${col.index + 1}`, sentido: tier.role === 'inferior' ? 'Eave → cumeeira (iniciar aqui)' : '—',
          local: tier.hasPingadeira ? `com pingadeira ${tier.pingadeiraCode}` : (tier.seamCode ? `emenda ${tier.seamCode} com a peça seguinte` : '')
        });
      }
    }
  }
  return rows;
}

export function buildReports(project, resultsByAgua) {
  const s = { areaTotal: 0, areaUtil: 0, areaPerdida: 0, areaSobreposta: 0, nTelhas: 0, nEmendas: 0, nPingadeiras: 0, pesoTotal: 0, comprimentoLinear: 0 };
  for (const r of resultsByAgua) {
    for (const k of Object.keys(s)) s[k] += r.summary[k] || 0;
  }
  const perimetro = project.aguas.reduce((sum, a) => sum + perimeterOf(a.points), 0) / 1000; // m
  const parafusosPorM2 = 6; // referência de mercado; ajustável conforme especificação do fabricante
  const fitaVedacaoM = s.nEmendas > 0 ? resultsByAgua.reduce((sum, r) => sum + r.columns.reduce((s2, c) => s2 + c.widthMM * c.tiers.filter(t => t.seamOverlapMM).length, 0), 0) / 1000 : 0;
  return {
    ...s,
    wastePct: s.areaTotal > 0 ? +(100 * s.areaPerdida / s.areaTotal).toFixed(1) : 0,
    perimetroM: +perimetro.toFixed(1),
    parafusosEstimados: Math.ceil(s.areaUtil * parafusosPorM2),
    fitaVedacaoM: +fitaVedacaoM.toFixed(1),
    arrematesM: +perimetro.toFixed(1),
    pesoTotal: +s.pesoTotal.toFixed(1),
    comprimentoLinear: +s.comprimentoLinear.toFixed(1)
  };
}

function labelRole(role) {
  return { unico: 'Peça única', superior: 'Peça superior', inferior: 'Peça inferior', intermediaria: 'Peça intermediária' }[role] || role;
}

function perimeterOf(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

export { polygonArea };
