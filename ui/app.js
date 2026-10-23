// Interfaz de Graba: la misma en Mac (WKWebView), Windows y Linux (Electron) y en el navegador (vista previa con demo.json).
// La app manda el estado con window.Graba.estado(json); la interfaz pide cosas con host.enviar(accion, datos).
(() => {
  "use strict";
  const HOST = window.GRABA_HOST || "web";
  const E = {
    fase: "inactiva", grabaciones: [], config: {}, ias: [], modelos: { lista: [] }, permisos: {}, carpeta: "", version: "", procesando: null,
    sel: null, pestana: "notas", ajustes: false, bv: null, bvCerrada: false, probando: {}, resultadoIA: {}, descarga: null,
    borrar: null, idioma: "es", textos: {},
  };
  const ENLACES = { sitio: "https://graba-app.github.io/graba/", codigo: "https://github.com/graba-app/graba",
    comunidad: "https://github.com/graba-app/graba/discussions", guiaIA: "https://graba-app.github.io/graba/ia.html" };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ───────────── Puente con la app ─────────────
  const host = {
    enviar(accion, datos = {}) {
      const msg = { accion, datos };
      if (window.webkit?.messageHandlers?.graba) return window.webkit.messageHandlers.graba.postMessage(msg);
      if (window.grabaEscritorio) return window.grabaEscritorio.enviar(msg);
      return simular(accion, datos);
    },
  };

  // ───────────── Idiomas (claves = texto en español) ─────────────
  function tr(t) {
    if (E.idioma === "es" || !t) return t;
    const limpio = String(t).replace(/\s+/g, " ").trim();
    if (!limpio) return t;
    if (E.textos[limpio]) return t.replace(limpio, E.textos[limpio]);
    const numeros = limpio.match(/\d+/g);
    if (numeros) {
      const plantilla = E.textos[limpio.replace(/\d+/g, "{n}")];
      if (plantilla) { let i = 0; return t.replace(limpio, plantilla.replace(/\{n\}/g, () => numeros[i++] ?? "")); }
    }
    if (window._faltantes && /\p{L}{2}/u.test(limpio)) window._faltantes.add(limpio);
    return t;
  }
  function traducirDOM(raiz) {
    if (E.idioma === "es") return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const nodos = []; let n; while ((n = w.nextNode())) nodos.push(n);
    for (const t of nodos) {
      const el = t.parentElement;
      if (!el || el.closest("[data-sin-traducir], script, style") || !/\p{L}/u.test(t.nodeValue)) continue;
      const v = tr(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v;
    }
    for (const el of raiz.querySelectorAll("[title],[aria-label],[placeholder]")) {
      if (el.closest("[data-sin-traducir]")) continue;
      for (const a of ["title", "aria-label", "placeholder"]) { const v = el.getAttribute(a); if (v) el.setAttribute(a, tr(v)); }
    }
  }
  async function cargarIdioma() {
    const pedido = new URLSearchParams(location.search).get("idioma");
    const codigo = pedido || E.config.idioma_ui || ((navigator.language || "es").startsWith("es") ? "es" : "en");
    if (codigo === E.idioma && (codigo === "es" || Object.keys(E.textos).length)) return;
    E.idioma = codigo;
    E.textos = {};
    if (codigo !== "es") {
      try { E.textos = (await (await fetch(`idiomas/${codigo}.json`)).json()).textos || {}; } catch { E.idioma = "es"; }
    }
    document.documentElement.lang = E.idioma;
  }

  function toast(texto) {
    const t = $("#toast");
    t.textContent = tr(texto);
    t.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("visible"), 1900);
  }
  function copiar(texto, aviso = "Copiado") {
    host.enviar("copiar", { texto });
    if (HOST === "web") navigator.clipboard?.writeText(texto).catch(() => {});
    toast(aviso);
  }

  // ───────────── Leer una grabación (grabacion.md: ver "Formato de las grabaciones" en el README) ─────────────
  function parsearGrabacion(md) {
    const r = { fm: {}, titulo: "", secciones: {}, publicar: {} };
    if (!md) return r;
    let cuerpo = md;
    if (md.startsWith("---\n")) {
      const fin = md.indexOf("\n---\n", 4);
      if (fin > 0) {
        for (const l of md.slice(4, fin).split("\n")) { const i = l.indexOf(":"); if (i > 0) r.fm[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
        cuerpo = md.slice(fin + 5);
      }
    }
    const t = cuerpo.match(/^# (.+)$/m);
    r.titulo = t ? t[1].trim() : "";
    for (const parte of ("\n" + cuerpo).split(/\n## /).slice(1)) {
      const salto = parte.indexOf("\n");
      const nombre = (salto < 0 ? parte : parte.slice(0, salto)).trim();
      r.secciones[nombre] = salto < 0 ? "" : parte.slice(salto + 1).trim();
    }
    for (const parte of ("\n" + (r.secciones["Para publicar"] || "")).split(/\n### /).slice(1)) {
      const salto = parte.indexOf("\n");
      r.publicar[(salto < 0 ? parte : parte.slice(0, salto)).trim()] = salto < 0 ? "" : parte.slice(salto + 1).trim();
    }
    return r;
  }
  /** Markdown mínimo y seguro (todo se escapa): ### títulos, listas, **negritas** y [indicaciones en pantalla]. */
  function mdHTML(texto) {
    const linea = (l) => esc(l).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]{2,160})\]/g, '<span class="indicacion">[$1]</span>');
    let html = "", lista = null;
    const cerrar = () => { if (lista) { html += `</${lista}>`; lista = null; } };
    for (const l of String(texto || "").split("\n")) {
      let m;
      if ((m = l.match(/^###\s+(.+)/))) { cerrar(); html += `<h3>${linea(m[1])}</h3>`; }
      else if ((m = l.match(/^\s*[-*•]\s+(.+)/))) { if (lista !== "ul") { cerrar(); html += "<ul>"; lista = "ul"; } html += `<li>${linea(m[1])}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.+)/))) { if (lista !== "ol") { cerrar(); html += "<ol>"; lista = "ol"; } html += `<li>${linea(m[1])}</li>`; }
      else if (!l.trim()) cerrar();
      else { cerrar(); html += `<p>${linea(l)}</p>`; }
    }
    cerrar();
    return html;
  }
  const reloj = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
  const aSegundos = (t) => t.split(":").reduce((a, p) => a * 60 + Number(p), 0);
  function fechaCorta(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(E.idioma === "es" ? "es-CL" : "en-US", { day: "numeric", month: "short" }) + " · " +
      d.toLocaleTimeString(E.idioma === "es" ? "es-CL" : "en-US", { hour: "2-digit", minute: "2-digit" });
  }
  const estadoDe = (t) => t?.estado?.estado || (t?.md ? "lista" : "");
  const tituloDe = (t) => parsearGrabacion(t.md).titulo || ({ grabando: tr("Grabando…"), procesando: tr("Procesando…") }[estadoDe(t)] || tr("Grabación sin título"));

  // ───────────── Pintar ─────────────
  function render() {
    const raiz = $("#app");
    const scroll = $(".principal-area")?.scrollTop || 0;
    raiz.innerHTML = `<div class="app">${lateral()}<main class="principal-area" data-pagina>${principal()}</main></div>${dialogos()}`;
    traducirDOM(raiz);
    const area = $(".principal-area"); if (area) area.scrollTop = scroll;
  }

  function lateral() {
    const libre = E.fase === "inactiva";
    const items = E.grabaciones.map((t) => {
      const e = estadoDe(t), m = t.meta || {};
      const chip = e === "procesando" ? `<span class="chip">Procesando ${t.estado.paso || 0}/${t.estado.total || 3}</span>`
        : e === "error" ? `<span class="chip error">Error</span>` : e === "grabando" ? `<span class="chip error">Grabando</span>` : "";
      return `<button class="item" data-sel="${esc(t.ruta)}" aria-current="${t.ruta === E.sel}">
        <span class="t" data-sin-traducir>${esc(tituloDe(t))}</span>
        <span class="m"><span data-sin-traducir>${esc(fechaCorta(m.inicio))}${m.duracion_seg ? " · " + reloj(m.duracion_seg) : ""}</span>${chip}</span></button>`;
    }).join("");
    return `<aside class="lateral">
      <div class="cabeza"><span class="marca">${LOGO}<span>Graba</span></span>
        <button class="icono" data-accion="ajustes" title="Ajustes" aria-label="Ajustes">⚙︎</button></div>
      <div class="grabar-caja">
        <button class="boton principal grande" data-accion="grabar" ${libre ? "" : "disabled"}><span class="punto"></span><span>${libre ? "Grabar" : "Grabando…"}</span></button>
        <div class="opciones-grabar">
          <button class="alternar" data-alternar="camara" aria-pressed="${!!E.config.camara}">📷 <span>Cámara</span></button>
          <button class="alternar" data-alternar="microfono" aria-pressed="${!!E.config.microfono}">🎙️ <span>Micrófono</span></button>
        </div>
      </div>
      <nav class="lista" aria-label="Grabaciones">${E.grabaciones.length ? `<h2>Tus grabaciones</h2>${items}` : ""}</nav>
    </aside>`;
  }

  function principal() {
    const t = E.grabaciones.find((x) => x.ruta === E.sel);
    if (!t) return vacio();
    const p = parsearGrabacion(t.md), e = estadoDe(t), m = t.meta || {};
    const titulo = tituloDe(t);
    let cuerpo = "";
    if (e === "procesando" || e === "grabando") {
      const paso = t.estado.paso || 0, total = t.estado.total || 3;
      cuerpo = `<div class="progreso"><p>${esc(t.estado.texto || "En espera…")}</p>
        <div class="barra ${paso ? "" : "indef"}"><i style="width:${Math.round((paso / total) * 100)}%"></i></div>
        <small>${paso ? `Paso ${paso} de ${total}` : "Preparando…"}</small></div>`;
    } else if (e === "error") {
      cuerpo = `<div class="progreso error-caja"><p data-sin-traducir>${esc(t.estado.error || tr("Algo falló al procesar."))}</p>
        <div class="acciones"><button class="boton principal" data-accion="reintentar">Reintentar</button>
        <button class="boton" data-accion="ajustes">Revisar ajustes</button></div></div>`;
    } else {
      cuerpo = pestanas(t, p);
    }
    return `<div class="contenido">
      <div class="titulo-graba"><h1 data-sin-traducir>${esc(titulo)}</h1>
        <div class="acciones">
          <button class="icono" data-accion="carpeta" title="Mostrar en la carpeta" aria-label="Mostrar en la carpeta">📁</button>
          ${e === "lista" ? `<button class="icono" data-accion="regenerar" title="Volver a escribir con la IA" aria-label="Volver a escribir con la IA">↻</button>` : ""}
          <button class="icono" data-accion="borrar" title="Borrar" aria-label="Borrar">🗑</button>
        </div></div>
      <div class="meta" data-sin-traducir>${esc(fechaCorta(m.inicio))}${m.duracion_seg ? " · " + reloj(m.duracion_seg) : ""}</div>
      ${t.video ? `<video id="video" controls preload="metadata" src="${esc(t.video)}"></video>` : ""}
      ${cuerpo}</div>`;
  }

  const PESTANAS = [["notas", "Notas"], ["guion", "Guion"], ["youtube", "YouTube"], ["subtitulos", "Subtítulos"], ["transcripcion", "Transcripción"]];
  function pestanas(t, p) {
    const barra = `<div class="pestanas" role="tablist">${PESTANAS.map(([id, n]) =>
      `<button class="pestana" role="tab" data-pestana="${id}" aria-selected="${E.pestana === id}">${n}</button>`).join("")}</div>`;
    const bloque = (titulo, html, texto) => `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>${titulo}</h3>
      ${texto != null ? `<button class="boton" data-copiar="${esc(texto)}">Copiar</button>` : ""}</div><div class="md" data-sin-traducir>${html}</div></section>`;
    const s = p.secciones, pub = p.publicar;
    let html = "";
    if (E.pestana === "notas") {
      html = bloque("Resumen", mdHTML(s["Resumen"]), s["Resumen"] || "") + (s["Notas"] ? bloque("Notas", mdHTML(s["Notas"]), s["Notas"]) : "");
    } else if (E.pestana === "guion") {
      html = bloque("Guion para YouTube", mdHTML(s["Guion para YouTube"]), s["Guion para YouTube"] || "");
    } else if (E.pestana === "youtube") {
      const titulos = (pub["Títulos"] || "").split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
      const capitulos = pub["Capítulos"] || "", descripcion = pub["Descripción"] || "";
      const todo = [descripcion, capitulos].filter(Boolean).join("\n\n");
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Títulos</h3></div>${titulos.map((x) =>
        `<div class="titulo-opcion"><span data-sin-traducir>${esc(x)}</span><small>${x.length}/100</small><button class="boton" data-copiar="${esc(x)}">Copiar</button></div>`).join("")}</section>`
        + `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Descripción con capítulos</h3><button class="boton principal" data-copiar="${esc(todo)}">Copiar</button></div>
          <pre class="bloque" data-sin-traducir>${esc(todo)}</pre></section>`
        + bloque("Etiquetas", `<p>${esc(pub["Etiquetas"] || "")}</p>`, pub["Etiquetas"] || "");
    } else if (E.pestana === "subtitulos") {
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Subtítulos (.srt)</h3>
        <button class="boton" data-accion="carpeta">Mostrar el archivo</button></div>
        <p>El archivo subtitulos.srt está en la carpeta de esta grabación. En YouTube Studio: Subtítulos → Agregar idioma → Subir archivo → "Con sincronización".</p></section>`;
    } else {
      const lineas = (s["Transcripción"] || "").split("\n").filter(Boolean).map((l) => {
        const m = l.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.*)$/);
        return m ? `<p><time data-ir="${aSegundos(m[1])}">${esc(m[1])}</time>${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
      }).join("");
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Transcripción</h3><button class="boton" data-copiar="${esc(s["Transcripción"] || "")}">Copiar</button></div>
        <div class="transcripcion" data-sin-traducir>${lineas}</div></section>`;
    }
    return barra + html;
  }

  function vacio() {
    return `<div class="vacio">${LOGO.replace('class="logo"', 'class="logo" style="width:56px;height:56px"')}
      <h1>Haz tu primera grabación</h1>
      <p>Graba tu pantalla con tu cámara y tu voz. Al terminar, la app transcribe en tu computador y tu IA te deja todo listo.</p>
      <div class="pasos-vacio">
        <div><b>1</b><span>Toca Grabar (o el ícono ● de la barra de menú) y explica lo que quieras mostrar.</span></div>
        <div><b>2</b><span>Toca Terminar: Graba transcribe en tu computador, sin subir nada.</span></div>
        <div><b>3</b><span>Recibes notas, un guion para YouTube, títulos, descripción con capítulos y subtítulos.</span></div>
      </div>
      <button class="boton principal" data-accion="grabar" ${E.fase === "inactiva" ? "" : "disabled"}><span class="punto"></span><span>Grabar</span></button></div>`;
  }

  // ───────────── Ajustes y bienvenida ─────────────
  function filasIA() {
    return E.ias.map((ia) => {
      const enUso = E.config.ia === ia.id, probando = E.probando[ia.id], r = E.resultadoIA[ia.id];
      const estado = !ia.instalada ? `<small>No está instalada · <a href="#" data-enlace="${ENLACES.guiaIA}#${ia.id}">Cómo instalarla</a></small>`
        : r && !r.ok ? `<small class="error-txt" data-sin-traducir>${esc(r.texto || tr("No respondió."))}</small>` : `<small>Instalada</small>`;
      const accion = enUso ? `<span class="ok">✓ En uso</span>` : ia.instalada
        ? `<button class="boton" data-probar="${ia.id}" ${probando ? "disabled" : ""}>${probando ? "Probando…" : "Usar"}</button>` : "";
      return `<div class="fila"><div class="txt"><b>${esc(ia.nombre)}</b>${estado}</div>${accion}</div>`;
    }).join("");
  }
  function filasModelo() {
    return (E.modelos.lista || []).map((m) => {
      const enUso = E.config.modelo === m.id && m.listo, bajando = E.descarga?.id === m.id;
      const accion = enUso ? `<span class="ok">✓ En uso</span>` : m.listo ? `<button class="boton" data-modelo-usar="${m.id}">Usar</button>`
        : bajando ? `<div style="width:120px"><div class="barra"><i style="width:${Math.round(E.descarga.pct * 100)}%"></i></div></div>`
          : `<button class="boton" data-modelo="${m.id}" ${E.descarga ? "disabled" : ""}>Descargar · ${m.mb} MB</button>`;
      const rec = m.id === E.modelos.recomendado ? ` <span class="chip">Recomendado</span>` : "";
      return `<div class="fila"><div class="txt"><b>${esc(m.nombre)}${rec}</b><small>${esc(m.detalle)}</small></div>${accion}</div>`;
    }).join("");
  }
  function filasPermisos() {
    return [["pantalla", "Grabar la pantalla", "Para que el video muestre lo que haces."], ["camara", "Cámara", "Para la burbuja con tu cara."],
      ["microfono", "Micrófono", "Para tu voz y la transcripción."]].map(([id, n, d]) =>
      `<div class="fila"><div class="txt"><b>${n}</b><small>${d}</small></div>${E.permisos[id]
        ? `<span class="ok">✓ Permitido</span>` : `<button class="boton" data-permiso="${id}">Permitir</button>`}</div>`).join("");
  }
  const IDIOMAS_AUDIO = [["auto", "Detectar solo"], ["es", "Español"], ["en", "Inglés"], ["pt", "Portugués"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"]];

  function dialogos() {
    if (E.borrar) {
      return `<div class="capa"><div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-borrar">
        <h2 id="t-borrar">¿Borrar esta grabación?</h2><p>Se va a la Papelera con el video, las notas y los subtítulos. Puedes recuperarla desde ahí.</p>
        <div class="pie-dialogo"><button class="boton" data-accion="cerrar">Cancelar</button><button class="boton peligro" data-accion="confirmar-borrar">Mover a la Papelera</button></div></div></div>`;
    }
    if (E.bv !== null) return bienvenida();
    if (!E.ajustes) return "";
    const sel = (clave, opciones) => `<select data-config="${clave}">${opciones.map(([v, n]) => `<option value="${v}" ${E.config[clave] === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
    return `<div class="capa"><div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-ajustes">
      <h2 id="t-ajustes">Ajustes</h2><p>Todo se procesa en tu computador. La IA usa tu propia cuenta.</p>
      <div class="seccion"><h3>Tu IA</h3>${filasIA()}</div>
      <div class="seccion"><h3>Transcripción</h3>${filasModelo()}
        <div class="fila"><div class="txt"><b>Idioma en que hablas</b><small>Si siempre hablas en el mismo, elegirlo mejora la transcripción.</small></div>${sel("idioma_audio", IDIOMAS_AUDIO)}</div></div>
      <div class="seccion"><h3>Permisos</h3>${filasPermisos()}</div>
      <div class="seccion"><h3>General</h3>
        <div class="fila"><div class="txt"><b>Idioma de la app</b></div>${sel("idioma_ui", [["es", "Español"], ["en", "English"]])}</div>
        <div class="fila"><div class="txt"><b>Carpeta de grabaciones</b><small data-sin-traducir>${esc(E.carpeta)}</small></div><button class="boton" data-accion="carpeta-base">Abrir</button></div></div>
      <div class="seccion"><h3>Acerca de Graba</h3><p style="margin:0 0 8px;color:var(--suave)">Graba <span data-sin-traducir>${esc(E.version)}</span> · Gratis y de código abierto.</p>
        <div class="enlaces"><a href="#" data-enlace="${ENLACES.sitio}">Sitio web</a><a href="#" data-enlace="${ENLACES.codigo}">Código</a><a href="#" data-enlace="${ENLACES.comunidad}">Comunidad</a></div></div>
      <div class="pie-dialogo"><button class="boton principal" data-accion="cerrar">Listo</button></div></div></div>`;
  }

  function bienvenida() {
    const paso = E.bv;
    const marcas = `<div class="pasos-bv">${[0, 1, 2, 3].map((i) => `<i class="${i <= paso ? "hecho" : ""}"></i>`).join("")}</div>`;
    const iaLista = !!E.config.ia, modeloListo = (E.modelos.lista || []).some((m) => m.listo && m.id === E.config.modelo);
    const pasos = [
      [`Hola, esto es Graba`, `Graba tu pantalla con tu cámara y tu voz. Al terminar, la app transcribe en tu computador y tu propia IA escribe notas, un guion para YouTube, títulos, descripción con capítulos y subtítulos. Nada se sube a ningún servidor.`, "", true],
      [`Elige tu IA`, `Graba usa la IA que ya tienes, con tu cuenta. La probamos con una pregunta corta.`, filasIA(), iaLista],
      [`Descarga el transcriptor`, `Convierte tu voz en texto dentro de tu computador. Se descarga una sola vez.`, filasModelo(), modeloListo],
      [`Permisos`, `macOS pide permiso para grabar la pantalla, la cámara y el micrófono. Puedes cambiarlos cuando quieras.`, filasPermisos(), true],
    ];
    const [titulo, texto, filas, puede] = pasos[paso];
    return `<div class="capa"><div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-bv">${marcas}
      <h2 id="t-bv">${titulo}</h2><p>${texto}</p><div class="seccion">${filas}</div>
      <div class="pie-dialogo">${paso > 0 ? `<button class="boton" data-bv="${paso - 1}">Atrás</button>` : ""}
        <button class="boton" data-accion="bv-despues">Lo hago después</button>
        ${paso < 3 ? `<button class="boton principal" data-bv="${paso + 1}" ${puede ? "" : "disabled"}>Siguiente</button>`
          : `<button class="boton principal" data-accion="bv-fin">Empezar</button>`}</div></div></div>`;
  }

  // ───────────── Eventos ─────────────
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-accion],[data-sel],[data-pestana],[data-copiar],[data-alternar],[data-probar],[data-modelo],[data-modelo-usar],[data-permiso],[data-bv],[data-enlace],[data-ir]");
    if (!el) return;
    const d = el.dataset;
    if (d.enlace) { ev.preventDefault(); return host.enviar("abrirEnlace", { url: d.enlace }); }
    if (d.ir) { const v = $("#video"); if (v) { v.currentTime = Number(d.ir); v.play?.(); } return; }
    if (d.sel) { E.sel = d.sel; return render(); }
    if (d.pestana) { E.pestana = d.pestana; return render(); }
    if (d.copiar != null) return copiar(d.copiar);
    if (d.alternar) { E.config[d.alternar] = !E.config[d.alternar]; host.enviar("config", { [d.alternar]: E.config[d.alternar] }); return render(); }
    if (d.probar) { E.probando[d.probar] = true; delete E.resultadoIA[d.probar]; host.enviar("probarIA", { id: d.probar }); return render(); }
    if (d.modelo) { E.descarga = { id: d.modelo, pct: 0 }; host.enviar("descargarModelo", { id: d.modelo }); return render(); }
    if (d.modeloUsar) { E.config.modelo = d.modeloUsar; host.enviar("config", { modelo: d.modeloUsar }); return render(); }
    if (d.permiso) return host.enviar("permiso", { tipo: d.permiso });
    if (d.bv) { E.bv = Number(d.bv); return render(); }
    const t = E.grabaciones.find((x) => x.ruta === E.sel);
    switch (d.accion) {
      case "grabar": return host.enviar("grabar");
      case "ajustes": E.ajustes = true; return render();
      case "cerrar": E.ajustes = false; E.borrar = null; return render();
      case "carpeta": return host.enviar("abrirCarpeta", { ruta: t?.ruta || "" });
      case "carpeta-base": return host.enviar("abrirCarpeta", {});
      case "regenerar": if (t) { host.enviar("procesar", { ruta: t.ruta, soloIA: true }); toast("Volviendo a escribir…"); } return;
      case "reintentar": if (t) host.enviar("procesar", { ruta: t.ruta, soloIA: !t.audio }); return;
      case "borrar": E.borrar = t?.ruta || null; return render();
      case "confirmar-borrar": host.enviar("borrar", { ruta: E.borrar }); E.borrar = null; E.sel = null; return render();
      case "bv-despues": case "bv-fin": E.bv = null; E.bvCerrada = true; return render();
    }
  });
  document.addEventListener("change", async (ev) => {
    const clave = ev.target.dataset?.config;
    if (!clave) return;
    E.config[clave] = ev.target.value;
    host.enviar("config", { [clave]: ev.target.value });
    if (clave === "idioma_ui") await cargarIdioma();
    render();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && (E.ajustes || E.borrar)) { E.ajustes = false; E.borrar = null; render(); }
  });

  // ───────────── Lo que manda la app ─────────────
  window.Graba = {
    async estado(e) {
      const antes = JSON.stringify([E.grabaciones, E.config, E.permisos, E.fase, E.ias, E.modelos]);
      Object.assign(E, { fase: e.fase, grabaciones: e.grabaciones || [], config: e.config || {}, ias: e.ias || [], modelos: e.modelos || { lista: [] },
        permisos: e.permisos || {}, carpeta: e.carpeta || "", version: e.version || "", procesando: e.procesando });
      if (e.seleccionar) { E.sel = e.seleccionar; E.pestana = "notas"; }
      // Si la carpeta cambió de nombre al terminar (queda con el título), se sigue la misma graba.
      if (E.sel && !E.grabaciones.some((t) => t.ruta === E.sel)) {
        const prefijo = E.sel.split("/").pop().slice(0, 10);
        E.sel = E.grabaciones.find((t) => t.nombre.startsWith(prefijo))?.ruta || E.grabaciones[0]?.ruta || null;
      }
      if (!E.sel && E.grabaciones.length) E.sel = E.grabaciones[0].ruta;
      const falta = !E.config.ia || !(E.modelos.lista || []).some((m) => m.listo);
      if (falta && E.bv === null && !E.bvCerrada) E.bv = 0;
      await cargarIdioma();
      if (e.aviso) toast(e.aviso);
      // No se repinta si nada cambió (así el video no se reinicia cada segundo).
      if (JSON.stringify([E.grabaciones, E.config, E.permisos, E.fase, E.ias, E.modelos]) !== antes || e.seleccionar || !$("#app").innerHTML) render();
    },
    iaProbada(r) { delete E.probando[r.id]; E.resultadoIA[r.id] = r; if (r.ok) { E.config.ia = r.id; toast("Lista para usar"); } render(); },
    modeloProgreso(r) { E.descarga = { id: r.id, pct: r.pct }; render(); },
    modeloListo(r) { E.descarga = null; if (r.ok) { E.config.modelo = r.id; toast("Descargado"); } else toast(r.error || "No se pudo descargar"); render(); },
    _probar(f) { f(E); render(); },
    _pruebas: { parsearGrabacion, mdHTML, reloj },
  };

  // ───────────── Vista previa en el navegador (datos ficticios de demo.json) ─────────────
  let DEMO = null;
  function simular(accion, d) {
    if (!DEMO) return;
    const enviar = () => window.Graba.estado(DEMO);
    if (accion === "listo") return enviar();
    if (accion === "grabar") return toast("En la app, aquí empieza la grabación");
    if (accion === "config") { Object.assign(DEMO.config, d); return enviar(); }
    if (accion === "borrar") { DEMO.grabaciones = DEMO.grabaciones.filter((t) => t.ruta !== d.ruta); return enviar(); }
    if (accion === "probarIA") return setTimeout(() => { DEMO.config.ia = d.id; window.Graba.iaProbada({ id: d.id, ok: true, texto: "listo" }); enviar(); }, 500);
    if (accion === "descargarModelo") {
      let p = 0; const iv = setInterval(() => { p += 0.25; window.Graba.modeloProgreso({ id: d.id, pct: Math.min(p, 1) });
        if (p >= 1) { clearInterval(iv); DEMO.modelos.lista.find((m) => m.id === d.id).listo = true; DEMO.config.modelo = d.id; window.Graba.modeloListo({ id: d.id, ok: true }); enviar(); } }, 300);
    }
    if (accion === "permiso") { DEMO.permisos[d.tipo] = true; return enviar(); }
  }

  const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#17151c"/><rect x="12" y="15" width="40" height="28" rx="5" fill="none" stroke="#b9b0ff" stroke-width="4"/><circle cx="21" cy="44" r="10" fill="#6d5dfc" stroke="#17151c" stroke-width="3"/><circle cx="44" cy="22" r="3.2" fill="#ff5d5d"/></svg>`;

  async function iniciar() {
    if (HOST === "web") {
      try { DEMO = await (await fetch("demo.json")).json(); } catch { DEMO = { grabaciones: [], config: {}, ias: [], modelos: { lista: [] }, permisos: {} }; }
      if (new URLSearchParams(location.search).has("bienvenida")) { DEMO.config.ia = ""; } else { E.bvCerrada = true; }
    }
    host.enviar("listo");
  }
  iniciar();
})();
