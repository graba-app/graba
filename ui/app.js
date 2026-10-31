// Interfaz de Graba: la misma en Mac (WKWebView), Windows y Linux (Electron) y en el navegador (vista previa con demo.json).
// La app manda el estado con window.Graba.estado(json); la interfaz pide cosas con host.enviar(accion, datos).
(() => {
  "use strict";
  // ───────────── Puente con la app: pieza «host-ui» (ui/host.js). En el navegador responde simular() (más abajo). ─────────────
  // host.plataforma es "mac" | "windows" | "linux" | "web" y queda en <html data-host>.
  const host = PiezaHost.crearHost({ nombre: "graba", global: "Graba", simular: (accion, d, c) => simular(accion, d, c) });
  const HOST = host.plataforma;
  // Vidrio: fondo translúcido como la barra de grabación (lo pone el sistema: Mac y Windows 11). En el navegador, ?vidrio para verlo.
  if (window.GRABA_VIDRIO || new URLSearchParams(location.search).has("vidrio")) document.documentElement.classList.add("vidrio");
  const E = {
    fase: "inactiva", grabaciones: [], config: {}, ias: [], modelos: { lista: [] }, permisos: {}, carpeta: "", version: "", procesando: null,
    sel: null, pestana: "notas", ajustes: false, bv: null, bvCerrada: false, descarga: null,
    idioma: "es", idiomaFoco: null, actualizacion: { hay: false }, youtube: { conectado: false }, conectandoYT: false,
  };
  const ENLACES = { sitio: "https://graba-app.github.io/graba/", codigo: "https://github.com/graba-app/graba",
    comunidad: "https://github.com/graba-app/graba/discussions", aportar: "https://github.com/graba-app/graba/blob/main/CONTRIBUTING.md",
    guiaIA: "https://graba-app.github.io/graba/ia.html" };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ───────────── Idiomas: pieza «i18n» (ui/i18n.js; las claves son el texto en español) ─────────────
  // tr y traducirDOM traducen lo ya pintado (nunca [data-sin-traducir], código ni textarea); Tp arma una frase con marcadores en
  // texto plano. E.idioma es solo un espejo de i18n.idioma para el resto de la interfaz (fechas, pantalla de idioma).
  const i18n = PiezaI18n.crear();
  const { tr, Tp, traducirDOM } = i18n;
  /** Idioma del sistema: el que se sugiere en la pantalla de idioma y el que se usa mientras la persona no elige. */
  const idiomaSistema = () => i18n.idiomaDelSistema();
  let idiomaElegido = null;
  async function cargarIdioma(elegido) {
    // Lo recién elegido > ?idioma= (vista previa y pruebas) > lo guardado > el del sistema.
    if (elegido) idiomaElegido = elegido;
    await i18n.cargar(i18n.elegir({ elegido: idiomaElegido, config: E.config.idioma_ui }));
    E.idioma = i18n.idioma;
  }

  // ───────────── Tema y componentes: piezas «tema» (ui/tema.js + tema.css) y «componentes» (diálogos, avisos, Tu IA, actualizaciones, Acerca de) ─────────────
  const tema = PiezaTema.crear({ guardar: (v) => { E.config.tema = v; host.enviar("config", { tema: v }); } });
  const ui = PiezaComponentes.crear({
    i18n, host, app: "Graba", repo: "graba-app/graba", version: () => E.version,
    pintar: () => render(),
    cerrar: cerrarDialogo,                          // Esc, el velo o ✕ sobre un diálogo de Graba
    retener: () => E.bv === 0,                      // en la pantalla de idioma no se muestra nada más
    elegirIA: (id) => { E.config.ia = id; },        // la app ya la guardó al probarla bien
  });
  /** Avisos: la frase en español (se traduce) o, con { traducido: true }, el texto tal cual (lo que ya viene traducido de la app). */
  const toast = (texto, o) => ui.aviso(texto, o);
  function copiar(texto, aviso = "Copiado") {
    host.enviar("copiar", { texto });
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
  /** El guion como texto corrido para leer: sin títulos de sección, viñetas ni negritas (las indicaciones [entre corchetes] quedan). */
  const paraTeleprompter = (t) => String(t || "").replace(/^#{1,6}\s+.*$/gm, "").replace(/^\s*(\d+[.)]|[-*•])\s+/gm, "").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
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
    // Primer uso: lo primero es elegir el idioma, sola en la pantalla (sin la app detrás ni avisos).
    if (E.bv === 0) {
      const foco = document.activeElement?.dataset?.idiomaUi || E.idiomaFoco || idiomaSistema();
      raiz.innerHTML = pantallaIdioma();
      document.documentElement.lang = E.idioma;
      $(`[data-idioma-ui="${foco}"]`)?.focus();
      return;
    }
    const scroll = $(".principal-area")?.scrollTop || 0;
    raiz.innerHTML = `<div class="app">${lateral()}<main class="principal-area" data-pagina>${avisoActualizacion()}${principal()}</main></div>${dialogos()}${ui.capas()}`;
    traducirDOM(raiz);
    const area = $(".principal-area"); if (area) area.scrollTop = scroll;
    ui.despuesDePintar();
  }

  /** Versión nueva: aviso discreto arriba (nunca una alerta del sistema) y, al actualizar, el avance por pasos. El estado es el de la
   *  pieza «componentes» (ui.act: el mismo que la fila de Ajustes); los botones son los suyos (data-pz-act). */
  function avisoActualizacion() {
    const a = ui.act.estado;
    if (a && typeof a === "object") {
      const error = a.paso === "error", pct = a.pct ?? (Number(a.paso) || 0) / (a.total || 3) * 100;
      return `<div class="aviso-act ${error ? "error" : ""}" role="status"><div class="txt"><b>${error ? "No se pudo actualizar" : "Actualizando Graba"}</b>
        <span data-sin-traducir>${esc(a.texto || "")}</span>${error ? "" : `<div class="barra ${a.paso === "1" ? "indef" : ""}"><i style="width:${Math.round(pct)}%"></i></div>`}</div>
        ${error ? `<button class="pz-boton" data-accion="act-cerrar">Cerrar</button><button class="pz-boton pz-principal" data-pz-act="instalar">Reintentar</button>` : ""}</div>`;
    }
    if (!ui.act.disponible || E.actOculto) return "";
    return `<div class="aviso-act" role="status"><div class="txt"><b>Hay una versión nueva de Graba</b>
      <span data-sin-traducir>${esc((ui.act.disponible.notas || "").split("\n")[0])}</span></div>
      <button class="pz-boton" data-accion="act-despues">Después</button><button class="pz-boton pz-principal" data-pz-act="instalar">Actualizar</button></div>`;
  }

  /** El botón Grabar dice siempre lo mismo que la barra de grabación: grabar solo empieza con su botón rojo. */
  function botonGrabar(grande) {
    const g = grande ? " grande" : "";
    if (E.fase === "grabando") {
      const pausa = `<button class="pz-boton pausa" data-accion="pausar" title="${E.pausada ? "Reanudar la grabación" : "Pausar la grabación"}" aria-label="${E.pausada ? "Reanudar la grabación" : "Pausar la grabación"}">${E.pausada ? "▶" : "❚❚"}</button>`;
      return `<span class="grupo-grabar"><button class="pz-boton grabar${g}" data-accion="terminar" title="Terminar y guardar"><span class="cuadro"></span><span>Terminar</span><span class="reloj-vivo">${E.pausada ? "En pausa" : reloj(segundosGrabando())}</span></button>${pausa}</span>`;
    }
    if (E.fase === "cuenta" || E.fase === "terminando") {
      return `<button class="pz-boton grabar${g}" disabled><span class="punto"></span><span>${E.fase === "cuenta" ? "Empezando…" : "Guardando…"}</span></button>`;
    }
    const nota = E.fase === "preparando" && grande ? `<p class="nota-grabar">La barra de grabación está abierta: toca su botón rojo para empezar.</p>` : "";
    return `<button class="pz-boton grabar${g}" data-accion="grabar"><span class="punto"></span><span>Grabar</span></button>${nota}`;
  }
  const segundosGrabando = () => (E.pausada ? E.segundos : E.grabandoDesde ? (Date.now() - E.grabandoDesde) / 1000 : 0);
  // El reloj del botón avanza solo, sin volver a pintar toda la ventana.
  setInterval(() => {
    if (E.fase !== "grabando" || E.pausada) return;
    document.querySelectorAll(".reloj-vivo").forEach((n) => (n.textContent = reloj(segundosGrabando())));
  }, 1000);

  function lateral() {
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
        ${botonGrabar(true)}
        <div class="opciones-grabar">
          <button class="alternar" data-alternar="camara" aria-pressed="${!!E.config.camara}">📷 <span>Cámara</span></button>
          <button class="alternar" data-alternar="microfono" aria-pressed="${!!E.config.microfono}">🎙️ <span>Micrófono</span></button>
        </div>
        <button class="pz-boton secundario-ancho" data-accion="guion-nuevo">✨ <span>Preparar un guion</span></button>
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
        <div class="acciones"><button class="pz-boton pz-principal" data-accion="reintentar">Reintentar</button>
        <button class="pz-boton" data-accion="ajustes">Revisar ajustes</button></div></div>`;
    } else {
      cuerpo = pestanas(t, p);
    }
    return `<div class="contenido">
      <div class="titulo-graba"><h1 data-sin-traducir>${esc(titulo)}</h1>
        <div class="acciones">
          <button class="icono" data-accion="carpeta" title="Mostrar en la carpeta" aria-label="Mostrar en la carpeta">📁</button>
          ${e === "lista" && t.video ? `<button class="icono" data-accion="recortar" title="Recortar el inicio y el final" aria-label="Recortar el inicio y el final">✂</button>` : ""}
          ${e === "lista" ? `<button class="icono" data-accion="corregir" title="Corregir con tu IA" aria-label="Corregir con tu IA">✎</button>` : ""}
          ${e === "lista" ? `<button class="icono" data-accion="regenerar" title="Volver a escribir con la IA" aria-label="Volver a escribir con la IA">↻</button>` : ""}
          <button class="icono" data-accion="borrar" title="Borrar" aria-label="Borrar">🗑</button>
        </div></div>
      <div class="meta" data-sin-traducir>${esc(fechaCorta(m.inicio))}${m.duracion_seg ? " · " + reloj(m.duracion_seg) : ""}</div>
      ${t.video ? `<video id="video" controls preload="metadata" src="${esc(t.video + (t.video.includes("?") ? "&" : "?") + "v=" + (t.version || 0))}"></video>` : ""}
      ${E.recorte && E.recorte.ruta === t.ruta ? panelRecorte(t) : t.recortada && e === "lista" ? `<div class="aviso-recorte"><span>Esta grabación está recortada. El original quedó guardado.</span><button class="pz-boton" data-accion="deshacer-recorte">Volver al original</button></div>` : ""}
      ${cuerpo}</div>`;
  }

  /** Recortar: dos tiradores (inicio y fin) sobre la duración del video. Mover uno muestra ese cuadro en el video. */
  function panelRecorte(t) {
    const r = E.recorte, dur = r.duracion;
    const pct = (s) => (dur ? (s / dur) * 100 : 0);
    return `<section class="tarjeta recorte" aria-labelledby="t-recorte"><div class="tarjeta-cabeza"><h3 id="t-recorte">Recortar el inicio y el final</h3></div>
      <p class="nota">Lo que quede fuera se quita del video, los subtítulos, la transcripción y los capítulos. El original queda guardado y puedes volver a él.</p>
      <div class="tiradores" style="--a:${pct(r.inicio)}%;--b:${pct(r.fin)}%">
        <div class="pista"><i></i></div>
        <input type="range" id="recorte-inicio" data-recorte="inicio" min="0" max="${dur}" step="0.1" value="${r.inicio}" aria-label="Inicio del recorte" aria-valuetext="${reloj(r.inicio)}">
        <input type="range" id="recorte-fin" data-recorte="fin" min="0" max="${dur}" step="0.1" value="${r.fin}" aria-label="Final del recorte" aria-valuetext="${reloj(r.fin)}">
      </div>
      <div class="tiempos-recorte">
        <span>Inicio: <b id="recorte-t-inicio" data-sin-traducir>${reloj(r.inicio)}</b> <button class="pz-boton chico" data-accion="recorte-marcar-inicio">Marcar donde va el video</button></span>
        <span>Final: <b id="recorte-t-fin" data-sin-traducir>${reloj(r.fin)}</b> <button class="pz-boton chico" data-accion="recorte-marcar-fin">Marcar donde va el video</button></span>
        <span>Duración final: <b id="recorte-t-queda" data-sin-traducir>${reloj(Math.max(0, r.fin - r.inicio))}</b></span>
      </div>
      ${r.error ? `<p class="pz-error-texto" data-sin-traducir>${esc(r.error)}</p>` : ""}
      <div class="acciones"><button class="pz-boton" data-accion="recorte-ver">Ver cómo empieza</button>
        <button class="pz-boton" data-accion="recorte-cancelar" ${r.enviando ? "disabled" : ""}>Cancelar</button>
        <button class="pz-boton pz-principal" data-accion="recorte-aplicar" ${r.enviando || r.fin - r.inicio < 1 ? "disabled" : ""}>${r.enviando ? "Recortando…" : "Recortar"}</button></div></section>`;
  }

  const PESTANAS = [["notas", "Notas"], ["guion", "Guion"], ["youtube", "YouTube"], ["subtitulos", "Subtítulos"], ["transcripcion", "Transcripción"]];
  function pestanas(t, p) {
    const barra = `<div class="pestanas" role="tablist">${PESTANAS.map(([id, n]) =>
      `<button class="pestana" role="tab" data-pestana="${id}" aria-selected="${E.pestana === id}">${n}</button>`).join("")}</div>`;
    const bloque = (titulo, html, texto) => `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>${titulo}</h3>
      ${texto != null ? `<button class="pz-boton" data-copiar="${esc(texto)}">Copiar</button>` : ""}</div><div class="md" data-sin-traducir>${html}</div></section>`;
    const s = p.secciones, pub = p.publicar;
    let html = "";
    if (E.pestana === "notas") {
      html = bloque("Resumen", mdHTML(s["Resumen"]), s["Resumen"] || "") + (s["Notas"] ? bloque("Notas", mdHTML(s["Notas"]), s["Notas"]) : "");
    } else if (E.pestana === "guion") {
      const guion = s["Guion para YouTube"] || "";
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Guion para YouTube</h3>
        <button class="pz-boton" data-teleprompter="${esc(paraTeleprompter(guion))}" title="Para regrabarlo leyendo: solo tú lo ves">Usar en el teleprompter</button>
        <button class="pz-boton" data-copiar="${esc(guion)}">Copiar</button></div><div class="md" data-sin-traducir>${mdHTML(guion)}</div></section>`;
    } else if (E.pestana === "youtube") {
      const titulos = (pub["Títulos"] || "").split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
      const capitulos = pub["Capítulos"] || "", descripcion = pub["Descripción"] || "";
      const todo = [descripcion, capitulos].filter(Boolean).join("\n\n");
      html = publicarYouTube(t) + `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Títulos</h3></div>${titulos.map((x) =>
        `<div class="titulo-opcion"><span data-sin-traducir>${esc(x)}</span><small>${x.length}/100</small><button class="pz-boton" data-copiar="${esc(x)}">Copiar</button></div>`).join("")}</section>`
        + `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Descripción con capítulos</h3><button class="pz-boton pz-principal" data-copiar="${esc(todo)}">Copiar</button></div>
          <pre class="bloque" data-sin-traducir>${esc(todo)}</pre></section>`
        + bloque("Etiquetas", `<p>${esc(pub["Etiquetas"] || "")}</p>`, pub["Etiquetas"] || "");
    } else if (E.pestana === "subtitulos") {
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Subtítulos (.srt)</h3>
        <button class="pz-boton" data-accion="carpeta">Mostrar el archivo</button></div>
        <p>El archivo subtitulos.srt está en la carpeta de esta grabación. En YouTube Studio: Subtítulos → Agregar idioma → Subir archivo → "Con sincronización".</p></section>`;
    } else {
      const lineas = (s["Transcripción"] || "").split("\n").filter(Boolean).map((l) => {
        const m = l.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.*)$/);
        return m ? `<p><time data-ir="${aSegundos(m[1])}">${esc(m[1])}</time>${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
      }).join("");
      html = `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Transcripción</h3><button class="pz-boton" data-copiar="${esc(s["Transcripción"] || "")}">Copiar</button></div>
        <div class="transcripcion" data-sin-traducir>${lineas}</div></section>`;
    }
    return barra + html;
  }

  const PRIVACIDAD = [["private", "Privado"], ["unlisted", "No listado"], ["public", "Público"]];
  const selPrivacidad = () => `<select data-config="youtube_privacidad">${PRIVACIDAD.map(([v, n]) =>
    `<option value="${v}" ${(E.config.youtube_privacidad || "private") === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  /** Subir a YouTube con un clic (o ya subido / subiendo / con error). */
  function publicarYouTube(t) {
    const y = t.youtube || {};
    let cuerpo;
    if (y.estado === "lista") {
      cuerpo = `<p><span>Publicado en YouTube</span> · <span>${(PRIVACIDAD.find(([v]) => v === y.privacidad) || ["", "Privado"])[1]}</span></p>
        ${y.aviso ? `<p class="pz-error-texto" data-sin-traducir>${esc(y.aviso)}</p>` : ""}
        <div class="acciones"><button class="pz-boton pz-principal" data-pz-enlace="${esc(y.url)}">Abrir en YouTube</button><button class="pz-boton" data-copiar="${esc(y.url)}">Copiar enlace</button></div>`;
    } else if (y.estado === "subiendo") {
      cuerpo = `<p>Subiendo a YouTube…</p><div class="barra ${y.pct ? "" : "indef"}"><i style="width:${y.pct || 0}%"></i></div>`;
    } else if (!E.youtube.conectado && !E.youtube.disponible) {
      cuerpo = `<p>Muy pronto: subir directo a tu canal con un clic. Mientras, copia el título y la descripción de aquí abajo.</p>`;
    } else if (!E.youtube.conectado) {
      cuerpo = `<p>Conecta tu canal una vez y sube cada video con un clic: título, descripción con capítulos, etiquetas y subtítulos.</p>
        <button class="pz-boton" data-accion="yt-conectar" ${E.conectandoYT ? "disabled" : ""}>${E.conectandoYT ? "Abriendo tu navegador…" : "Conectar YouTube"}</button>`;
    } else {
      cuerpo = `${y.estado === "error" ? `<p class="pz-error-texto" data-sin-traducir>${esc(y.error || "")}</p>` : ""}
        <div class="acciones">${selPrivacidad()}<button class="pz-boton pz-principal" data-accion="yt-subir">${y.estado === "error" ? "Reintentar" : "Subir a YouTube"}</button></div>
        <small class="nota-guion">Se sube con el primer título, la descripción con capítulos, las etiquetas y los subtítulos.</small>`;
    }
    return `<section class="tarjeta"><div class="tarjeta-cabeza"><h3>Publicar en YouTube</h3>${E.youtube.canal ? `<small data-sin-traducir>${esc(E.youtube.canal)}</small>` : ""}</div>${cuerpo}</section>`;
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
      ${botonGrabar(false)}
      <p class="atajos">${HOST === "windows" || HOST === "linux" ? "Atajos: Ctrl+Alt+Shift+R empieza o termina la grabación y Ctrl+Alt+Shift+P la pausa." : "Atajos: ⌃⌥⌘R empieza o termina la grabación y ⌃⌥⌘P la pausa."}</p></div>`;
  }

  // ───────────── Ajustes y bienvenida ─────────────
  const filasIA = () => ui.filasIA({ ias: E.ias, elegida: E.config.ia, guia: ENLACES.guiaIA });
  function filasModelo() {
    return (E.modelos.lista || []).map((m) => {
      const enUso = E.config.modelo === m.id && m.listo, bajando = E.descarga?.id === m.id;
      const accion = enUso ? `<span class="pz-ok">✓ En uso</span>` : m.listo ? `<button class="pz-boton" data-modelo-usar="${m.id}">Usar</button>`
        : bajando ? `<div style="width:120px"><div class="barra"><i style="width:${Math.round(E.descarga.pct * 100)}%"></i></div></div>`
          : `<button class="pz-boton" data-modelo="${m.id}" ${E.descarga ? "disabled" : ""}>Descargar · ${m.mb} MB</button>`;
      const rec = m.id === E.modelos.recomendado ? ` <span class="chip">Recomendado</span>` : "";
      return `<div class="pz-fila"><div class="pz-txt"><b>${esc(m.nombre)}${rec}</b><small>${esc(m.detalle)}</small></div>${accion}</div>`;
    }).join("");
  }
  function filasPermisos() {
    return [["pantalla", "Grabar la pantalla", "Para que el video muestre lo que haces."], ["camara", "Cámara", "Para la burbuja con tu cara."],
      ["microfono", "Micrófono", "Para tu voz y la transcripción."]].map(([id, n, d]) =>
      `<div class="pz-fila"><div class="pz-txt"><b>${n}</b><small>${d}</small></div>${E.permisos[id]
        ? `<span class="pz-ok">✓ Permitido</span>` : `<button class="pz-boton" data-permiso="${id}">Permitir</button>`}</div>`).join("");
  }
  const IDIOMAS_AUDIO = [["auto", "Detectar solo"], ["es", "Español"], ["en", "Inglés"], ["pt", "Portugués"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"]];

  const DURACIONES = [1, 2, 3, 5, 8, 10, 15];
  function dialogoGuion() {
    const g = E.guion;
        if (g.paso === "creando") {
      return `<p>Tu IA está escribiendo el guion…</p><div class="barra indef"><i></i></div>
        <div class="pz-pie"><button class="pz-boton" data-accion="cerrar-guion">Cerrar</button></div>`;
    }
    if (g.paso === "listo") {
      const palabras = (g.texto || "").replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
      return `<p data-sin-traducir><b>${esc(g.titulo || "")}</b></p>
        <textarea id="guion-texto" rows="12" data-sin-traducir>${esc(g.texto || "")}</textarea>
        <p class="nota-guion">Unas ${palabras} palabras · cerca de ${Math.max(1, Math.round(palabras / 140))} min. Puedes editarlo aquí.</p>
        <div class="pz-pie"><button class="pz-boton" data-accion="guion-otra-vez">Volver a crear</button>
          <button class="pz-boton" data-accion="guion-guardar">Guardar en el teleprompter</button>
          <button class="pz-boton pz-principal" data-accion="guion-grabar"><span class="punto"></span><span>Grabar con este guion</span></button></div>`;
    }
    return `<p>Tu IA escribe lo que vas a decir, con el largo justo. Después lo lees en el teleprompter mientras grabas.</p>
      <label class="pz-campo"><span>¿De qué se trata?</span>
        <textarea id="guion-idea" rows="4" placeholder="${esc(tr("Ej.: presento Graba a mi equipo: qué hace, cómo se usa y por qué es privada."))}" data-sin-traducir>${esc(g.idea || "")}</textarea></label>
      <div class="fila-campos">
        <label class="pz-campo"><span>Duración</span><select id="guion-min">${DURACIONES.map((m) => `<option value="${m}" ${Number(g.minutos) === m ? "selected" : ""}>${m} min</option>`).join("")}</select></label>
        <label class="pz-campo"><span>Para</span><select id="guion-para">${[["youtube", "YouTube"], ["presentacion", "Una presentación"], ["tutorial", "Un tutorial"]].map(([v, n]) =>
          `<option value="${v}" ${g.para === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      <div class="pz-campo"><span>Archivos (opcional)</span>
        <div class="archivos">${(g.archivos || []).map((a, i) => `<span class="chip-archivo"><span data-sin-traducir>${esc(a.nombre)}</span><button data-quitar-archivo="${i}" aria-label="Quitar" title="Quitar">✕</button></span>`).join("")}
          <button class="pz-boton" data-accion="guion-archivos">＋ Agregar archivos</button></div>
        <small>PDF, PowerPoint, Word, texto o imágenes. Keynote: expórtalo a PDF primero.</small></div>
      ${g.error ? `<p class="pz-error-texto" data-sin-traducir>${esc(g.error)}</p>` : ""}
      <div class="pz-pie"><button class="pz-boton" data-accion="cerrar-guion">Cancelar</button>
        <button class="pz-boton pz-principal" data-accion="guion-crear">Crear guion</button></div>`;
  }

  function dialogos() {
    if (E.guion) return ui.dialogo({ id: "t-guion", titulo: "Preparar un guion", cuerpo: dialogoGuion() });
    if (E.corregir) {
      const c = E.corregir;
      return ui.dialogo({ id: "t-corregir", titulo: "Corregir con tu IA", cerrable: !c.enviando, sinEsc: !!c.enviando, cuerpo: `<p>Dile qué está mal, en tus palabras. Corrige el título, las notas, el guion, la descripción y, si una palabra quedó mal transcrita, también los subtítulos. Graba la recuerda para las próximas veces.</p>
        <textarea id="corregir-texto" rows="4" placeholder="${esc(tr("Ej.: dice Grava y es Graba · el título tiene que hablar de presupuestos · el gancho más corto"))}" ${c.enviando ? "disabled" : ""} data-sin-traducir>${esc(c.texto || "")}</textarea>
        ${c.error ? `<p class="pz-error-texto" data-sin-traducir>${esc(c.error)}</p>` : ""}
        <div class="pz-pie"><button class="pz-boton" data-accion="cerrar">Cancelar</button>
          <button class="pz-boton pz-principal" data-accion="enviar-correccion" ${c.enviando ? "disabled" : ""}>${c.enviando ? "Tu IA está corrigiendo…" : "Corregir"}</button></div>` });
    }
    if (E.bv !== null) return bienvenida();
    if (!E.ajustes) return "";
    const sel = (clave, opciones) => `<select data-config="${clave}">${opciones.map(([v, n]) => `<option value="${v}" ${E.config[clave] === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
    return ui.dialogo({ id: "t-ajustes", titulo: "Ajustes", cuerpo: `<p>Todo se procesa en tu computador. La IA usa tu propia cuenta.</p>
      <div class="seccion"><h3>Tu IA</h3>${filasIA()}</div>
      <div class="seccion"><h3>Transcripción</h3>${filasModelo()}
        <div class="pz-fila"><div class="pz-txt"><b>Idioma en que hablas</b><small>Si siempre hablas en el mismo, elegirlo mejora la transcripción.</small></div>${sel("idioma_audio", IDIOMAS_AUDIO)}</div></div>
      <div class="seccion"><h3>Permisos</h3>${filasPermisos()}</div>
      <div class="seccion"><h3>YouTube</h3>
        ${E.youtube.conectado ? `<div class="pz-fila"><div class="pz-txt"><b>Conectado</b><small data-sin-traducir>${esc(E.youtube.canal || "")}</small></div><button class="pz-boton" data-accion="yt-desconectar">Desconectar</button></div>
          <div class="pz-fila"><div class="pz-txt"><b>Privacidad al subir</b><small>Puedes cambiarla después en YouTube Studio.</small></div>${selPrivacidad()}</div>
          <div class="pz-fila"><div class="pz-txt"><b>Subir sola al terminar</b><small>Cada grabación nueva se sube apenas tu IA termina de escribir.</small></div>
            <input type="checkbox" class="interruptor" data-config-bool="youtube_auto" ${E.config.youtube_auto ? "checked" : ""} aria-label="Subir sola al terminar"></div>`
          : `<div class="pz-fila"><div class="pz-txt"><b>Tu canal</b><small>${E.youtube.disponible ? "Sube directo desde tu computador, con tu permiso. Lo puedes quitar cuando quieras." : "Muy pronto: subir directo a tu canal con un clic."}</small></div>
            ${E.youtube.disponible ? `<button class="pz-boton" data-accion="yt-conectar" ${E.conectandoYT ? "disabled" : ""}>${E.conectandoYT ? "Abriendo tu navegador…" : "Conectar YouTube"}</button>` : ""}</div>`}
        <details class="avanzado"><summary>Usar mi propio proyecto de Google (avanzado)</summary>
          <p>Si subes muchos videos al día, crea un cliente OAuth de escritorio con la YouTube Data API v3 y pega sus datos aquí.</p>
          <input class="texto" data-config-texto="youtube_client_id" placeholder="ID de cliente" value="${esc(E.config.youtube_client_id || "")}" data-sin-traducir>
          <input class="texto" data-config-texto="youtube_client_secret" placeholder="Secreto del cliente" value="${esc(E.config.youtube_client_secret || "")}" data-sin-traducir></details></div>
      <div class="seccion"><h3>General</h3>
        <div class="pz-fila"><div class="pz-txt"><b>Idioma de la app</b></div>${sel("idioma_ui", [["es", "Español"], ["en", "English"]])}</div>
        <div class="pz-fila"><div class="pz-txt"><b>Apariencia</b></div>${tema.selectorHTML()}</div>
        <div class="pz-fila"><div class="pz-txt"><b>Carpeta de grabaciones</b><small data-sin-traducir>${esc(E.carpeta)}</small></div><button class="pz-boton" data-accion="carpeta-base">Abrir</button></div></div>
      <div class="seccion"><h3>Actualizaciones</h3>${ui.filaActualizacion()}</div>
      <div class="seccion"><h3>Acerca de Graba</h3>${ui.acercaDe({ version: E.version, enlaces: ENLACES })}</div>`,
      pie: `<button class="pz-boton pz-principal" data-accion="cerrar">Listo</button>` });
  }

  /** Paso 0 de la bienvenida: el idioma, antes que cualquier otra cosa. Cada opción va escrita en su propio idioma y no se traduce. */
  function pantallaIdioma() {
    const sugerido = idiomaSistema();
    const opcion = (codigo, nombre, nota) => `<button class="opcion-idioma ${codigo === sugerido ? "sugerido" : ""}" lang="${codigo}" data-idioma-ui="${codigo}"
        ${codigo === sugerido ? `aria-describedby="nota-${codigo}"` : ""}><b>${nombre}</b>${codigo === sugerido ? `<small id="nota-${codigo}">${nota}</small>` : ""}</button>`;
    return `<div class="pantalla-idioma" data-sin-traducir><div class="tarjeta-idioma" role="dialog" aria-modal="true" aria-labelledby="t-idioma">${LOGO}
      <h1 id="t-idioma"><span lang="es">Elige tu idioma<span aria-hidden="true">&nbsp;·</span></span> <span lang="en">Choose your language</span></h1>
      <div class="opciones-idioma" role="group" aria-labelledby="t-idioma">
        ${opcion("es", "Español", "Idioma de tu sistema")}${opcion("en", "English", "Your system language")}</div></div></div>`;
  }
  async function elegirIdioma(codigo) {
    E.config.idioma_ui = codigo;
    host.enviar("config", { idioma_ui: codigo }); // el mismo camino que Ajustes
    await cargarIdioma(codigo);
    E.bv = 1;
    render();
    $("#t-bv")?.focus();
  }

  function bienvenida() {
    const paso = E.bv;
    const marcas = `<div class="pasos-bv">${[1, 2, 3, 4].map((i) => `<i class="${i <= paso ? "hecho" : ""}"></i>`).join("")}</div>`;
    const iaLista = !!E.config.ia, modeloListo = (E.modelos.lista || []).some((m) => m.listo && m.id === E.config.modelo);
    const pasos = [
      null, // el idioma (pantallaIdioma)
      [`Hola, esto es Graba`, `Graba tu pantalla con tu cámara y tu voz. Al terminar, la app transcribe en tu computador y tu propia IA escribe notas, un guion para YouTube, títulos, descripción con capítulos y subtítulos. Nada se sube a ningún servidor.`, "", true],
      [`Elige tu IA`, `Graba usa la IA que ya tienes, con tu cuenta. La probamos con una pregunta corta.`, filasIA(), iaLista],
      [`Descarga el transcriptor`, `Convierte tu voz en texto dentro de tu computador. Se descarga una sola vez.`, filasModelo(), modeloListo],
      [`Permisos`, `macOS pide permiso para grabar la pantalla, la cámara y el micrófono. Puedes cambiarlos cuando quieras.`, filasPermisos(), true],
    ];
    const [titulo, texto, filas, puede] = pasos[paso];
    // La bienvenida no se cierra con Esc ni con el velo: tiene «Lo hago después».
    return ui.dialogo({ id: "t-bv", titulo, cerrable: false, sinEsc: true, cuerpo: `${marcas}<p>${texto}</p><div class="seccion">${filas}</div>`, pie: `<button class="pz-boton" data-bv="${paso - 1}">Atrás</button>
        <button class="pz-boton" data-accion="bv-despues">Lo hago después</button>
        ${paso < 4 ? `<button class="pz-boton pz-principal" data-bv="${paso + 1}" ${puede ? "" : "disabled"}>Siguiente</button>`
          : `<button class="pz-boton pz-principal" data-accion="bv-fin">Empezar</button>`}` });
  }

  // ───────────── Eventos ─────────────
  /** Cierra el diálogo de Graba que está abierto (Esc, el velo, ✕ o «Cancelar»). Mientras la IA corrige, ese no se cierra. */
  function cerrarDialogo() {
    if (E.guion) E.guion = null;
    else if (E.corregir) { if (!E.corregir.enviando) E.corregir = null; }
    else E.ajustes = false;
    render();
  }
  document.addEventListener("click", (ev) => {
    // Primero lo de las piezas: apariencia, diálogos, Tu IA, actualizaciones, enlaces y comentarios.
    if (tema.manejarClic(ev)) return render();
    if (ui.manejarClic(ev)) return;
    const el = ev.target.closest("[data-accion],[data-sel],[data-pestana],[data-copiar],[data-teleprompter],[data-quitar-archivo],[data-alternar],[data-modelo],[data-modelo-usar],[data-permiso],[data-bv],[data-ir],[data-idioma-ui]");
    if (!el) return;
    const d = el.dataset;
    if (d.idiomaUi) return elegirIdioma(d.idiomaUi === "en" ? "en" : "es");
    if (d.ir) { const v = $("#video"); if (v) { v.currentTime = Number(d.ir); v.play?.(); } return; }
    if (d.sel) { E.sel = d.sel; return render(); }
    if (d.pestana) { E.pestana = d.pestana; return render(); }
    if (d.copiar != null) return copiar(d.copiar);
    if (d.quitarArchivo != null) { leerCamposGuion(); E.guion.archivos.splice(Number(d.quitarArchivo), 1); return render(); }
    if (d.teleprompter != null) { host.enviar("teleprompter", { texto: d.teleprompter }); return toast("Listo: lo verás en el teleprompter al grabar"); }
    if (d.alternar) { E.config[d.alternar] = !E.config[d.alternar]; host.enviar("config", { [d.alternar]: E.config[d.alternar] }); return render(); }
    if (d.modelo) { E.descarga = { id: d.modelo, pct: 0 }; host.enviar("descargarModelo", { id: d.modelo }); return render(); }
    if (d.modeloUsar) { E.config.modelo = d.modeloUsar; host.enviar("config", { modelo: d.modeloUsar }); return render(); }
    if (d.permiso) return host.enviar("permiso", { tipo: d.permiso });
    if (d.bv) { E.bv = Number(d.bv); return render(); }
    const t = E.grabaciones.find((x) => x.ruta === E.sel);
    switch (d.accion) {
      case "grabar": return host.enviar("grabar");
      case "terminar": return host.enviar("terminar");
      case "pausar": return host.enviar("pausar");
      case "recortar": {
        if (!t) return;
        const v = $("#video"), dur = Math.round(((v && isFinite(v.duration) && v.duration) || t.meta?.duracion_seg || 0) * 10) / 10;
        E.recorte = { ruta: t.ruta, inicio: 0, fin: dur, duracion: dur, enviando: false, error: "" };
        render(); return $("#recorte-inicio")?.focus();
      }
      case "recorte-cancelar": E.recorte = null; return render();
      case "recorte-marcar-inicio": case "recorte-marcar-fin": {
        const v = $("#video"); if (!v || !E.recorte) return;
        const cual = d.accion.endsWith("inicio") ? "inicio" : "fin";
        moverRecorte(cual, Math.round(v.currentTime * 10) / 10); return;
      }
      case "recorte-ver": { const v = $("#video"); if (v && E.recorte) { v.currentTime = E.recorte.inicio; v.play?.(); } return; }
      case "recorte-aplicar":
        if (!E.recorte || E.recorte.fin - E.recorte.inicio < 1) return;
        $("#video")?.pause?.();
        Object.assign(E.recorte, { enviando: true, error: "" });
        host.enviar("recortar", { ruta: E.recorte.ruta, inicio: E.recorte.inicio, fin: E.recorte.fin });
        return render();
      case "deshacer-recorte": if (t) { host.enviar("deshacerRecorte", { ruta: t.ruta }); toast("Volviendo al original…"); } return;
      case "ajustes": E.ajustes = true; return render();
      case "cerrar": return cerrarDialogo();
      case "yt-conectar": E.conectandoYT = true; host.enviar("youtubeConectar"); return render();
      case "yt-desconectar": host.enviar("youtubeDesconectar"); return;
      case "yt-subir": if (t) { t.youtube = { estado: "subiendo", pct: 0 }; host.enviar("youtubeSubir", { ruta: t.ruta }); } return render();
      case "act-cerrar": ui.act.estado = null; return render();
      case "act-despues": E.actOculto = true; return render();
      case "guion-nuevo": E.guion = { paso: "pedir", idea: "", minutos: 3, para: "youtube", archivos: [] }; render(); return $("#guion-idea")?.focus();
      case "cerrar-guion": E.guion = null; return render();
      case "guion-archivos": leerCamposGuion(); return host.enviar("elegirArchivos");
      case "guion-crear": {
        leerCamposGuion();
        if (!E.guion.idea.trim() && !E.guion.archivos.length) { E.guion.error = tr("Cuéntame la idea o agrega un archivo."); return render(); }
        const { idea, minutos, para, archivos } = E.guion;
        E.guion = { ...E.guion, paso: "creando", error: "" };
        host.enviar("crearGuion", { idea, minutos: Number(minutos), para, archivos: archivos.map((a) => a.ruta) });
        return render();
      }
      case "guion-otra-vez": E.guion = { ...E.guion, paso: "pedir" }; return render();
      case "guion-guardar": host.enviar("teleprompter", { texto: $("#guion-texto")?.value || "" }); E.guion = null; render(); return toast("Listo: lo verás en el teleprompter al grabar");
      case "guion-grabar": host.enviar("grabarConGuion", { texto: $("#guion-texto")?.value || "" }); E.guion = null; return render();
      case "corregir": E.corregir = { ruta: t?.ruta, texto: "" }; render(); return $("#corregir-texto")?.focus();
      case "enviar-correccion": {
        const texto = $("#corregir-texto")?.value.trim() || "";
        if (!texto) return $("#corregir-texto")?.focus();
        E.corregir = { ...E.corregir, texto, enviando: true, error: "" };
        host.enviar("corregir", { ruta: E.corregir.ruta, texto });
        return render();
      }
      case "carpeta": return host.enviar("abrirCarpeta", { ruta: t?.ruta || "" });
      case "carpeta-base": return host.enviar("abrirCarpeta", {});
      case "regenerar": if (t) { host.enviar("procesar", { ruta: t.ruta, soloIA: true }); toast("Volviendo a escribir…"); } return;
      case "reintentar": if (t) host.enviar("procesar", { ruta: t.ruta, soloIA: !t.audio }); return;
      case "borrar": return borrar(t);
      case "bv-despues": case "bv-fin": E.bv = null; E.bvCerrada = true; return render();
    }
  });
  async function borrar(t) {
    if (!t) return;
    const si = await ui.confirmar({ titulo: "¿Borrar esta grabación?", texto: "Se va a la Papelera con el video, las notas y los subtítulos. Puedes recuperarla desde ahí.",
      si: "Mover a la Papelera", peligro: true });
    if (!si) return;
    host.enviar("borrar", { ruta: t.ruta });
    if (E.sel === t.ruta) E.sel = null;
    render();
  }
  /** Mueve un tirador sin repintar todo (así el video no se recarga) y muestra ese cuadro. */
  function moverRecorte(cual, valor) {
    const r = E.recorte;
    if (!r) return;
    valor = Math.max(0, Math.min(r.duracion, valor));
    if (cual === "inicio") r.inicio = Math.min(valor, Math.max(0, r.fin - 1)); else r.fin = Math.max(valor, Math.min(r.duracion, r.inicio + 1));
    const caja = $(".tiradores");
    if (caja) { caja.style.setProperty("--a", `${(r.inicio / r.duracion) * 100}%`); caja.style.setProperty("--b", `${(r.fin / r.duracion) * 100}%`); }
    const ini = $("#recorte-inicio"), fin = $("#recorte-fin");
    if (ini) { ini.value = r.inicio; ini.setAttribute("aria-valuetext", reloj(r.inicio)); }
    if (fin) { fin.value = r.fin; fin.setAttribute("aria-valuetext", reloj(r.fin)); }
    const set = (id, s) => { const n = $(id); if (n) n.textContent = reloj(s); };
    set("#recorte-t-inicio", r.inicio); set("#recorte-t-fin", r.fin); set("#recorte-t-queda", Math.max(0, r.fin - r.inicio));
    const aplicar = $("[data-accion=recorte-aplicar]"); if (aplicar) aplicar.disabled = r.fin - r.inicio < 1 || r.enviando;
    const v = $("#video"); if (v) { v.pause?.(); v.currentTime = cual === "inicio" ? r.inicio : r.fin; }
  }
  document.addEventListener("input", (ev) => {
    const cual = ev.target.dataset?.recorte;
    if (cual) moverRecorte(cual, Number(ev.target.value));
  });

  document.addEventListener("change", async (ev) => {
    const ds = ev.target.dataset || {};
    if (ds.configBool) { E.config[ds.configBool] = ev.target.checked; host.enviar("config", { [ds.configBool]: ev.target.checked }); return render(); }
    if (ds.configTexto) { E.config[ds.configTexto] = ev.target.value.trim(); return host.enviar("config", { [ds.configTexto]: ev.target.value.trim() }); }
    const clave = ds.config;
    if (!clave) return;
    E.config[clave] = ev.target.value;
    host.enviar("config", { [clave]: ev.target.value });
    if (clave === "idioma_ui") await cargarIdioma(ev.target.value);
    render();
  });
  document.addEventListener("keydown", (ev) => {
    if (ui.manejarTecla(ev)) return;   // Esc y Tab en los diálogos (pieza «componentes»)
    // Pantalla de idioma: las flechas pasan de una opción a la otra (Tab y Enter funcionan solos).
    const opcion = ev.target.closest?.("[data-idioma-ui]");
    if (opcion && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
      ev.preventDefault();
      const otra = $(`[data-idioma-ui="${opcion.dataset.idiomaUi === "es" ? "en" : "es"}"]`);
      E.idiomaFoco = otra?.dataset.idiomaUi; otra?.focus();
      return;
    }
    if (ev.key === "Escape" && E.recorte && !E.recorte.enviando && !document.querySelector('[aria-modal="true"]')) { E.recorte = null; return render(); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && E.corregir && !E.corregir.enviando) $("[data-accion=enviar-correccion]")?.click();
  });

  // ───────────── Lo que manda la app ─────────────
  host.responder({
    async estado(e) {
      const antes = JSON.stringify([E.grabaciones, E.config, E.permisos, E.fase, E.pausada, E.ias, E.modelos, E.actualizacion, E.youtube]);
      Object.assign(E, { fase: e.fase, grabandoDesde: e.grabandoDesde || 0, pausada: !!e.pausada, segundos: e.segundos || 0, grabaciones: e.grabaciones || [], config: e.config || {}, ias: e.ias || [], modelos: e.modelos || { lista: [] },
        permisos: e.permisos || {}, carpeta: e.carpeta || "", version: e.version || "", procesando: e.procesando,
        actualizacion: e.actualizacion || { hay: false }, youtube: e.youtube || { conectado: false } });
      if (e.seleccionar) { E.sel = e.seleccionar; E.pestana = "notas"; }
      // Si la carpeta cambió de nombre al terminar (queda con el título), se sigue la misma graba.
      if (E.sel && !E.grabaciones.some((t) => t.ruta === E.sel)) {
        const prefijo = E.sel.split(/[\\/]/).pop().slice(0, 10); // en Windows las rutas van con barra invertida
        E.sel = E.grabaciones.find((t) => t.nombre.startsWith(prefijo))?.ruta || E.grabaciones[0]?.ruta || null;
      }
      if (!E.sel && E.grabaciones.length) E.sel = E.grabaciones[0].ruta;
      const falta = !E.config.ia || !(E.modelos.lista || []).some((m) => m.listo);
      // Con la bienvenida pendiente, el idioma va primero (si ya lo eligió, se parte en el saludo).
      if (falta && E.bv === null && !E.bvCerrada) E.bv = E.config.idioma_ui ? 1 : 0;
      await cargarIdioma();
      tema.aplicar(tema.elegir({ config: E.config.tema }));
      ui.actualizacionDisponible(E.actualizacion.hay ? { ...E.actualizacion, notas: E.actualizacion.notas ?? E.actualizacion.detalle } : null);
      if (e.aviso) toast(e.aviso, { traducido: true });
      // No se repinta si nada cambió (así el video no se reinicia cada segundo).
      if (JSON.stringify([E.grabaciones, E.config, E.permisos, E.fase, E.pausada, E.ias, E.modelos, E.actualizacion, E.youtube]) !== antes || e.seleccionar || !$("#app").innerHTML) render();
    },
    youtubeConectado(r) { E.conectandoYT = false; toast(r.ok ? "YouTube conectado" : (r.error || "No se pudo conectar")); render(); },
    youtubeSubido(r) { toast(r.ok ? "Subido a YouTube" : (r.error || "No se pudo subir")); render(); },
    // Actualizaciones: las lleva la pieza «componentes» (ui.act); Graba usa `detalle` como sus notas.
    actualizacionRevisada(r) { if (r.hay) { E.actualizacion = r; E.actOculto = false; } ui.actualizacionRevisada({ ...r, notas: r.notas ?? r.detalle }); },
    actualizacionProgreso(a) { ui.actualizacionProgreso(a); },
    archivosElegidos(lista) {
      if (!E.guion) return;
      leerCamposGuion();
      const ya = new Set(E.guion.archivos.map((a) => a.ruta));
      E.guion.archivos.push(...(lista || []).filter((a) => !ya.has(a.ruta)));
      render();
    },
    guionCreado(r) {
      if (!E.guion) return;
      E.guion = r.ok ? { ...E.guion, paso: "listo", titulo: r.titulo, texto: r.guion } : { ...E.guion, paso: "pedir", error: r.error || tr("No se pudo crear el guion.") };
      render();
    },
    recortado(r) {
      if (r.ok) { E.recorte = null; toast(r.deshacer ? "Listo: volviste al video original" : "Listo: recorté la grabación"); }
      else if (E.recorte) Object.assign(E.recorte, { enviando: false, error: r.error || tr("No pude recortar.") });
      else toast(r.error || "No pude recortar.");
      render();
    },
    corregido(r) {
      if (r.ok) { E.corregir = null; if (r.carpeta) E.sel = r.carpeta; toast(r.reemplazos ? "Corregido, también en los subtítulos" : "Corregido"); }
      else E.corregir = { ...(E.corregir || {}), enviando: false, error: r.error || "No se pudo corregir." };
      render();
    },
    iaProbada(r) { ui.iaProbada(r); },
    modeloProgreso(r) { E.descarga = { id: r.id, pct: r.pct }; render(); },
    modeloListo(r) { E.descarga = null; if (r.ok) { E.config.modelo = r.id; toast("Descargado"); } else toast(r.error || "No se pudo descargar"); render(); },
    _probar(f) { f(E); render(); },
    // Para las pruebas (pruebas/interfaz.mjs).
    _pruebas: { parsearGrabacion, mdHTML, reloj, paraTeleprompter, ui },
  });

  // ───────────── Vista previa en el navegador (datos ficticios de demo.json) ─────────────
  // host-ui la llama con (accion, datos, c): c.responder("x", json) hace lo que la app (una copia JSON a window.Graba.x) y
  // c.luego(ms, f) espera. Enlaces y copiar son los comunes de la pieza.
  let DEMO = null;
  const COMUNES = PiezaHost.simulacionesComunes();
  function simular(accion, d, c) {
    if (!DEMO) return;
    const enviar = () => c.responder("estado", DEMO);
    const grabacion = () => DEMO.grabaciones.find((x) => x.ruta === d.ruta);
    switch (accion) {
      case "listo": return enviar();
      case "abrirEnlace": case "copiar": return COMUNES[accion](d, c);
      case "grabar": return toast("En la app, aquí empieza la grabación");
      case "terminar": return toast("En la app, aquí termina la grabación");
      case "pausar": DEMO.pausada = !DEMO.pausada; if (!DEMO.pausada) DEMO.grabandoDesde = Date.now() - (DEMO.segundos || 0) * 1000; return enviar();
      case "config": Object.assign(DEMO.config, d); return enviar();
      case "borrar": DEMO.grabaciones = DEMO.grabaciones.filter((t) => t.ruta !== d.ruta); return enviar();
      case "probarIA": return c.luego(500, () => { DEMO.config.ia = d.ia; c.responder("iaProbada", { ia: d.ia, ok: true }); enviar(); });
      case "descargarModelo": {
        let p = 0;
        const paso = () => { p += 0.25; c.responder("modeloProgreso", { id: d.id, pct: Math.min(p, 1) });
          if (p < 1) return c.luego(300, paso);
          DEMO.modelos.lista.find((m) => m.id === d.id).listo = true; DEMO.config.modelo = d.id; c.responder("modeloListo", { id: d.id, ok: true }); enviar(); };
        return c.luego(300, paso);
      }
      case "permiso": DEMO.permisos[d.tipo] = true; return enviar();
      case "youtubeConectar": return c.luego(600, () => { DEMO.youtube = { conectado: true, canal: "Canal de Ana" }; c.responder("youtubeConectado", { ok: true }); enviar(); });
      case "youtubeDesconectar": DEMO.youtube = { conectado: false }; return enviar();
      case "youtubeSubir": return c.luego(900, () => { const g = grabacion(); if (g) g.youtube = { estado: "lista", url: "https://youtu.be/demo", privacidad: "private" }; c.responder("youtubeSubido", { ok: true }); enviar(); });
      case "buscarActualizacion": return c.luego(500, () => c.responder("actualizacionRevisada", { hay: false }));
      case "actualizar": {
        const textos = ["", "Descargando la versión nueva…", "Preparando la versión nueva…", "Instalando: Graba se cerrará y volverá a abrirse sola"];
        for (let n = 1; n <= 3; n++) c.luego(700 * n, () => c.responder("actualizacionProgreso", { paso: String(n), texto: textos[n], total: 3, pct: 0 }));
        return;
      }
      case "elegirArchivos": return c.responder("archivosElegidos", [{ ruta: "/demo/presentacion.pdf", nombre: "presentacion.pdf" }]);
      case "crearGuion": return c.luego(800, () => c.responder("guionCreado", { ok: true, titulo: "Presupuesto en 3 minutos",
        guion: "¿Se te va la plata y no sabes en qué? En tres minutos lo arreglamos.\n\n[muestra la diapositiva 1]\n\nHola, soy Ana. Hoy armamos un presupuesto simple." }));
      case "grabarConGuion": return toast("En la app, aquí se abre la barra para grabar");
      case "corregir": return c.luego(700, () => c.responder("corregido", { ok: true, carpeta: d.ruta, reemplazos: 1 }));
      case "recortar": return c.luego(700, () => {
        const g = grabacion();
        if (g) { g.recortada = true; g._dur = g._dur || g.meta.duracion_seg; g.meta = { ...g.meta, duracion_seg: Math.round(d.fin - d.inicio) }; }
        c.responder("recortado", { ok: true }); enviar();
      });
      case "deshacerRecorte": return c.luego(500, () => {
        const g = grabacion();
        if (g) { g.recortada = false; g.meta = { ...g.meta, duracion_seg: g._dur || g.meta.duracion_seg }; }
        c.responder("recortado", { ok: true, deshacer: true }); enviar();
      });
      case "teleprompter": DEMO.config.teleprompter = true; DEMO.config.teleprompter_texto = d.texto; return;
    }
  }

  const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#17151c"/><rect x="12" y="15" width="40" height="28" rx="5" fill="none" stroke="#b9b0ff" stroke-width="4"/><circle cx="21" cy="44" r="10" fill="#6d5dfc" stroke="#17151c" stroke-width="3"/><circle cx="44" cy="22" r="3.2" fill="#ff5d5d"/></svg>`;

  /** Guarda lo escrito en el formulario del guion antes de repintar (si no, se perdería). */
  function leerCamposGuion() {
    if (!E.guion || E.guion.paso !== "pedir") return;
    E.guion.idea = $("#guion-idea")?.value ?? E.guion.idea;
    E.guion.minutos = Number($("#guion-min")?.value || E.guion.minutos);
    E.guion.para = $("#guion-para")?.value || E.guion.para;
  }

  async function iniciar() {
    if (HOST === "web") {
      try { DEMO = await (await fetch("demo.json")).json(); } catch { DEMO = { grabaciones: [], config: {}, ias: [], modelos: { lista: [] }, permisos: {} }; }
      if (new URLSearchParams(location.search).has("bienvenida")) { DEMO.config.ia = ""; DEMO.config.idioma_ui = ""; } else { E.bvCerrada = true; }
    }
    host.enviar("listo");
  }
  iniciar();
})();
