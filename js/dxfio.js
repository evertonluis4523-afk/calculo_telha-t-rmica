// Import/export DXF (linework simples) e import de PDF como imagem de referência.
// Observação: DWG é um formato binário proprietário — não há leitor/gravador confiável
// em JS puro no navegador. Import/export DWG não é suportado; a alternativa recomendada
// é exportar o DWG como DXF em outro software (AutoCAD, LibreCAD, etc.) antes de importar aqui.

// --- Parser DXF minimalista: lê pares de código de grupo e trata ENTITIES (LINE, LWPOLYLINE, POLYLINE) ---
export function parseDXF(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  }
  const shapes = [];
  let i = 0;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0 && val === 'LINE') {
      const pt = readEntityFields(pairs, i, { 10: 'x1', 20: 'y1', 11: 'x2', 21: 'y2' });
      if (pt.x1 != null) shapes.push([{ x: pt.x1, y: pt.y1 }, { x: pt.x2, y: pt.y2 }]);
    } else if (code === 0 && (val === 'LWPOLYLINE' || val === 'POLYLINE')) {
      const { pts, endIndex } = readPolylineVertices(pairs, i, val);
      if (pts.length >= 2) shapes.push(pts);
      i = endIndex;
      continue;
    }
    i++;
  }
  return shapes;
}

function readEntityFields(pairs, startIdx, map) {
  const out = {};
  for (let i = startIdx + 1; i < pairs.length; i++) {
    const [code] = pairs[i];
    if (code === 0) break;
    if (map[code] !== undefined) out[map[code]] = parseFloat(pairs[i][1]);
  }
  return out;
}

function readPolylineVertices(pairs, startIdx, kind) {
  const pts = [];
  let cur = {};
  let i = startIdx + 1;
  for (; i < pairs.length; i++) {
    const [code, val] = pairs[i];
    if (code === 0) {
      if (val === 'VERTEX') { cur = {}; continue; }
      if (val === 'SEQEND') { i++; break; }
      if (cur.x != null) { pts.push(cur); cur = {}; }
      if (val !== 'VERTEX') break;
    }
    if (code === 10) { if (cur.x != null) { pts.push(cur); cur = {}; } cur.x = parseFloat(val); }
    if (code === 20) cur.y = parseFloat(val);
  }
  if (cur.x != null) pts.push(cur);
  return { pts, endIndex: i };
}

// --- Export DXF: recebe lista de polígonos [{points:[{x,y}], closed}] em mm ---
export function exportDXF(shapes) {
  let out = '0\nSECTION\n2\nENTITIES\n';
  for (const s of shapes) {
    const pts = s.points;
    out += '0\nLWPOLYLINE\n8\n0\n90\n' + pts.length + '\n70\n' + (s.closed ? 1 : 0) + '\n';
    for (const p of pts) out += `10\n${p.x.toFixed(2)}\n20\n${p.y.toFixed(2)}\n`;
  }
  out += '0\nENDSEC\n0\nEOF\n';
  return out;
}

// --- Import PDF (primeira página) como imagem de referência, via pdf.js (CDN) ---
let pdfjsLoading = null;
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

// Retorna {img: HTMLImageElement, widthPx, heightPx}. mmPerPixel deve ser informado pelo usuário
// (escala do PDF) já que o PDF não carrega informação de escala real de desenho.
export async function importPdfFirstPageAsImage(file) {
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  return { img, widthPx: viewport.width, heightPx: viewport.height };
}
