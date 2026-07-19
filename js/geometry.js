// Geometria 2D básica usada pelo editor CAD e pelo motor de distribuição.
// Coordenadas de projeto em milímetros; polígonos são arrays de {x,y}.

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
}

export function polygonBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function polygonCentroid(pts) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    const cross = p1.x * p2.y - p2.x * p1.y;
    a += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  a = a / 2;
  if (Math.abs(a) < 1e-9) {
    const b = polygonBounds(pts);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function rotatePoint(p, angleRad, center) {
  const c = center || { x: 0, y: 0 };
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function rotatePolygon(pts, angleRad, center) {
  return pts.map(p => rotatePoint(p, angleRad, center));
}

export function scalePolygon(pts, sx, sy, center) {
  const c = center || polygonCentroid(pts);
  return pts.map(p => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy }));
}

export function translatePolygon(pts, dx, dy) {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

// Espelha os pontos em relação à reta definida por a-b.
export function mirrorPolygon(pts, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  return pts.map(p => {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const projX = a.x + t * dx, projY = a.y + t * dy;
    return { x: 2 * projX - p.x, y: 2 * projY - p.y };
  });
}

export function snapToGrid(p, gridSize) {
  if (!gridSize) return p;
  return { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize };
}

// Ponto mais próximo entre os vértices/arestas de um conjunto de polígonos (para snap a objetos).
export function nearestSnapPoint(pt, polygons, tolerance) {
  let best = null, bestD = tolerance;
  for (const poly of polygons) {
    for (const v of poly) {
      const d = distance(pt, v);
      if (d < bestD) { bestD = d; best = { x: v.x, y: v.y, kind: 'vertex' }; }
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const proj = closestPointOnSegment(pt, a, b);
      const d = distance(pt, proj);
      if (d < bestD) { bestD = d; best = { x: proj.x, y: proj.y, kind: 'edge' }; }
    }
  }
  return best;
}

export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Interseções de uma reta vertical x=xv com as arestas do polígono; retorna Ys ordenados.
export function verticalScan(polygon, xv) {
  const ys = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.x <= xv && b.x > xv) || (b.x <= xv && a.x > xv)) {
      const t = (xv - a.x) / (b.x - a.x);
      ys.push(a.y + t * (b.y - a.y));
    }
  }
  return ys.sort((p, q) => p - q);
}

// Comprimento coberto pelo polígono ao longo de x=xv (soma dos pares de interseção).
export function verticalCoverage(polygon, xv) {
  const ys = verticalScan(polygon, xv);
  let total = 0, spans = [];
  for (let i = 0; i + 1 < ys.length; i += 2) {
    total += ys[i + 1] - ys[i];
    spans.push([ys[i], ys[i + 1]]);
  }
  return { total, spans };
}

export function degToRad(d) { return d * Math.PI / 180; }
export function radToDeg(r) { return r * 180 / Math.PI; }
