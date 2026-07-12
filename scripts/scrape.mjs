// Indexador de fichas públicas de producto de la Tienda Virtual de INACAL.
// Recorre TIE_DetallarProducto.aspx?PRO=N (páginas públicas, sin autenticación)
// a baja velocidad y con reanudación, y guarda un JSONL con los campos de la ficha.
//
// Uso: node scripts/scrape.mjs <salida.jsonl> [idInicio] [idFin]
import fs from 'node:fs';

const OUT = process.argv[2] || 'products.jsonl';
const START = parseInt(process.argv[3] || '1', 10);
const END = parseInt(process.argv[4] || '13500', 10);
const BASE = 'https://tiendavirtual.inacal.gob.pe/0/modulos/TIE/TIE_DetallarProducto.aspx?PRO=';
const DELAY_MS = 700;          // pausa entre peticiones (~1.4 req/s)
const BLOCK_WAIT_MS = 180000;  // espera cuando el WAF responde 403
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Reanudación: IDs ya procesados (con o sin producto) quedan registrados en el JSONL.
const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.id && !o.error) done.add(o.id); } catch {}
  }
}
console.log(`Reanudando: ${done.size} IDs ya procesados.`);

const out = fs.createWriteStream(OUT, { flags: 'a' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&oacute;/g, 'ó').replace(/&iacute;/g, 'í').replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Oacute;/g, 'Ó').replace(/&Iacute;/g, 'Í').replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&ordf;/g, 'ª').replace(/&ordm;/g, 'º').replace(/&ndash;/g, '–')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseProduct(html, id) {
  const p = { id };
  const blockRe = /<p class="WEB_TXT_datosDetalle1">\s*([\s\S]*?)<\/p>\s*<p class="WEB_TXT_datosDetalle2">\s*([\s\S]*?)<\/p>/g;
  const fields = {};
  let m;
  while ((m = blockRe.exec(html)) !== null) fields[stripTags(m[1]).replace(/:$/, '').trim()] = m[2];

  p.codigo = fields['Código'] !== undefined ? stripTags(fields['Código']) : null;
  p.titulo = fields['Título'] !== undefined ? stripTags(fields['Título']) : null;
  p.publicado = fields['Publicado'] !== undefined ? stripTags(fields['Publicado']) : null;
  p.resumen = fields['Resumen'] !== undefined ? stripTags(fields['Resumen']) : null;
  p.reemplaza = fields['Reemplaza a'] !== undefined ? stripTags(fields['Reemplaza a']) : null;
  p.precio = fields['Precio'] !== undefined ? stripTags(fields['Precio']) : null;

  p.ics = [];
  if (fields['I.C.S'] !== undefined) {
    const icsRe = /<a href='[^']*'>\s*([\s\S]*?)<\/a>\s*([^<]*)/g;
    let im;
    while ((im = icsRe.exec(fields['I.C.S'])) !== null) {
      const code = stripTags(im[1]);
      const label = decodeEntities(im[2]).replace(/\s+/g, ' ').trim();
      if (code) p.ics.push({ code, label });
    }
    if (!p.ics.length) {
      const plain = stripTags(fields['I.C.S']);
      if (plain) p.icsTexto = plain;
    }
  }

  p.descriptores = [];
  if (fields['Descriptores'] !== undefined) {
    const dRe = /<a href='[^']*'>\s*([\s\S]*?)<\/a>/g;
    let dm;
    while ((dm = dRe.exec(fields['Descriptores'])) !== null) {
      const d = stripTags(dm[1]);
      if (d && d !== '/') p.descriptores.push(d);
    }
  }

  const sd = html.match(/divSoloDigital"[^>]*>([\s\S]*?)<\/div>/);
  p.soloDigital = sd ? /S[oó]lo\s*Formato\s*Digital/i.test(stripTags(sd[1])) : false;
  p.consultado = new Date().toISOString().slice(0, 10);
  return p;
}

let found = 0, processed = 0;
for (let id = START; id <= END; id++) {
  if (done.has(id)) continue;
  let attempts = 0;
  while (true) {
    attempts++;
    try {
      const res = await fetch(BASE + id, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-PE,es;q=0.9' },
        signal: AbortSignal.timeout(30000)
      });
      if (res.status === 403) {
        console.log(`WAF 403 en id=${id}; esperando ${BLOCK_WAIT_MS / 1000}s…`);
        await sleep(BLOCK_WAIT_MS);
        continue;
      }
      if (res.status === 301 || res.status === 302) {
        out.write(JSON.stringify({ id, exists: false }) + '\n');
      } else if (res.status === 200) {
        const html = await res.text();
        if (/WEB_TXT_datosDetalle1/.test(html)) {
          found++;
          out.write(JSON.stringify(parseProduct(html, id)) + '\n');
        } else {
          out.write(JSON.stringify({ id, exists: false }) + '\n');
        }
      } else {
        throw new Error('HTTP ' + res.status);
      }
      break;
    } catch (e) {
      if (attempts >= 5) {
        out.write(JSON.stringify({ id, error: String(e) }) + '\n');
        break;
      }
      await sleep(3000 * attempts);
    }
  }
  processed++;
  if (processed % 50 === 0) console.log(`id=${id} procesados=${processed} encontrados=${found} ${new Date().toISOString()}`);
  await sleep(DELAY_MS);
}
console.log(`FIN procesados=${processed} encontrados=${found}`);
