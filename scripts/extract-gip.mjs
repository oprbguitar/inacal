// Extrae las Guías de Implementación Peruanas (GIP) con PDF de descarga pública
// desde la página "Guías de Implementación Peruanas" de la tienda de INACAL (JER=1512).
// Uso: node scripts/extract-gip.mjs <jer_1512.html> <salida.json>
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const out = process.argv[3] || 'gip-gratuitas.json';

function decodeEntities(s) {
  return s
    .replace(/&oacute;/g, 'ó').replace(/&iacute;/g, 'í').replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Oacute;/g, 'Ó').replace(/&Iacute;/g, 'Í').replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&ordf;/g, 'ª').replace(/&ordm;/g, 'º').replace(/&ndash;/g, '–')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

const items = [];
const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
let m;
while ((m = liRe.exec(html)) !== null) {
  const li = m[1];
  const pdf = li.match(/href="(https:\/\/www\.inacal\.gob\.pe\/[^"]*\.pdf)"/i);
  if (!pdf) continue;
  const texto = decodeEntities(li.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const cod = texto.match(/^(GIP\s*[\d.]+:\d{4})/i);
  const codigo = cod ? cod[1].replace(/\s+/g, ' ') : texto.split('"')[0].trim();
  const tit = texto.match(/"\s*([^"]+?)\s*"/);
  let titulo = tit ? tit[1] : texto.replace(/Descargar\s*$/i, '').trim();
  titulo = titulo.replace(new RegExp('^' + codigo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*"?\\s*'), '').replace(/^"|"$/g, '').trim();
  items.push({
    codigo,
    titulo,
    pdf: pdf[1],
    consultado: new Date().toISOString().slice(0, 10)
  });
}
fs.writeFileSync(out, JSON.stringify(items, null, 2));
console.log(`GIP gratuitas: ${items.length}`);
