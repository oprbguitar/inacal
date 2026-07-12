/* Catálogo INACAL — índice no oficial.
   Carga site/data/catalogo.json y ofrece búsqueda, filtros combinables,
   ordenamiento, paginación, vista tarjetas/tabla y visor de PDF. */
(function () {
  'use strict';

  var DATA_URL = 'data/catalogo.json';
  var state = {
    items: [],        // catálogo completo
    icsIndex: {},     // code -> etiqueta
    filtrados: [],
    pagina: 1,
    porPagina: 24,
    vista: 'tarjetas',
    generado: null,
    fuente: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- utilidades ---------- */
  function norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function esc(s) {
    return (s || '').toString().replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrecio(it) {
    if (it.gratuito) return 'Gratuito';
    if (it.precio == null) return 'Consultar';
    return 'S/ ' + it.precio.toFixed(2);
  }
  function fmtFecha(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  /* ---------- carga progresiva ---------- */
  function cargar() {
    var estado = $('estadoCarga');
    estado.hidden = false;
    estado.className = 'load-state';
    estado.innerHTML = 'Descargando catálogo… <div class="progressbar"><div id="pbar"></div></div>';

    fetch(DATA_URL).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var total = +res.headers.get('Content-Length') || 0;
      if (!res.body || !total) return res.json();
      var reader = res.body.getReader();
      var recibido = 0, chunks = [];
      function paso() {
        return reader.read().then(function (r) {
          if (r.done) {
            var buf = new Uint8Array(recibido), off = 0;
            chunks.forEach(function (c) { buf.set(c, off); off += c.length; });
            return JSON.parse(new TextDecoder('utf-8').decode(buf));
          }
          chunks.push(r.value); recibido += r.value.length;
          var pb = $('pbar');
          if (pb) pb.style.width = Math.min(100, recibido / total * 100).toFixed(1) + '%';
          return paso();
        });
      }
      return paso();
    }).then(function (json) {
      state.items = json.items || [];
      state.icsIndex = json.icsIndex || {};
      state.generado = json.generado || null;
      state.fuente = json.fuente || null;
      estado.hidden = true;
      $('metaGenerado').textContent = 'Datos: ' + (state.generado ? fmtFecha(state.generado.slice(0, 10)) : '—');
      $('metaTotal').textContent = state.items.length.toLocaleString('es-PE') + ' registros';
      $('footGenerado').textContent = 'Catálogo extraído el ' +
        (state.generado ? fmtFecha(state.generado.slice(0, 10)) : '—') +
        ' · ' + state.items.length.toLocaleString('es-PE') + ' registros.';
      poblarFiltros();
      leerURL();
      aplicar();
    }).catch(function (e) {
      estado.hidden = false;
      estado.className = 'load-state error';
      estado.innerHTML = '⚠️ No se pudo cargar el catálogo (' + esc(e.message) +
        '). Verifique su conexión e <button class="btn btn-sm" onclick="location.reload()">intente de nuevo</button>.';
      $('contador').textContent = 'Error de carga';
    });
  }

  /* ---------- poblar controles ---------- */
  function poblarFiltros() {
    // Tipos
    var tipos = {};
    state.items.forEach(function (it) { tipos[it.tipo] = (tipos[it.tipo] || 0) + 1; });
    var selT = $('fTipo');
    Object.keys(tipos).sort().forEach(function (t) {
      var o = document.createElement('option');
      o.value = t; o.textContent = t + ' (' + tipos[t] + ')';
      selT.appendChild(o);
    });
    // Años
    var anios = {};
    state.items.forEach(function (it) { if (it.anio) anios[it.anio] = 1; });
    var selA = $('fAnio');
    Object.keys(anios).sort(function (a, b) { return b - a; }).forEach(function (a) {
      var o = document.createElement('option');
      o.value = a; o.textContent = a;
      selA.appendChild(o);
    });
    // ICS: agrupar por campo raíz
    var usados = {};
    state.items.forEach(function (it) {
      (it.ics || []).forEach(function (c) { usados[c] = (usados[c] || 0) + 1; });
    });
    var selI = $('fIcs');
    Object.keys(usados).sort().forEach(function (c) {
      var o = document.createElement('option');
      var lbl = state.icsIndex[c] || '';
      o.value = c;
      o.textContent = c + (lbl ? ' — ' + lbl : '') + ' (' + usados[c] + ')';
      selI.appendChild(o);
    });
  }

  /* ---------- filtros ---------- */
  function filtrosActivos() {
    var tipoSel = Array.prototype.slice.call($('fTipo').selectedOptions).map(function (o) { return o.value; });
    return {
      q: $('q').value.trim(),
      tipos: tipoSel,
      anio: $('fAnio').value,
      desde: $('fDesde').value,
      hasta: $('fHasta').value,
      codigo: $('fCodigo').value.trim(),
      ics: $('fIcs').value,
      palabras: $('fPalabras').value.trim(),
      pdf: $('fPdf').value,
      pago: $('fPago').value,
      estado: $('fEstado').value,
      digital: $('fDigital').value
    };
  }

  function tokensBusqueda(q) {
    var frases = [], resto = q;
    var re = /"([^"]+)"/g, m;
    while ((m = re.exec(q)) !== null) frases.push(norm(m[1]));
    resto = q.replace(re, ' ');
    var palabras = norm(resto).split(/\s+/).filter(Boolean);
    return { frases: frases, palabras: palabras };
  }

  function aplicar() {
    var f = filtrosActivos();
    var tk = f.q ? tokensBusqueda(f.q) : null;
    var res = [];

    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];

      if (f.tipos.length && f.tipos.indexOf(it.tipo) === -1) continue;
      if (f.anio && String(it.anio) !== f.anio) continue;
      if (f.desde && (!it.pub || it.pub < f.desde)) continue;
      if (f.hasta && (!it.pub || it.pub > f.hasta)) continue;
      if (f.codigo && norm(it.cod).indexOf(norm(f.codigo)) === -1) continue;
      if (f.ics && (it.ics || []).indexOf(f.ics) === -1) continue;
      if (f.pdf === 'si' && !it.pdf) continue;
      if (f.pdf === 'no' && it.pdf) continue;
      if (f.pago === 'gratuito' && !it.gratuito) continue;
      if (f.pago === 'pago' && it.gratuito) continue;
      if (f.estado === 'revisada' && it.estado !== 'Revisada/confirmada') continue;
      if (f.estado === 'publicada' && it.estado !== 'Publicada') continue;
      if (f.digital === 'digital' && !it.soloDigital) continue;

      if (f.palabras) {
        var pl = norm(f.palabras);
        var hayDesc = (it.des || []).some(function (d) { return norm(d).indexOf(pl) !== -1; });
        if (!hayDesc) continue;
      }

      if (tk) {
        var texto = norm(it.cod + ' ' + it.tit + ' ' + (it.res || '') + ' ' + (it.des || []).join(' '));
        var ok = true, score = 0;
        for (var x = 0; x < tk.frases.length; x++) {
          if (texto.indexOf(tk.frases[x]) === -1) { ok = false; break; }
          score += 5;
        }
        if (ok) {
          for (var y = 0; y < tk.palabras.length; y++) {
            if (texto.indexOf(tk.palabras[y]) === -1) { ok = false; break; }
            score += 1;
            if (norm(it.cod).indexOf(tk.palabras[y]) !== -1) score += 4;
            if (norm(it.tit).indexOf(tk.palabras[y]) !== -1) score += 2;
          }
        }
        if (!ok) continue;
        it._score = score;
      } else it._score = 0;

      res.push(it);
    }

    ordenar(res, f.q);
    state.filtrados = res;
    state.pagina = 1;
    escribirURL(f);
    pintarChips(f);
    render();
  }

  function ordenar(arr, hayBusqueda) {
    var modo = $('orden').value;
    if (modo === 'relevancia' && !hayBusqueda) modo = 'codigo-asc';
    var cmp = {
      'relevancia': function (a, b) { return b._score - a._score || a.cod.localeCompare(b.cod); },
      'codigo-asc': function (a, b) { return a.cod.localeCompare(b.cod, 'es', { numeric: true }); },
      'codigo-desc': function (a, b) { return b.cod.localeCompare(a.cod, 'es', { numeric: true }); },
      'fecha-desc': function (a, b) { return (b.pub || '').localeCompare(a.pub || ''); },
      'fecha-asc': function (a, b) { return (a.pub || '9999').localeCompare(b.pub || '9999'); },
      'precio-asc': function (a, b) { return (a.gratuito ? 0 : (a.precio || 1e9)) - (b.gratuito ? 0 : (b.precio || 1e9)); },
      'precio-desc': function (a, b) { return (b.gratuito ? 0 : (b.precio || 0)) - (a.gratuito ? 0 : (a.precio || 0)); },
      'titulo-asc': function (a, b) { return a.tit.localeCompare(b.tit, 'es'); }
    }[modo];
    if (cmp) arr.sort(cmp);
  }

  /* ---------- chips de filtros activos ---------- */
  function pintarChips(f) {
    var defs = [
      ['q', f.q && 'Texto: ' + f.q],
      ['tipos', f.tipos.length && 'Tipo: ' + f.tipos.join(', ')],
      ['anio', f.anio && 'Año: ' + f.anio],
      ['desde', f.desde && 'Desde: ' + f.desde],
      ['hasta', f.hasta && 'Hasta: ' + f.hasta],
      ['codigo', f.codigo && 'Código: ' + f.codigo],
      ['ics', f.ics && 'ICS: ' + f.ics],
      ['palabras', f.palabras && 'Palabras: ' + f.palabras],
      ['pdf', f.pdf && (f.pdf === 'si' ? 'Con PDF público' : 'Sin PDF público')],
      ['pago', f.pago && (f.pago === 'gratuito' ? 'Gratuito' : 'De pago')],
      ['estado', f.estado && 'Estado: ' + (f.estado === 'revisada' ? 'Revisada' : 'Publicada')],
      ['digital', f.digital && 'Sólo digital']
    ];
    var host = $('chips');
    host.innerHTML = '';
    defs.forEach(function (d) {
      if (!d[1]) return;
      var span = document.createElement('span');
      span.className = 'chip';
      span.innerHTML = esc(d[1]) + ' <button type="button" aria-label="Quitar filtro" data-k="' + d[0] + '">✕</button>';
      host.appendChild(span);
    });
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { quitarFiltro(b.getAttribute('data-k')); });
    });
  }

  function quitarFiltro(k) {
    if (k === 'q') $('q').value = '';
    else if (k === 'tipos') Array.prototype.forEach.call($('fTipo').options, function (o) { o.selected = false; });
    else if (k === 'anio') $('fAnio').value = '';
    else if (k === 'desde') $('fDesde').value = '';
    else if (k === 'hasta') $('fHasta').value = '';
    else if (k === 'codigo') $('fCodigo').value = '';
    else if (k === 'ics') $('fIcs').value = '';
    else if (k === 'palabras') $('fPalabras').value = '';
    else if (k === 'pdf') $('fPdf').value = '';
    else if (k === 'pago') $('fPago').value = '';
    else if (k === 'estado') $('fEstado').value = '';
    else if (k === 'digital') $('fDigital').value = '';
    aplicar();
  }

  /* ---------- URL compartible ---------- */
  function escribirURL(f) {
    var p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.tipos.length) p.set('tipo', f.tipos.join(','));
    if (f.anio) p.set('anio', f.anio);
    if (f.desde) p.set('desde', f.desde);
    if (f.hasta) p.set('hasta', f.hasta);
    if (f.codigo) p.set('cod', f.codigo);
    if (f.ics) p.set('ics', f.ics);
    if (f.palabras) p.set('kw', f.palabras);
    if (f.pdf) p.set('pdf', f.pdf);
    if (f.pago) p.set('pago', f.pago);
    if (f.estado) p.set('estado', f.estado);
    if (f.digital) p.set('dig', f.digital);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }
  function leerURL() {
    var p = new URLSearchParams(location.search);
    if (p.get('q')) $('q').value = p.get('q');
    if (p.get('tipo')) {
      var ts = p.get('tipo').split(',');
      Array.prototype.forEach.call($('fTipo').options, function (o) { o.selected = ts.indexOf(o.value) !== -1; });
    }
    if (p.get('anio')) $('fAnio').value = p.get('anio');
    if (p.get('desde')) $('fDesde').value = p.get('desde');
    if (p.get('hasta')) $('fHasta').value = p.get('hasta');
    if (p.get('cod')) $('fCodigo').value = p.get('cod');
    if (p.get('ics')) $('fIcs').value = p.get('ics');
    if (p.get('kw')) $('fPalabras').value = p.get('kw');
    if (p.get('pdf')) $('fPdf').value = p.get('pdf');
    if (p.get('pago')) $('fPago').value = p.get('pago');
    if (p.get('estado')) $('fEstado').value = p.get('estado');
    if (p.get('dig')) $('fDigital').value = p.get('dig');
  }

  /* ---------- render ---------- */
  function render() {
    var total = state.filtrados.length;
    var pags = Math.max(1, Math.ceil(total / state.porPagina));
    if (state.pagina > pags) state.pagina = pags;
    var ini = (state.pagina - 1) * state.porPagina;
    var visibles = state.filtrados.slice(ini, ini + state.porPagina);

    $('contador').innerHTML = total
      ? 'Mostrando <strong>' + (ini + 1) + '–' + (ini + visibles.length) + '</strong> de <strong>' +
        total.toLocaleString('es-PE') + '</strong> resultado(s)'
      : 'Sin resultados';

    var host = $('listado');
    if (!total) {
      host.className = 'cards';
      host.innerHTML = '<div class="load-state">No se encontraron documentos con los criterios elegidos.' +
        ' Pruebe con menos filtros o revise la ortografía.' +
        ' <br><br><button class="btn btn-amarillo btn-sm" id="btnSinResultados" type="button">Limpiar filtros</button></div>';
      var b = $('btnSinResultados');
      if (b) b.addEventListener('click', limpiar);
      $('pager').hidden = true;
      return;
    }

    if (state.vista === 'tarjetas') {
      host.className = 'cards';
      host.innerHTML = visibles.map(cardHTML).join('');
    } else {
      host.className = '';
      host.innerHTML = '<div class="table-wrap"><table class="lista"><thead><tr>' +
        '<th>Código</th><th>Título</th><th>Tipo</th><th>Publicado</th><th>ICS</th><th>Precio</th><th>Estado</th><th>Acciones</th>' +
        '</tr></thead><tbody>' + visibles.map(rowHTML).join('') + '</tbody></table></div>';
    }
    enlazarAcciones(host);

    $('pager').hidden = false;
    $('pgInfo').textContent = 'Página ' + state.pagina + ' de ' + pags;
    $('pgPrev').disabled = state.pagina <= 1;
    $('pgNext').disabled = state.pagina >= pags;
  }

  function accionesHTML(it) {
    var h = '<a class="btn btn-sm" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="Abrir la ficha oficial del producto en la tienda de INACAL">Ficha oficial ↗</a>';
    if (it.pdf) {
      h += '<button class="btn btn-sm btn-amarillo" type="button" data-pdf="' + esc(it.pdf) + '" data-titulo="' + esc(it.cod) + '" title="Ver el PDF público (descarga autorizada por INACAL) en el visor integrado">Ver PDF</button>';
    }
    h += '<button class="btn btn-sm btn-dark" type="button" data-local="1" data-titulo="' + esc(it.cod) + '" title="Abrir en el visor un PDF de esta norma que usted haya adquirido legalmente (el archivo no se sube a ningún servidor: se abre solo en su navegador)">Mi PDF</button>';
    return h;
  }

  function badgesHTML(it) {
    var b = '<span class="badge badge-tipo">' + esc(it.tipo) + '</span>';
    if (it.gratuito) b += ' <span class="badge badge-gratis">GRATUITO</span>';
    if (it.soloDigital) b += ' <span class="badge badge-digital">SÓLO DIGITAL</span>';
    if (it.estado === 'Revisada/confirmada') b += ' <span class="badge badge-estado">REVISADA</span>';
    return b;
  }

  function icsTexto(it) {
    return (it.ics || []).map(function (c) {
      var l = state.icsIndex[c];
      return c + (l ? ' (' + l + ')' : '');
    }).join('; ');
  }

  function cardHTML(it) {
    return '<article class="card">' +
      '<div class="card-top"><span class="card-codigo">' + esc(it.cod) + '</span><span>' + badgesHTML(it) + '</span></div>' +
      '<p class="card-titulo">' + esc(it.tit) + '</p>' +
      (it.res ? '<p class="card-resumen">' + esc(it.res) + '</p>' : '') +
      '<div class="card-meta">' +
        '<span><b>Publicado:</b> ' + fmtFecha(it.pub) + '</span>' +
        ((it.ics && it.ics.length) ? '<span><b>ICS:</b> ' + esc(icsTexto(it)) + '</span>' : '') +
        (it.reemplaza ? '<span><b>Reemplaza a:</b> ' + esc(it.reemplaza) + '</span>' : '') +
      '</div>' +
      ((it.des && it.des.length) ? '<div class="card-tags">' + it.des.map(function (d) {
        return '<span class="tag" data-kw="' + esc(d) + '" title="Filtrar por esta palabra clave">' + esc(d) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="card-precio' + (it.gratuito ? ' gratis' : '') + '">' + fmtPrecio(it) + '</div>' +
      '<div class="card-actions">' + accionesHTML(it) + '</div>' +
      '<div class="card-fuente">Fuente: Tienda Virtual de INACAL · consultado ' + fmtFecha(it.consultado) + '</div>' +
      '</article>';
  }

  function rowHTML(it) {
    return '<tr>' +
      '<td><strong>' + esc(it.cod) + '</strong></td>' +
      '<td>' + esc(it.tit) + '</td>' +
      '<td>' + esc(it.tipo) + '</td>' +
      '<td>' + fmtFecha(it.pub) + '</td>' +
      '<td>' + esc((it.ics || []).join(', ')) + '</td>' +
      '<td>' + fmtPrecio(it) + '</td>' +
      '<td>' + esc(it.estado) + '</td>' +
      '<td style="white-space:nowrap">' + accionesHTML(it) + '</td>' +
      '</tr>';
  }

  function enlazarAcciones(host) {
    host.querySelectorAll('[data-pdf]').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirPdf(b.getAttribute('data-pdf'), b.getAttribute('data-titulo'));
      });
    });
    host.querySelectorAll('[data-local]').forEach(function (b) {
      b.addEventListener('click', function () {
        pdfLocalTitulo = b.getAttribute('data-titulo');
        $('pdfLocal').click();
      });
    });
    host.querySelectorAll('.tag').forEach(function (t) {
      t.addEventListener('click', function () {
        $('fPalabras').value = t.getAttribute('data-kw');
        aplicar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ---------- visor PDF ---------- */
  var pdfLocalTitulo = '';
  var urlLocalActual = null;

  function abrirPdf(url, titulo) {
    $('pdfTitle').textContent = titulo || 'Documento PDF';
    $('pdfExterno').href = url;
    $('pdfExterno').hidden = false;
    $('pdfAviso').hidden = true;
    $('pdfFrame').src = url;
    $('pdfModal').hidden = false;
    document.body.style.overflow = 'hidden';
    // Si el origen bloquea la inserción, el iframe queda vacío: mostramos aviso tras un margen.
    setTimeout(function () {
      try {
        var doc = $('pdfFrame').contentDocument;
        if (doc && doc.body && !doc.body.childElementCount && !doc.body.textContent.trim()) {
          $('pdfAviso').hidden = false;
        }
      } catch (e) { /* origen cruzado: el PDF sí se está mostrando */ }
    }, 3000);
  }

  function cerrarPdf() {
    $('pdfModal').hidden = true;
    $('pdfFrame').src = 'about:blank';
    document.body.style.overflow = '';
    if (urlLocalActual) { URL.revokeObjectURL(urlLocalActual); urlLocalActual = null; }
  }

  $('pdfLocal').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      alert('El archivo elegido no es un PDF.');
      return;
    }
    if (urlLocalActual) URL.revokeObjectURL(urlLocalActual);
    urlLocalActual = URL.createObjectURL(f);
    abrirPdf(urlLocalActual, (pdfLocalTitulo ? pdfLocalTitulo + ' — ' : '') + f.name + ' (archivo local)');
    $('pdfExterno').hidden = true;
  });

  $('pdfCerrar').addEventListener('click', cerrarPdf);
  $('pdfModal').addEventListener('click', function (e) { if (e.target === this) cerrarPdf(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('pdfModal').hidden) cerrarPdf();
  });

  /* ---------- eventos ---------- */
  function limpiar() {
    ['q', 'fAnio', 'fDesde', 'fHasta', 'fCodigo', 'fIcs', 'fPalabras', 'fPdf', 'fPago', 'fEstado', 'fDigital']
      .forEach(function (id) { $(id).value = ''; });
    Array.prototype.forEach.call($('fTipo').options, function (o) { o.selected = false; });
    aplicar();
  }

  var debounceTimer = null;
  function debounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(aplicar, 250);
  }

  $('q').addEventListener('input', debounced);
  $('fCodigo').addEventListener('input', debounced);
  $('fPalabras').addEventListener('input', debounced);
  ['fTipo', 'fAnio', 'fDesde', 'fHasta', 'fIcs', 'fPdf', 'fPago', 'fEstado', 'fDigital', 'orden']
    .forEach(function (id) { $(id).addEventListener('change', aplicar); });
  $('btnLimpiar').addEventListener('click', limpiar);

  $('pgPrev').addEventListener('click', function () {
    state.pagina--; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('pgNext').addEventListener('click', function () {
    state.pagina++; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('pgSize').addEventListener('change', function () {
    state.porPagina = +this.value; state.pagina = 1; render();
  });

  $('btnVistaTarjetas').addEventListener('click', function () {
    state.vista = 'tarjetas';
    this.classList.add('active'); $('btnVistaTabla').classList.remove('active');
    render();
  });
  $('btnVistaTabla').addEventListener('click', function () {
    state.vista = 'tabla';
    this.classList.add('active'); $('btnVistaTarjetas').classList.remove('active');
    render();
  });

  // Filtros móviles
  $('btnToggleFiltros').addEventListener('click', function () {
    var panel = $('filtersPanel');
    var abierto = panel.classList.toggle('open');
    this.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    this.textContent = abierto ? '✕ Cerrar' : '☰ Filtros';
  });

  cargar();
})();
