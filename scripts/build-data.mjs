// Convierte el JSONL del scraper + la lista de GIP gratuitas en site/data/catalogo.json,
// el archivo estático que consume la página (compatible con GitHub Pages, sin servidor).
//
// Uso: node scripts/build-data.mjs <products.jsonl> <gip-gratuitas.json> <salida.json>
import fs from 'node:fs';

const JSONL = process.argv[2];
const GIP = process.argv[3];
const OUT = process.argv[4] || 'site/data/catalogo.json';
const FICHA = 'https://tiendavirtual.inacal.gob.pe/0/modulos/TIE/TIE_DetallarProducto.aspx?PRO=';
const PAGINA_GIP = 'https://tiendavirtual.inacal.gob.pe/0/modulos/JER/JER_Interna.aspx?ARE=0&PFL=0&JER=1512';

function tipoDesdeCodigo(cod) {
  const c = (cod || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^NTP[-\s]?ISO\s*\/?\s*IEC/.test(c)) return 'NTP-ISO/IEC';
  if (/^NTP[-\s]?ISO/.test(c)) return 'NTP-ISO';
  if (/^NTP[-\s]?IEC/.test(c)) return 'NTP-IEC';
  if (/^NTP[-\s]?CODEX/.test(c)) return 'NTP-CODEX';
  if (/^NTP/.test(c)) return 'NTP';
  if (/^GIP/.test(c)) return 'GIP';
  if (/^GP/.test(c)) return 'GP';
  if (/^ETP/.test(c)) return 'ETP';
  if (/^RTP/.test(c)) return 'RTP';
  if (/^EDP/.test(c)) return 'EDP';
  if (/^ASP/.test(c)) return 'ASP';
  if (/^NA\b/.test(c)) return 'NA';
  if (/^NMP/.test(c)) return 'NMP';
  if (/^PNTP/.test(c)) return 'PNTP';
  return 'Otro';
}

function parsePrecio(txt) {
  if (!txt) return null;
  const m = txt.replace(/,/g, '').match(/S\/\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseFecha(txt) {
  if (!txt) return null;
  const m = txt.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function anioDe(pub, cod) {
  if (pub) return +pub.slice(0, 4);
  const m = (cod || '').match(/:\s*(\d{4})/);
  return m ? +m[1] : null;
}

function edicionDe(titulo) {
  const m = (titulo || '').match(/(\d+)\s*[ªa°]?\s*ed(?:ici[oó]n)?\b/i);
  return m ? m[1] + 'ª edición' : null;
}

function estadoDe(cod) {
  return /\(\s*revisada\s+el\s+\d{4}\s*\)/i.test(cod || '') ? 'Revisada/confirmada' : 'Publicada';
}

// ---- Cargar productos del scraper ----
const raw = fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const porId = new Map();
for (const r of raw) {
  if (!r || r.error || r.exists === false || !r.codigo) continue;
  porId.set(r.id, r); // la última pasada gana
}

// ---- GIP gratuitas (PDF público autorizado por INACAL) ----
const gips = JSON.parse(fs.readFileSync(GIP, 'utf8'));
const pdfPorCodigo = new Map();
for (const g of gips) {
  pdfPorCodigo.set(g.codigo.toUpperCase().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':'), g);
}

const icsIndex = {};
const items = [];
const codigosVistos = new Set();

for (const r of [...porId.values()].sort((a, b) => a.id - b.id)) {
  const cod = r.codigo.trim();
  const dedupeKey = cod.toUpperCase().replace(/\s+/g, ' ');
  if (codigosVistos.has(dedupeKey)) continue; // evita duplicados por código
  codigosVistos.add(dedupeKey);

  const precio = parsePrecio(r.precio);
  const pub = parseFecha(r.publicado);
  const codNorm = cod.toUpperCase().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':');
  const gip = pdfPorCodigo.get(codNorm);

  const ics = [];
  for (const e of r.ics || []) {
    if (e.code) {
      ics.push(e.code);
      if (e.label) icsIndex[e.code] = e.label;
    }
  }

  items.push({
    id: r.id,
    cod,
    tit: r.titulo || '',
    tipo: tipoDesdeCodigo(cod),
    pub,
    anio: anioDe(pub, cod),
    edicion: edicionDe(r.titulo),
    res: r.resumen || '',
    reemplaza: r.reemplaza || '',
    ics,
    des: r.descriptores || [],
    precio,
    gratuito: precio === 0 || !!gip,
    pdf: gip ? gip.pdf : null,
    estado: estadoDe(cod),
    soloDigital: !!r.soloDigital,
    url: FICHA + r.id,
    consultado: r.consultado || new Date().toISOString().slice(0, 10)
  });
}

// GIP gratuitas que no estén ya en el catálogo de la tienda
for (const g of gips) {
  const key = g.codigo.toUpperCase().replace(/\s+/g, ' ');
  if (codigosVistos.has(key)) continue;
  codigosVistos.add(key);
  const anio = (g.codigo.match(/:(\d{4})/) || [])[1];
  items.push({
    id: null,
    cod: g.codigo,
    tit: g.titulo,
    tipo: 'GIP',
    pub: null,
    anio: anio ? +anio : null,
    edicion: edicionDe(g.titulo),
    res: '',
    reemplaza: '',
    ics: [],
    des: [],
    precio: 0,
    gratuito: true,
    pdf: g.pdf,
    estado: 'Publicada',
    soloDigital: true,
    url: PAGINA_GIP,
    consultado: g.consultado
  });
}

const salida = {
  generado: new Date().toISOString(),
  fuente: 'https://tiendavirtual.inacal.gob.pe/',
  descripcion: 'Índice no oficial de las fichas públicas de producto de la Tienda Virtual de INACAL (Perú).',
  total: items.length,
  icsIndex,
  items
};

fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(salida));
console.log(`Catálogo: ${items.length} registros -> ${OUT}`);
