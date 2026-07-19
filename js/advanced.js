// Glue do módulo "Projeto avançado": estado do projeto, catálogo, editor CAD,
// motor de distribuição, mapa, listas, relatórios e exportações.
import { CadEditor } from './cad.js';
import { loadCatalog, saveCatalog, upsertProfile, deleteProfile, upsertPingadeira, deletePingadeira, CORE_TYPES, JOINT_TYPES, uid } from './catalog.js';
import { optimizeAgua, numberProject } from './distribution.js';
import { renderAguaMapSVG } from './mapview.js';
import { buildManufacturingList, groupManufacturingList, buildAssemblyList, buildReports } from './lists.js';
import { parseDXF, importPdfFirstPageAsImage } from './dxfio.js';
import { rowsToCSV, downloadText, exportProjectDXF, exportSvgAsPNG, downloadSvg, generateAdvancedPDF } from './exportadv.js';

const PROJECTS_KEY = 'rm_telha_avancado_projetos';
const $ = id => document.getElementById(id);

let catalog = loadCatalog();
let editor = null;
let currentResults = []; // [{aguaId, ...distributeAgua result com peças numeradas}]
let currentProject = { id: null, nome: '', cliente: '', obra: '', data: '' };

export function initAdvancedMode() {
  editor = new CadEditor($('cadCanvas'), { onChange: onGeometryChange, onSelect: onSelectAgua });
  bindToolbar();
  bindCatalogUI();
  bindProjectUI();
  renderCatalogSelectors();
  renderProfileList();
  renderPingadeiraList();
  renderAguaList();
  window.addEventListener('resize', () => editor.resize());
}

export function resizeCad() { if (editor) editor.resize(); }

// ---------- Toolbar / editor ----------
function bindToolbar() {
  document.querySelectorAll('#cadToolbar [data-tool]').forEach(b => b.addEventListener('click', () => {
    editor.setTool(b.dataset.tool);
    document.querySelectorAll('#cadToolbar [data-tool]').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('cadUndo').addEventListener('click', () => editor.undo());
  $('cadRedo').addEventListener('click', () => editor.redo());
  $('cadDelete').addEventListener('click', () => editor.deleteSelected());
  $('cadCopy').addEventListener('click', () => editor.copySelected());
  $('cadRotate').addEventListener('click', () => {
    const v = prompt('Ângulo de rotação (graus):', '90');
    if (v != null && v !== '') editor.rotateSelected(parseFloat(v));
  });
  $('cadScale').addEventListener('click', () => {
    const v = prompt('Fator de escala (ex.: 1.1 para +10%):', '1');
    if (v != null && v !== '') editor.scaleSelected(parseFloat(v));
  });
  $('cadMirror').addEventListener('click', () => { editor.startMirror(); alert('Clique dois pontos no canvas para definir o eixo de espelhamento.'); });
  $('cadSnap').addEventListener('change', e => { editor.snapEnabled = e.target.checked; });

  $('importDxf').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const shapes = parseDXF(text);
    editor.importDxfEntities(shapes);
    renderAguaList();
    e.target.value = '';
  });
  $('importPdf').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const { img, widthPx, heightPx } = await importPdfFirstPageAsImage(f);
      const mmPerPx = parseFloat(prompt('Escala do PDF: quantos mm reais equivalem a 1 pixel da imagem importada?\n(Dica: meça uma cota conhecida no desenho após importar e ajuste; valor inicial aproximado)', '5')) || 5;
      editor.setRefImage(img, widthPx * mmPerPx, heightPx * mmPerPx);
    } catch (err) {
      alert('Não foi possível importar o PDF: ' + err.message);
    }
    e.target.value = '';
  });
  $('clearRef').addEventListener('click', () => editor.clearRefImage());

  $('aguaLabel').addEventListener('input', e => {
    const a = editor.getSelected(); if (!a) return;
    a.label = e.target.value; editor.render(); renderAguaList();
  });
  $('aguaProfile').addEventListener('change', e => {
    const a = editor.getSelected(); if (!a) return;
    a.profileId = e.target.value || null; renderAguaList();
  });
  $('aguaPingOn').addEventListener('change', e => {
    const a = editor.getSelected(); if (!a) return;
    a.pingadeiraOn = e.target.checked; renderAguaList();
  });
  $('aguaPromote').addEventListener('click', () => {
    const a = editor.getSelected(); if (!a) return;
    editor.promoteRefToAgua(a.id); renderAguaList(); onSelectAgua(a);
  });
}

function onGeometryChange() { renderAguaList(); }

function onSelectAgua(entity) {
  const panel = $('aguaPanel');
  if (!entity) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  $('aguaLabel').value = entity.label || '';
  $('aguaPromote').style.display = entity.kind === 'ref' ? 'inline-block' : 'none';
  $('aguaProfileRow').style.display = entity.kind === 'agua' ? 'flex' : 'none';
  $('aguaPingRow').style.display = entity.kind === 'agua' ? 'flex' : 'none';
  if (entity.kind === 'agua') {
    $('aguaProfile').value = entity.profileId || '';
    $('aguaPingOn').checked = entity.pingadeiraOn !== false;
  }
}

function renderAguaList() {
  const aguas = editor.entities.filter(e => e.kind === 'agua');
  $('aguaCount').textContent = aguas.length;
  const list = $('aguaListBody');
  list.innerHTML = aguas.map(a => {
    const prof = catalog.profiles.find(p => p.id === a.profileId);
    return `<tr data-id="${a.id}"><td>${escHtml(a.label)}</td><td>${prof ? escHtml(prof.nome) : '<span style="color:var(--muted)">— definir —</span>'}</td>
      <td class="act"><button class="btn ghost sel" data-sel="${a.id}" style="padding:4px 8px;font-size:11px">Selecionar</button></td></tr>`;
  }).join('') || `<tr><td colspan="3" style="color:var(--muted)">Nenhuma água desenhada ainda.</td></tr>`;
  list.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => {
    editor.selectedId = b.dataset.sel; editor.render(); onSelectAgua(editor.getSelected());
  }));
}

// ---------- Catálogo ----------
function bindCatalogUI() {
  $('profNucleo').innerHTML = CORE_TYPES.map(c => `<option>${c}</option>`).join('');
  $('profEncaixe').innerHTML = JOINT_TYPES.map(c => `<option>${c}</option>`).join('');
  $('profNew').addEventListener('click', () => loadProfileForm(null));
  $('profSave').addEventListener('click', saveProfileForm);
  $('profCancel').addEventListener('click', () => loadProfileForm(null));
  $('pingNew').addEventListener('click', () => loadPingForm(null));
  $('pingSave').addEventListener('click', savePingForm);
  loadProfileForm(null);
  loadPingForm(null);
}

function loadProfileForm(profile) {
  const f = profile || { nome: '', fabricante: '', modelo: '', espessura: 30, larguraUtil: 1020, larguraTotal: 1060, alturaPerfil: 30, chapaSup: 0.4, chapaInf: 0.4, nucleo: 'EPS', encaixe: '1 aba', pesoM2: 9.5, aba: { largura: 60, altura: 30, sobreposicaoMin: 100, sobreposicaoMax: 200, perda: 15, tolerancia: 3 }, comprimentos: { min: 1000, max: 13750, ideal: 12000, transporte: 12500, especial: 13750 } };
  $('profId').value = profile ? profile.id : '';
  const map = { profNome: f.nome, profFabricante: f.fabricante, profModelo: f.modelo, profEspessura: f.espessura, profLargUtil: f.larguraUtil, profLargTotal: f.larguraTotal, profAltura: f.alturaPerfil, profChapaSup: f.chapaSup, profChapaInf: f.chapaInf, profPeso: f.pesoM2, abaLargura: f.aba.largura, abaAltura: f.aba.altura, abaSobMin: f.aba.sobreposicaoMin, abaSobMax: f.aba.sobreposicaoMax, abaPerda: f.aba.perda, abaToler: f.aba.tolerancia, lenMin: f.comprimentos.min, lenMax: f.comprimentos.max, lenIdeal: f.comprimentos.ideal, lenTransp: f.comprimentos.transporte, lenEspecial: f.comprimentos.especial };
  Object.entries(map).forEach(([id, v]) => { $(id).value = v; });
  $('profNucleo').value = f.nucleo; $('profEncaixe').value = f.encaixe;
}

function saveProfileForm() {
  const profile = {
    id: $('profId').value || undefined,
    nome: $('profNome').value.trim() || 'Perfil sem nome', fabricante: $('profFabricante').value.trim(),
    modelo: $('profModelo').value.trim(), espessura: num('profEspessura'), larguraUtil: num('profLargUtil'),
    larguraTotal: num('profLargTotal'), alturaPerfil: num('profAltura'), chapaSup: num('profChapaSup'),
    chapaInf: num('profChapaInf'), nucleo: $('profNucleo').value, encaixe: $('profEncaixe').value, pesoM2: num('profPeso'),
    aba: { largura: num('abaLargura'), altura: num('abaAltura'), sobreposicaoMin: num('abaSobMin'), sobreposicaoMax: num('abaSobMax'), perda: num('abaPerda'), tolerancia: num('abaToler') },
    comprimentos: { min: num('lenMin'), max: num('lenMax'), ideal: num('lenIdeal'), transporte: num('lenTransp'), especial: num('lenEspecial') }
  };
  upsertProfile(catalog, profile);
  renderProfileList(); renderCatalogSelectors(); loadProfileForm(null);
}

function renderProfileList() {
  $('profList').innerHTML = catalog.profiles.map(p => `
    <div class="exitem"><span class="lbl">${escHtml(p.nome)} — ${escHtml(p.fabricante)} · ${p.larguraUtil}mm útil · núcleo ${p.nucleo} · máx ${p.comprimentos.max}mm</span>
      <span><button class="ed" data-edit="${p.id}" title="Editar">✎</button><button class="x" data-del="${p.id}" title="Excluir">×</button></span></div>`).join('');
  $('profList').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => loadProfileForm(catalog.profiles.find(p => p.id === b.dataset.edit))));
  $('profList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Excluir este perfil de telha?')) { deleteProfile(catalog, b.dataset.del); renderProfileList(); renderCatalogSelectors(); } }));
}

function loadPingForm(p) {
  const f = p || { nome: '', comprimento: 190, largura: 100, espessura: 0.5, tipo: 'Somente chapa', cor: '', peso: 1.2 };
  $('pingId').value = p ? p.id : '';
  $('pingNome').value = f.nome; $('pingComp').value = f.comprimento; $('pingLarg').value = f.largura;
  $('pingEsp').value = f.espessura; $('pingTipo').value = f.tipo; $('pingCor').value = f.cor; $('pingPeso').value = f.peso;
}
function savePingForm() {
  const p = { id: $('pingId').value || undefined, nome: $('pingNome').value.trim() || 'Pingadeira', comprimento: num('pingComp'), largura: num('pingLarg'), espessura: parseFloat($('pingEsp').value) || 0, tipo: $('pingTipo').value, cor: $('pingCor').value, peso: parseFloat($('pingPeso').value) || 0 };
  upsertPingadeira(catalog, p);
  renderPingadeiraList(); renderCatalogSelectors(); loadPingForm(null);
}
function renderPingadeiraList() {
  $('pingList').innerHTML = catalog.pingadeiras.map(p => `
    <div class="exitem"><span class="lbl">${escHtml(p.nome)} — ${p.comprimento}×${p.largura}mm · ${p.peso}kg</span>
      <span><button class="ed" data-edit="${p.id}">✎</button><button class="x" data-del="${p.id}">×</button></span></div>`).join('');
  $('pingList').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => loadPingForm(catalog.pingadeiras.find(p => p.id === b.dataset.edit))));
  $('pingList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Excluir esta pingadeira?')) { deletePingadeira(catalog, b.dataset.del); renderPingadeiraList(); renderCatalogSelectors(); } }));
}

function renderCatalogSelectors() {
  const opts = ['<option value="">— selecione —</option>'].concat(catalog.profiles.map(p => `<option value="${p.id}">${escHtml(p.nome)}</option>`)).join('');
  $('aguaProfile').innerHTML = opts;
  const defaultPing = catalog.pingadeiras[0];
  window.__defaultPingadeira = defaultPing;
}

function num(id) { return parseFloat($(id).value) || 0; }

// ---------- Distribuição / mapa ----------
export function runDistribution() {
  const aguas = editor.entities.filter(e => e.kind === 'agua');
  const missing = aguas.filter(a => !a.profileId);
  if (!aguas.length) { alert('Desenhe ao menos uma água antes de calcular.'); return; }
  if (missing.length) { alert(`Defina o perfil de telha para: ${missing.map(a => a.label).join(', ')} (aba Desenho → selecione a água → Perfil de telha).`); return; }

  const pingadeira = window.__defaultPingadeira;
  const resultsRaw = aguas.map(a => {
    const profile = catalog.profiles.find(p => p.id === a.profileId);
    const { best, candidates } = optimizeAgua(a, profile, pingadeira, { pingadeiraOn: a.pingadeiraOn !== false });
    return best ? { ...best.result, candidatesTried: candidates.length, alt: candidates.slice(0, 4).map(c => ({ dir: c.directionDeg, score: +c.score.toFixed(1) })) } : null;
  }).filter(Boolean);

  numberProject(resultsRaw);
  currentResults = resultsRaw;
  renderMapTab(aguas);
  renderFabricacaoTab();
  renderMontagemTab();
  renderRelatoriosTab();
}

function renderMapTab(aguas) {
  const box = $('mapContainer');
  box.innerHTML = '';
  currentResults.forEach(res => {
    const agua = aguas.find(a => a.id === res.aguaId);
    const wrap = document.createElement('div');
    wrap.className = 'card';
    const svgMarkup = renderAguaMapSVG(agua, res);
    wrap.innerHTML = `<div class="viewhead"><h2 style="margin:0">${escHtml(agua.label)}</h2>
      <span>
        <button class="btn ghost" data-svgpng="${agua.id}">PNG</button>
        <button class="btn ghost" data-svgsvg="${agua.id}">SVG</button>
      </span></div>
      <div class="svgbox">${svgMarkup}</div>
      <div class="note">Direção ótima: ${res.directionDeg}° · ${res.candidatesTried} direção(ões) avaliada(s) automaticamente (heurística de menor desperdício/cortes/emendas) ·
      Desperdício ${res.summary.wastePct.toFixed(1)}% · ${res.summary.nTelhas} telha(s) · ${res.summary.nEmendas} emenda(s) · ${res.summary.nPingadeiras} pingadeira(s)</div>`;
    box.appendChild(wrap);
  });
  box.querySelectorAll('[data-svgpng]').forEach(b => b.addEventListener('click', () => {
    const svg = b.closest('.card').querySelector('svg');
    exportSvgAsPNG(svg, `mapa-${b.dataset.svgpng}.png`);
  }));
  box.querySelectorAll('[data-svgsvg]').forEach(b => b.addEventListener('click', () => {
    const svg = b.closest('.card').querySelector('svg');
    downloadSvg(svg, `mapa-${b.dataset.svgsvg}.svg`);
  }));
}

function renderFabricacaoTab() {
  const aguas = editor.entities.filter(e => e.kind === 'agua');
  const profile = catalog.profiles.find(p => p.id === aguas[0]?.profileId) || catalog.profiles[0];
  const rows = buildManufacturingList(projectSnapshot(), currentResults, profile);
  const grouped = groupManufacturingList(rows);
  window.__lastManufacturingRows = rows; window.__lastManufacturingGroups = grouped;
  $('fabTable').innerHTML = `<thead><tr><th>Comp (mm)</th><th>Larg (mm)</th><th>Esp (mm)</th><th>Tipo</th><th class="num">Qtd</th><th class="num">Peso (kg)</th><th class="num">Área (m²)</th></tr></thead>
    <tbody>${grouped.map(g => `<tr><td class="num">${g.comprimento}</td><td class="num">${g.largura}</td><td class="num">${g.espessura}</td><td>${g.tipo}</td><td class="num">${g.quantidade}</td><td class="num">${g.pesoTotal}</td><td class="num">${g.areaTotal}</td></tr>`).join('')}</tbody>`;
  $('fabNote').style.display = grouped.length ? 'none' : '';
}

function renderMontagemTab() {
  const rows = buildAssemblyList(projectSnapshot(), currentResults);
  window.__lastAssemblyRows = rows;
  $('montTable').innerHTML = `<thead><tr><th>#</th><th>Código</th><th>Água</th><th>Posição</th><th>Observação</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.seq}</td><td>${r.codigo}</td><td>${escHtml(r.agua)}</td><td>${escHtml(r.posicao)}</td><td>${escHtml(r.local)}</td></tr>`).join('')}</tbody>`;
}

function renderRelatoriosTab() {
  const rep = buildReports(projectSnapshot(), currentResults);
  window.__lastReports = rep;
  $('repChips').innerHTML = [
    ['Área total', rep.areaTotal.toFixed(2) + ' m²'], ['Área útil', rep.areaUtil.toFixed(2) + ' m²'],
    ['Área perdida', rep.areaPerdida.toFixed(2) + ' m²'], ['% desperdício', rep.wastePct + '%'],
    ['Área sobreposta', rep.areaSobreposta.toFixed(2) + ' m²'], ['Telhas', rep.nTelhas],
    ['Emendas', rep.nEmendas], ['Pingadeiras', rep.nPingadeiras], ['Peso total', rep.pesoTotal + ' kg'],
    ['Comprimento linear', rep.comprimentoLinear + ' m'], ['Parafusos (estimado)', rep.parafusosEstimados],
    ['Fita de vedação', rep.fitaVedacaoM + ' m'], ['Arremates', rep.arrematesM + ' m']
  ].map(([k, v]) => `<div class="chip"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

function projectSnapshot() {
  return { ...currentProject, aguas: editor.entities.filter(e => e.kind === 'agua') };
}

// ---------- Exportações ----------
export function bindExportButtons() {
  $('calcDist').addEventListener('click', runDistribution);
  $('exportFabCsv').addEventListener('click', () => {
    if (!window.__lastManufacturingGroups) return alert('Calcule a distribuição primeiro.');
    downloadText('fabricacao.csv', rowsToCSV(window.__lastManufacturingGroups, [
      { key: 'comprimento', label: 'Comprimento(mm)' }, { key: 'largura', label: 'Largura(mm)' }, { key: 'espessura', label: 'Espessura(mm)' },
      { key: 'tipo', label: 'Tipo' }, { key: 'quantidade', label: 'Quantidade' }, { key: 'pesoTotal', label: 'Peso(kg)' }, { key: 'areaTotal', label: 'Área(m²)' }
    ]), 'text/csv');
  });
  $('exportMontCsv').addEventListener('click', () => {
    if (!window.__lastAssemblyRows) return alert('Calcule a distribuição primeiro.');
    downloadText('montagem.csv', rowsToCSV(window.__lastAssemblyRows, [
      { key: 'seq', label: 'Seq' }, { key: 'codigo', label: 'Código' }, { key: 'agua', label: 'Água' }, { key: 'posicao', label: 'Posição' }, { key: 'local', label: 'Observação' }
    ]), 'text/csv');
  });
  $('exportDxf').addEventListener('click', () => exportProjectDXF(projectSnapshot()));
  $('exportAdvPdf').addEventListener('click', () => {
    if (!window.__lastReports) return alert('Calcule a distribuição primeiro.');
    generateAdvancedPDF(projectSnapshot(), window.__lastReports, window.__lastManufacturingGroups, window.__lastAssemblyRows);
  });
}

// ---------- Projetos salvos ----------
function bindProjectUI() {
  $('advSalvar').addEventListener('click', saveProject);
  $('advNovo').addEventListener('click', novoProjeto);
  $('advProjetos').addEventListener('click', abrirProjetosModal);
  $('advProjetosClose').addEventListener('click', () => { $('advProjetosModal').style.display = 'none'; });
  $('advProjetosModal').addEventListener('click', e => { if (e.target.id === 'advProjetosModal') $('advProjetosModal').style.display = 'none'; });
  ['advNome', 'advCliente', 'advObra'].forEach(id => $(id).addEventListener('input', e => { currentProject[id.replace('adv', '').toLowerCase()] = e.target.value; }));
}

function loadProjects() { try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch (e) { return []; } }
function saveProjects(list) { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch (e) { alert('Não foi possível salvar (armazenamento cheio?).'); } }

function saveProject() {
  currentProject.nome = $('advNome').value.trim() || `Projeto ${new Date().toLocaleDateString('pt-BR')}`;
  currentProject.cliente = $('advCliente').value.trim();
  currentProject.obra = $('advObra').value.trim();
  currentProject.data = new Date().toISOString();
  currentProject.entities = editor.entities;
  if (!currentProject.id) currentProject.id = uid('proj');
  const list = loadProjects();
  const idx = list.findIndex(p => p.id === currentProject.id);
  if (idx >= 0) list[idx] = currentProject; else list.push(currentProject);
  saveProjects(list);
  alert('Projeto salvo localmente neste dispositivo.');
}

function novoProjeto() {
  if (!confirm('Iniciar um novo projeto? O desenho atual não salvo será perdido.')) return;
  currentProject = { id: null, nome: '', cliente: '', obra: '', data: '' };
  editor.entities = []; editor.selectedId = null; editor.render();
  $('advNome').value = ''; $('advCliente').value = ''; $('advObra').value = '';
  renderAguaList();
  $('mapContainer').innerHTML = ''; $('fabTable').innerHTML = ''; $('montTable').innerHTML = ''; $('repChips').innerHTML = '';
  currentResults = [];
}

function abrirProjetosModal() {
  const list = loadProjects();
  const box = $('advProjetosList');
  box.innerHTML = list.length ? list.map(p => `
    <div class="exitem"><span class="lbl">${escHtml(p.nome)} — ${p.cliente ? escHtml(p.cliente) + ' · ' : ''}${new Date(p.data).toLocaleDateString('pt-BR')}</span>
      <span><button class="btn ghost" data-open="${p.id}" style="padding:4px 8px;font-size:11px">Abrir</button><button class="x" data-del="${p.id}">×</button></span></div>`).join('')
    : '<p style="color:var(--muted);font-size:13px;text-align:center;margin:20px 0">Nenhum projeto salvo ainda.</p>';
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { abrirProjeto(b.dataset.open); $('advProjetosModal').style.display = 'none'; }));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Excluir este projeto salvo?')) { saveProjects(loadProjects().filter(p => p.id !== b.dataset.del)); abrirProjetosModal(); } }));
  $('advProjetosModal').style.display = 'flex';
}

function abrirProjeto(id) {
  const p = loadProjects().find(x => x.id === id);
  if (!p) return;
  currentProject = { id: p.id, nome: p.nome, cliente: p.cliente, obra: p.obra, data: p.data };
  editor.entities = p.entities || [];
  editor.selectedId = null; editor.render();
  $('advNome').value = p.nome || ''; $('advCliente').value = p.cliente || ''; $('advObra').value = p.obra || '';
  renderAguaList();
}

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
