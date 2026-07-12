# Catálogo de Normas Técnicas Peruanas — índice no oficial de la Tienda Virtual de INACAL

**🌐 Página pública:** <https://oprbguitar.github.io/inacal/>

Sitio estático (GitHub Pages) que indexa las fichas públicas de producto de la
[Tienda Virtual de INACAL](https://tiendavirtual.inacal.gob.pe/) — normas técnicas peruanas
(NTP, NTP-ISO, NTP-ISO/IEC, NTP-IEC, NTP-CODEX), guías (GP, GIP), especificaciones (ETP, EDP),
reportes (RTP), normas andinas (NA), normas metrológicas (NMP) y otras publicaciones —
con buscador, filtros combinables, ordenamiento, paginación y visor de PDF.

> ⚠️ **Proyecto independiente, sin afiliación con INACAL.** Los documentos se adquieren
> únicamente en la tienda oficial. Aquí no se distribuye ninguna norma de pago; los únicos
> PDF enlazados son los que INACAL publica gratuitamente en sus portales oficiales
> (p. ej. las Guías de Implementación Peruanas).

## Estructura

- `site/` — la página web (HTML/CSS/JS puro, sin frameworks ni servidor).
  - `site/data/catalogo.json` — catálogo completo en JSON, consumido por la página.
- `scripts/scrape.mjs` — indexador de fichas públicas (baja velocidad, con reanudación;
  no elude autenticación, pagos ni restricciones de acceso).
- `scripts/extract-gip.mjs` — extrae la lista de GIP con PDF de descarga pública.
- `scripts/build-data.mjs` — convierte los datos crudos en `site/data/catalogo.json`
  (deriva tipo, año, edición y estado; elimina duplicados por código; conserva fuente
  y fecha de consulta de cada registro).
- `.github/workflows/deploy.yml` — despliegue automático de `site/` a GitHub Pages.

## Regenerar los datos

```bash
node scripts/scrape.mjs products.jsonl 1 13500
node scripts/extract-gip.mjs jer_1512.html gip-gratuitas.json
node scripts/build-data.mjs products.jsonl gip-gratuitas.json site/data/catalogo.json
```

## Desarrollo local

Cualquier servidor estático sirve, por ejemplo:

```bash
npx http-server site -p 8123
```

Cada registro conserva el enlace a su ficha original (`url`) y la fecha en que se
consultó (`consultado`). Los precios y la vigencia pueden cambiar: verifique siempre
en la tienda oficial.
