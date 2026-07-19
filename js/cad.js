// Editor CAD 2D simplificado: desenha "águas" (planos de cobertura) como polígonos,
// em milímetros, com grid, snap, zoom/pan infinito, régua e cotas automáticas.
import { polygonBounds, distance, rotatePolygon, scalePolygon, translatePolygon,
         mirrorPolygon, snapToGrid, nearestSnapPoint, polygonCentroid, degToRad } from './geometry.js';

const COLORS = {
  agua: '#3a6ea5', aguaFill: 'rgba(58,110,165,.18)', aguaSel: '#e0a32e',
  ref: '#5a6270', grid: '#232830', gridMajor: '#2b313a', axis: '#3a404a',
  dim: '#8b9098', text: '#e7eaee', vertex: '#e7eaee'
};

let uid = 1;
export function nextId(prefix) { return `${prefix || 'e'}${uid++}`; }

export class CadEditor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.entities = []; // {id, kind:'agua'|'ref', points:[{x,y}], closed, label, refImage?}
    this.refImage = null; // {img, x,y,w,h} imagem de fundo (PDF importado)
    this.scale = 0.06; // px por mm
    this.offset = { x: 60, y: 40 }; // px
    this.tool = 'select';
    this.gridSize = 100; // mm
    this.snapEnabled = true;
    this.drawing = null; // pontos em progresso
    this.selectedId = null;
    this.selectedVertex = -1;
    this.dragging = null;
    this.panning = null;
    this.mirrorPick = null;
    this.onChange = opts.onChange || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.history = [];
    this.future = [];
    this._bind();
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(320, rect.width) * dpr;
    this.canvas.height = 520 * dpr;
    this.canvas.style.width = Math.max(320, rect.width) + 'px';
    this.canvas.style.height = '520px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  // --- transformações de tela <-> mundo (mm) ---
  toScreen(p) { return { x: this.offset.x + p.x * this.scale, y: this.offset.y + p.y * this.scale }; }
  toWorld(p) { return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale }; }

  pushHistory() {
    this.history.push(JSON.stringify(this.entities));
    if (this.history.length > 60) this.history.shift();
    this.future = [];
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.entities));
    this.entities = JSON.parse(this.history.pop());
    this.selectedId = null;
    this.render(); this.onChange();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.entities));
    this.entities = JSON.parse(this.future.pop());
    this.render(); this.onChange();
  }

  setTool(t) {
    this.tool = t;
    this.drawing = null;
    this.mirrorPick = null;
    this.render();
  }

  getSelected() { return this.entities.find(e => e.id === this.selectedId) || null; }

  addAgua(points, label) {
    this.pushHistory();
    const e = { id: nextId('agua'), kind: 'agua', points, closed: true, label: label || `Água ${this.entities.filter(x => x.kind === 'agua').length + 1}` };
    this.entities.push(e);
    this.selectedId = e.id;
    this.render(); this.onChange();
    this.onSelect(e);
    return e;
  }

  deleteSelected() {
    if (!this.selectedId) return;
    this.pushHistory();
    this.entities = this.entities.filter(e => e.id !== this.selectedId);
    this.selectedId = null;
    this.render(); this.onChange();
  }

  copySelected(dx = 500, dy = 500) {
    const e = this.getSelected();
    if (!e) return;
    this.pushHistory();
    const copy = { ...e, id: nextId(e.kind), points: translatePolygon(e.points, dx, dy), label: e.label + ' (cópia)' };
    this.entities.push(copy);
    this.selectedId = copy.id;
    this.render(); this.onChange();
  }

  rotateSelected(angleDeg) {
    const e = this.getSelected();
    if (!e) return;
    this.pushHistory();
    const c = polygonCentroid(e.points);
    e.points = rotatePolygon(e.points, degToRad(angleDeg), c);
    this.render(); this.onChange();
  }

  scaleSelected(factor) {
    const e = this.getSelected();
    if (!e) return;
    this.pushHistory();
    e.points = scalePolygon(e.points, factor, factor);
    this.render(); this.onChange();
  }

  startMirror() {
    this.tool = 'mirror';
    this.mirrorPick = [];
  }

  setRefImage(img, wMM, hMM) {
    this.refImage = { img, x: 0, y: 0, w: wMM, h: hMM };
    this.render();
  }

  clearRefImage() { this.refImage = null; this.render(); }

  importDxfEntities(lines) {
    // lines: array de arrays de pontos {x,y} em mm (já convertidos pelo dxf.js)
    this.pushHistory();
    for (const pts of lines) {
      this.entities.push({ id: nextId('ref'), kind: 'ref', points: pts, closed: pts.length > 2 && distance(pts[0], pts[pts.length - 1]) < 1, label: 'Importado DXF' });
    }
    this.render(); this.onChange();
  }

  promoteRefToAgua(id) {
    const e = this.entities.find(x => x.id === id);
    if (!e) return;
    this.pushHistory();
    e.kind = 'agua'; e.closed = true;
    e.label = `Água ${this.entities.filter(x => x.kind === 'agua').length}`;
    this.render(); this.onChange();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._pointerDown(e));
    c.addEventListener('pointermove', e => this._pointerMove(e));
    window.addEventListener('pointerup', e => this._pointerUp(e));
    c.addEventListener('wheel', e => this._wheel(e), { passive: false });
    c.addEventListener('dblclick', e => this._finishDrawing());
    window.addEventListener('resize', () => this.resize());
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  _mousePos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _snap(worldPt) {
    let p = worldPt;
    if (this.snapEnabled) {
      const objSnap = nearestSnapPoint(p, this.entities.map(e => e.points), 20 / this.scale);
      if (objSnap) return { x: objSnap.x, y: objSnap.y };
      p = snapToGrid(p, this.gridSize / 2);
    }
    return p;
  }

  _pointerDown(e) {
    const screen = this._mousePos(e);
    const world = this._snap(this.toWorld(screen));

    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      this.panning = { startScreen: screen, startOffset: { ...this.offset } };
      return;
    }

    if (this.tool === 'select') {
      this._trySelect(screen, world);
      return;
    }
    if (this.tool === 'move') {
      const hit = this._hitEntity(world);
      if (hit) { this.selectedId = hit.id; this.dragging = { mode: 'move', start: world, orig: hit.points.map(p => ({ ...p })) }; this.onSelect(hit); }
      return;
    }
    if (this.tool === 'mirror') {
      this.mirrorPick.push(world);
      if (this.mirrorPick.length === 2) {
        const e2 = this.getSelected();
        if (e2) { this.pushHistory(); e2.points = mirrorPolygon(e2.points, this.mirrorPick[0], this.mirrorPick[1]); this.onChange(); }
        this.mirrorPick = [];
        this.tool = 'select';
      }
      this.render();
      return;
    }
    // ferramentas de desenho: line, polyline, rect, polygon
    if (['line', 'polyline', 'rect', 'polygon'].includes(this.tool)) {
      if (!this.drawing) this.drawing = { tool: this.tool, points: [world] };
      else {
        this.drawing.points.push(world);
        if (this.tool === 'line' || this.tool === 'rect') this._finishDrawing();
      }
      this.render();
    }
  }

  _pointerMove(e) {
    const screen = this._mousePos(e);
    this.lastScreen = screen;
    const world = this._snap(this.toWorld(screen));
    this.hoverWorld = world;

    if (this.panning) {
      this.offset = { x: this.panning.startOffset.x + (screen.x - this.panning.startScreen.x), y: this.panning.startOffset.y + (screen.y - this.panning.startScreen.y) };
      this.render();
      return;
    }
    if (this.dragging && this.dragging.mode === 'move') {
      const ent = this.getSelected();
      const dx = world.x - this.dragging.start.x, dy = world.y - this.dragging.start.y;
      ent.points = this.dragging.orig.map(p => ({ x: p.x + dx, y: p.y + dy }));
      this.render();
      return;
    }
    if (this.dragging && this.dragging.mode === 'vertex') {
      const ent = this.getSelected();
      ent.points[this.selectedVertex] = world;
      this.render();
      return;
    }
    if (this.drawing) this.render();
    else if (this.tool === 'select' || this.tool === 'mirror') this.render();
  }

  _pointerUp() {
    if (this.dragging) { this.pushHistory(); this.entities; this.onChange(); }
    this.dragging = null;
    this.panning = null;
  }

  _wheel(e) {
    e.preventDefault();
    const screen = this._mousePos(e);
    const worldBefore = this.toWorld(screen);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.scale = Math.min(2, Math.max(0.002, this.scale * factor));
    const worldAfter = this.toWorld(screen);
    this.offset.x += (worldAfter.x - worldBefore.x) * this.scale;
    this.offset.y += (worldAfter.y - worldBefore.y) * this.scale;
    this.render();
  }

  _trySelect(screen, world) {
    // primeiro tenta vértice do selecionado
    const sel = this.getSelected();
    if (sel) {
      for (let i = 0; i < sel.points.length; i++) {
        if (distance(this.toScreen(sel.points[i]), screen) < 9) {
          this.selectedVertex = i;
          this.dragging = { mode: 'vertex' };
          return;
        }
      }
    }
    const hit = this._hitEntity(world);
    this.selectedId = hit ? hit.id : null;
    this.selectedVertex = -1;
    if (hit) {
      this.dragging = { mode: 'move', start: world, orig: hit.points.map(p => ({ ...p })) };
      this.onSelect(hit);
    } else this.onSelect(null);
    this.render();
  }

  _hitEntity(world) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (pointInPolygon(world, e.points)) return e;
      for (let j = 0; j < e.points.length; j++) {
        const a = e.points[j], b = e.points[(j + 1) % e.points.length];
        if (!e.closed && j === e.points.length - 1) continue;
        if (distToSeg(world, a, b) < 15 / this.scale) return e;
      }
    }
    return null;
  }

  _finishDrawing() {
    if (!this.drawing) return;
    const { tool, points } = this.drawing;
    let finalPts = points;
    if (tool === 'rect' && points.length >= 2) {
      const [a, b] = points;
      finalPts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
    }
    if (finalPts.length >= 2) {
      const isClosed = tool !== 'polyline' || finalPts.length > 2;
      this.addAgua(finalPts, undefined);
      this.entities[this.entities.length - 1].closed = tool !== 'polyline';
    }
    this.drawing = null;
    this.setTool('select');
  }

  // --- render ---
  render() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, rect.width, rect.height);

    this._drawGrid(rect);
    if (this.refImage && this.refImage.img) this._drawRefImage();
    for (const e of this.entities) this._drawEntity(e);
    if (this.drawing) this._drawInProgress();
    if (this.tool === 'mirror' && this.mirrorPick && this.mirrorPick.length === 1) {
      const p = this.toScreen(this.mirrorPick[0]);
      ctx.fillStyle = COLORS.aguaSel; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
    }
    this._drawRulers(rect);
  }

  _drawRefImage() {
    const ctx = this.ctx, r = this.refImage;
    const p0 = this.toScreen({ x: r.x, y: r.y });
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(r.img, p0.x, p0.y, r.w * this.scale, r.h * this.scale);
    ctx.restore();
  }

  _drawGrid(rect) {
    const ctx = this.ctx;
    let g = this.gridSize;
    while (g * this.scale < 18) g *= 5;
    while (g * this.scale > 140) g /= 5;
    const startWorld = this.toWorld({ x: 0, y: 0 });
    const endWorld = this.toWorld({ x: rect.width, y: rect.height });
    const x0 = Math.floor(startWorld.x / g) * g, x1 = Math.ceil(endWorld.x / g) * g;
    const y0 = Math.floor(startWorld.y / g) * g, y1 = Math.ceil(endWorld.y / g) * g;
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += g) {
      const sx = this.toScreen({ x, y: 0 }).x;
      ctx.strokeStyle = Math.round(x / (g * 5)) * (g * 5) === x ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height); ctx.stroke();
    }
    for (let y = y0; y <= y1; y += g) {
      const sy = this.toScreen({ x: 0, y }).y;
      ctx.strokeStyle = Math.round(y / (g * 5)) * (g * 5) === y ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy); ctx.stroke();
    }
    // eixos 0,0
    const origin = this.toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, rect.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(rect.width, origin.y); ctx.stroke();
  }

  _drawRulers(rect) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(15,17,21,.85)';
    ctx.fillRect(0, 0, rect.width, 18);
    ctx.fillRect(0, 0, 18, rect.height);
    ctx.fillStyle = COLORS.dim; ctx.font = '10px monospace';
    let g = this.gridSize;
    while (g * this.scale < 60) g *= 5;
    while (g * this.scale > 200) g /= 5;
    const startWorld = this.toWorld({ x: 0, y: 0 });
    const endWorld = this.toWorld({ x: rect.width, y: rect.height });
    for (let x = Math.floor(startWorld.x / g) * g; x <= endWorld.x; x += g) {
      const sx = this.toScreen({ x, y: 0 }).x;
      ctx.fillText((x / 1000).toFixed(1) + 'm', sx + 2, 12);
    }
  }

  _drawInProgress() {
    const ctx = this.ctx;
    const pts = this.drawing.points.slice();
    if (this.hoverWorld) pts.push(this.hoverWorld);
    ctx.strokeStyle = COLORS.aguaSel; ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    if (this.drawing.tool === 'rect' && pts.length === 2) {
      const [a, b] = pts.map(p => this.toScreen(p));
      ctx.closePath();
      ctx.beginPath();
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawEntity(e) {
    const ctx = this.ctx;
    const pts = e.points.map(p => this.toScreen(p));
    if (!pts.length) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (e.closed) ctx.closePath();
    const isSel = e.id === this.selectedId;
    if (e.kind === 'agua') {
      ctx.fillStyle = COLORS.aguaFill; ctx.fill();
      ctx.strokeStyle = isSel ? COLORS.aguaSel : COLORS.agua;
    } else {
      ctx.strokeStyle = isSel ? COLORS.aguaSel : COLORS.ref;
    }
    ctx.lineWidth = isSel ? 2.5 : 1.6;
    ctx.stroke();

    // vértices
    if (isSel) {
      ctx.fillStyle = COLORS.vertex;
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 7); ctx.fill(); });
    }

    // cotas automáticas nas arestas
    if (e.kind === 'agua') {
      ctx.fillStyle = COLORS.dim; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      for (let i = 0; i < e.points.length; i++) {
        if (!e.closed && i === e.points.length - 1) continue;
        const a = e.points[i], b = e.points[(i + 1) % e.points.length];
        const len = distance(a, b);
        const mid = this.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        ctx.fillText(Math.round(len) + 'mm', mid.x, mid.y - 5);
      }
      if (e.label) {
        const c = this.toScreen(polygonCentroid(e.points));
        ctx.fillStyle = COLORS.text; ctx.font = 'bold 12px sans-serif';
        ctx.fillText(e.label, c.x, c.y);
      }
    }
    ctx.textAlign = 'left';
  }
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
