// Exportações do módulo avançado: CSV, DXF, PNG/SVG (mapa) e PDF (listas + mapas).
import { exportDXF } from './dxfio.js';

export function rowsToCSV(rows, columns) {
  const head = columns.map(c => c.label).join(';');
  const body = rows.map(r => columns.map(c => csvCell(r[c.key])).join(';')).join('\n');
  return head + '\n' + body;
}
function csvCell(v) { return String(v == null ? '' : v).replace(/;/g, ','); }

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportProjectDXF(project) {
  const shapes = project.aguas.map(a => ({ points: a.points, closed: a.closed }));
  downloadText((project.nome || 'projeto') + '.dxf', exportDXF(shapes), 'application/dxf');
}

export function exportSvgAsPNG(svgEl, filename, scale = 2) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  const vb = svgEl.viewBox.baseVal;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = vb.width * scale; canvas.height = vb.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1115'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  };
  img.src = svg64;
}

export function downloadSvg(svgEl, filename) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  downloadText(filename, xml, 'image/svg+xml');
}

export function generateAdvancedPDF(project, reports, manufacturingGroups, assemblyRows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14;
  let y = M;
  doc.setFontSize(14); doc.text(`Projeto: ${project.nome || 'Sem nome'}`, M, y); y += 8;
  doc.setFontSize(10); doc.text(`Cliente: ${project.cliente || '-'}   Obra: ${project.obra || '-'}`, M, y); y += 8;

  doc.setFontSize(12); doc.text('Relatórios', M, y); y += 6;
  doc.setFontSize(9);
  const repLines = [
    `Área total: ${reports.areaTotal.toFixed(2)} m²    Área útil: ${reports.areaUtil.toFixed(2)} m²    Área perdida: ${reports.areaPerdida.toFixed(2)} m² (${reports.wastePct}%)`,
    `Área sobreposta: ${reports.areaSobreposta.toFixed(2)} m²    Telhas: ${reports.nTelhas}    Emendas: ${reports.nEmendas}    Pingadeiras: ${reports.nPingadeiras}`,
    `Peso total: ${reports.pesoTotal} kg    Comprimento linear: ${reports.comprimentoLinear} m    Perímetro: ${reports.perimetroM} m`,
    `Parafusos estimados: ${reports.parafusosEstimados}    Fita de vedação: ${reports.fitaVedacaoM} m    Arremates: ${reports.arrematesM} m`
  ];
  repLines.forEach(l => { doc.text(l, M, y); y += 5; });
  y += 4;

  doc.setFontSize(12); doc.text('Lista de fabricação (resumo)', M, y); y += 6;
  doc.setFontSize(8);
  doc.text('Comp(mm)  Larg(mm)  Esp(mm)  Tipo                  Qtd   Peso(kg)  Área(m²)', M, y); y += 4;
  for (const g of manufacturingGroups) {
    if (y > 280) { doc.addPage(); y = M; }
    doc.text(`${g.comprimento}       ${g.largura}      ${g.espessura}      ${g.tipo.padEnd(20)}  ${g.quantidade}     ${g.pesoTotal}     ${g.areaTotal}`, M, y);
    y += 4.5;
  }

  doc.addPage(); y = M;
  doc.setFontSize(12); doc.text('Lista de montagem', M, y); y += 6;
  doc.setFontSize(8);
  for (const r of assemblyRows) {
    if (y > 280) { doc.addPage(); y = M; }
    doc.text(`${r.seq}. ${r.codigo} — ${r.agua} — ${r.posicao} ${r.local ? '(' + r.local + ')' : ''}`, M, y);
    y += 4.5;
  }

  doc.save((project.nome || 'projeto') + '-avancado.pdf');
}
