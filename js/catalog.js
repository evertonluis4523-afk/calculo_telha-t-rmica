// Catálogo de perfis de telha, perfis de aba e configurações de comprimento por fabricante.
// Persistido em localStorage, independente do "Cálculo rápido" (modo clássico).

const KEY = 'rm_telha_avancado_catalogo_v1';

function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }

const CORE_TYPES = ['EPS', 'PIR', 'PUR', 'Lã de Rocha'];
const JOINT_TYPES = ['1 aba', '2 abas', 'Macho/Fêmea', 'Oculto', 'Personalizado'];

function defaultCatalog() {
  return {
    profiles: [{
      id: uid('perf'), nome: 'Telha Térmica Padrão', fabricante: 'RM', modelo: 'STD-30',
      espessura: 30, larguraUtil: 1020, larguraTotal: 1060, alturaPerfil: 30,
      chapaSup: 0.4, chapaInf: 0.4, nucleo: 'EPS', encaixe: '1 aba',
      pesoM2: 9.5,
      aba: { largura: 60, altura: 30, sobreposicaoMin: 100, sobreposicaoMax: 200, perda: 15, tolerancia: 3 },
      comprimentos: { min: 1000, max: 13750, ideal: 12000, transporte: 12500, especial: 13750 }
    }],
    pingadeiras: [{
      id: uid('ping'), nome: 'Pingadeira metálica padrão', comprimento: 190, largura: 100,
      espessura: 0.5, tipo: 'Somente chapa', cor: 'Galvalume', peso: 1.2
    }]
  };
}

export function loadCatalog() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) { const d = defaultCatalog(); saveCatalog(d); return d; }
    const parsed = JSON.parse(s);
    if (!parsed.profiles || !parsed.profiles.length) return defaultCatalog();
    return parsed;
  } catch (e) { return defaultCatalog(); }
}

export function saveCatalog(cat) {
  try { localStorage.setItem(KEY, JSON.stringify(cat)); } catch (e) { /* armazenamento indisponível */ }
}

export function upsertProfile(cat, profile) {
  if (!profile.id) profile.id = uid('perf');
  const idx = cat.profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) cat.profiles[idx] = profile; else cat.profiles.push(profile);
  saveCatalog(cat);
  return profile;
}

export function deleteProfile(cat, id) {
  cat.profiles = cat.profiles.filter(p => p.id !== id);
  saveCatalog(cat);
}

export function upsertPingadeira(cat, p) {
  if (!p.id) p.id = uid('ping');
  const idx = cat.pingadeiras.findIndex(x => x.id === p.id);
  if (idx >= 0) cat.pingadeiras[idx] = p; else cat.pingadeiras.push(p);
  saveCatalog(cat);
  return p;
}

export function deletePingadeira(cat, id) {
  cat.pingadeiras = cat.pingadeiras.filter(p => p.id !== id);
  saveCatalog(cat);
}

export { CORE_TYPES, JOINT_TYPES, uid };
