// Graba para Windows y Linux, sobre la pieza «host-escritorio» (host.js): la ventana con sandbox, el puente con sus guardas (solo el
// marco principal de graba://ui/), config e idioma desde app.json, el menú, la apariencia de config.tema, los scripts de bin/ con
// límite de tiempo, safeStorage, graba://video/… con rangos, las actualizaciones (pieza «actualizaciones») y la acción declarada
// probarIA (pieza «ia», en acciones.json). Aquí queda lo propio de Graba (lo que en Mac hacen GrabaApp.swift, Acciones.swift,
// Barra.swift y Flotantes.swift): grabar, la barra y los flotantes, la bandeja, los atajos globales, recortar, modelos y YouTube.
const fs = require("fs");
const os = require("os");
const path = require("path");
const electron = require("electron");
const { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, screen, session, shell } = electron;
const { crearHost } = require("./host");
const { crear: crearActualizaciones } = require("./actualizaciones");
const S = require("./servicios");
const { ES_WIN, BASE, dentroDeBase, Config, Idioma, Permisos, IA, Modelos, Procesamiento, YouTube } = S;
const { Grabaciones, videoDe, prepararVideo, recortarVideo, deshacerRecorteVideo } = require("./grabaciones");
const { EscritorWav } = require("./wav");
const { firmaAvance } = require("./avance");

// La grabadora es una ventana oculta: sin esto Chromium deja el AudioContext suspendido hasta un clic.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const ICONOS = path.join(__dirname, "..", "iconos");
const icono = (n) => nativeImage.createFromPath(path.join(ICONOS, n));
const t = (s) => Idioma.t(s);
const reloj = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
  : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);

/** Ventana de vidrio (translúcida, como la barra de grabación) donde el sistema lo permite: Windows 11 (22H2+). En Linux y Windows 10, fondo sólido. */
const VIDRIO = process.platform === "win32" && Number(os.release().split(".")[2] || 0) >= 22621;
/** Al abrir con --oculta (al iniciar sesión) y con todo listo, Graba queda solo en la bandeja. */
const OCULTA = process.argv.includes("--oculta");

// ───────────────────────── El host (pieza «host-escritorio») ─────────────────────────
// Pieza «actualizaciones»: solo los Releases de graba-app/graba (Graba-Windows.exe, Graba-Linux.AppImage o .tar.gz, con su .sha256).
const act = crearActualizaciones({ app, net, repo: "graba-app/graba", nombre: "Graba" });
const actualizaciones = {
  get disponible() { return act.disponible; },
  async revisar() { const r = await act.revisar(); actualizarBandeja(); return r; },
  revisarCadaRato(avisar) { return act.revisarCadaRato((r) => { actualizarBandeja(); avisar(r); }); },
  instalar: (avance) => act.instalar(avance),
};
const PERMISOS = ["media", "display-capture", "clipboard-sanitized-write"];

const host = crearHost({
  electron,
  global: "Graba",
  appUserModelId: "app.graba.escritorio",
  // Cerrar la ventana no cierra la app: sigue en la bandeja (como en Mac, en la barra de menú).
  ventana: { ancho: 1120, alto: 740, minAncho: 760, minAlto: 520, icono: path.join(ICONOS, "graba-256.png"), fondo: { claro: "#f6f5fa", oscuro: "#17151c" }, alCerrar: "esconder" },
  sitio: "https://graba-app.github.io/graba/", codigo: "https://github.com/graba-app/graba",
  estadoScript: null,
  actualizaciones,
  // Cámara, micrófono y pantalla para las páginas propias (Windows además respeta sus interruptores de privacidad).
  permisos: (permiso) => PERMISOS.includes(permiso),
  estado: (base) => estadoDeGraba(base),
  alCambiarConfig: () => { actualizarBandeja(); actualizarBarra(); enviarEstado(); },
  alCrearVentana: (v) => alCrearVentana(v),
  antesDeSalir: () => antesDeSalir(),
});
S.usar(host);
const llamar = (funcion, datos) => host.llamar(funcion, datos);

// ───────────────────────── Ventana principal ─────────────────────────
let pendiente = {}, refresco = null, bandeja = null, ultimaFirma = "", primeraVentana = true;
let grabadora = null, burbuja = null, teleprompter = null;

function mostrar({ seleccionar, aviso } = {}) {
  if (seleccionar) pendiente.seleccionar = seleccionar;
  if (aviso) pendiente.aviso = aviso;
  host.mostrar();
  if (host.lista) enviarEstado();
  iniciarRefresco();
}
const ocultar = () => { const v = host.ventana(); if (v && !v.isDestroyed()) v.hide(); };

/** Lo propio de la ventana de Graba: sin barra de menú a la vista (Alt la muestra), vidrio en Windows 11 y, al abrir con
 *  --oculta y todo listo, nada a la vista (solo la bandeja). */
function alCrearVentana(v) {
  v.setMenuBarVisibility(false);
  v.setAutoHideMenuBar(true);
  if (VIDRIO) { try { v.setBackgroundMaterial("acrylic"); v.setBackgroundColor("#00000000"); } catch {} }
  if (primeraVentana && OCULTA && !faltaAlgo()) {
    v.removeAllListeners("ready-to-show");  // el host la muestra apenas carga: esta vez no
  } else {
    iniciarRefresco();
  }
  primeraVentana = false;
}

/** Mientras se procesa una grabación, la interfaz se actualiza sola cada segundo (avance por pasos), pero solo si el avance cambió
 *  (firmaAvance lee estado.json y youtube.json de las carpetas activas; releer y mandar todas las grabaciones cada segundo sobra). */
function iniciarRefresco() {
  if (refresco) return;
  refresco = setInterval(() => {
    // Sin nada en curso se olvida la firma: lo próximo que empiece se manda en el primer segundo aunque su avance se parezca al de antes.
    if (!(Procesamiento.enCurso || preparando.size || YouTube.subiendo.size)) { ultimaFirma = ""; return; }
    const v = host.ventana();
    if (!v || v.isDestroyed() || !v.isVisible()) return;
    const firma = firmaAvance([Procesamiento.enCurso, ...preparando, ...YouTube.subiendo]);
    if (firma === ultimaFirma) return;
    ultimaFirma = firma;
    enviarEstado();
  }, 1000);
}

// ───────────────────────── Hacia la interfaz ─────────────────────────
const enviarEstado = () => { host.enviarEstado().catch((e) => console.error("Graba: estado", e)); };

/** Lo de Graba sobre el estado del host (versión, idioma, plataforma, config, actualización). */
function estadoDeGraba(base) {
  const e = {
    ...base,
    fase: Estado.fase, grabandoDesde: Estado.fase === "grabando" && !Estado.pausada ? Date.now() - Estado.segundos * 1000 : 0,
    pausada: Estado.pausada, segundos: Estado.segundos, atajos: ATAJOS_TEXTO, grabaciones: Grabaciones.listar(), config: Config.leer(), ias: IA.paraJS(), modelos: Modelos.paraJS(),
    permisos: Permisos.paraJS(), carpeta: BASE, procesando: Procesamiento.enCurso || null, youtube: YouTube.paraJS(), vidrio: VIDRIO, ...pendiente,
  };
  pendiente = {};
  return e;
}

// ───────────────────────── Grabación (equivale a Estado en GrabaApp.swift) ─────────────────────────
// Como en Mac: "Grabar" abre la barra (qué grabar, cámara, micrófono, guion) y nada empieza hasta tocar su botón rojo.
const preparando = new Set();
const Estado = {
  fase: "inactiva", // inactiva | preparando | cuenta | grabando | terminando
  segundos: 0,
  pausada: false,  // en pausa: no se graba nada y el reloj se detiene (la fase sigue siendo "grabando")
  carpeta: null,
  cancelada: false,
  reloj: null,
  video: null,     // descriptor del archivo captura.*
  microfono: null, // EscritorWav de microfono.wav
  inicio: 0,
  esperando: {},   // resolvedores de las respuestas de la grabadora: lista, detenida
  pantalla: null,  // pantalla bajo el mouse al abrir la barra
  modo: "pantalla", // pantalla | ventana | area | camara (se eligen cada vez; «camara» graba solo la cámara, a pantalla completa)
  ventana: null,   // { id, nombre } de desktopCapturer
  area: null,      // { x, y, ancho, alto } en puntos, relativo a la pantalla
};

/** Mientras graba (o prepara, o guarda) la app está ocupada para el host: actualizar espera y, si no termina, no se instala. */
function cambiarFase(f) {
  if (Estado.fase === "inactiva" && f !== "inactiva") host.ocupar();
  if (Estado.fase !== "inactiva" && f === "inactiva") host.soltar();
  Estado.fase = f;
  actualizarBandeja();
  actualizarBarra();
  enviarEstado();
}

/** Espera un mensaje de la grabadora oculta ("lista" o "detenida"), o se rinde a los `ms`. */
function esperarGrabadora(tipo, ms) {
  return new Promise((fin) => {
    const reloj_ = setTimeout(() => { delete Estado.esperando[tipo]; fin(null); }, ms);
    Estado.esperando[tipo] = (d) => { clearTimeout(reloj_); delete Estado.esperando[tipo]; fin(d); };
  });
}

/** Primer uso (como GrabaApp.faltaIdioma en Mac): mientras la persona no elija el idioma (paso 0 de la bienvenida) no se muestra ni
 * se pide nada más. Si ya tenía todo listo y nunca eligió idioma, no se le vuelve a preguntar. */
const faltaAlgo = () => !Config.texto("ia") || !Modelos.hayAlguno();
const faltaIdioma = () => !Idioma.elegido && faltaAlgo();

/** Abre la barra para preparar la grabación (equivale a Estado.grabar en Mac). */
function grabar() {
  // Con la barra ya abierta, "Grabar" en la ventana solo lleva de vuelta a ella: grabar empieza con su botón rojo.
  if (Estado.fase === "preparando") { ocultar(); if (barra && !barra.isDestroyed()) barra.showInactive(); return; }
  if (Estado.fase !== "inactiva") return;
  // El idioma va primero (también si llega el atajo): se abre la ventana para elegirlo.
  if (faltaIdioma()) return mostrar();
  if (!grabadora || grabadora.isDestroyed()) crearGrabadora();
  Estado.pantalla = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  Estado.modo = "pantalla"; Estado.ventana = null; Estado.area = null;
  ocultar();
  cambiarFase("preparando");
  mostrarBarra();
  aplicarFlotantes();
}

const listoParaGrabar = () => Estado.modo === "pantalla" || (Estado.modo === "camara" && Permisos.paraJS().camara) || (Estado.modo === "ventana" && !!Estado.ventana) || (Estado.modo === "area" && !!Estado.area);

/** Botón rojo de la barra: cuenta 3-2-1 y a grabar. */
async function iniciar() {
  if (Estado.fase !== "preparando" || !listoParaGrabar()) return;
  const microfono = Config.bool("microfono") && Permisos.paraJS().microfono;
  Estado.sonidoSistema = ES_WIN && Estado.modo !== "camara" && Config.bool("sonido_sistema");
  Estado.segundos = 0;
  Estado.cancelada = false;
  cambiarFase("cuenta");
  mostrarCuenta();
  for (let n = 3; n >= 1; n--) {
    Estado.cuenta = n;
    actualizarBarra();
    if (cuenta && !cuenta.isDestroyed()) cuenta.webContents.send("cuenta", n);
    await new Promise((r) => setTimeout(r, 1000));
    if (Estado.cancelada) return;
  }
  cerrar(cuenta); cuenta = null;
  const c = Grabaciones.nueva();
  Estado.carpeta = c;
  const espera = esperarGrabadora("lista", 20000);
  // Hasta 1920 px de ancho (como un video de YouTube en 1080p), sin agrandar pantallas chicas y en números pares (igual que en Mac).
  const p = Estado.pantalla, ancho = Math.round(p.size.width * p.scaleFactor), alto = Math.round(p.size.height * p.scaleFactor);
  const factor = Math.min(1, 1920 / ancho), par = (n) => Math.max(2, Math.floor(n / 2) * 2);
  grabadora.webContents.send("empezar", { microfono, microfonoId: Config.texto("microfono_id"), ancho: par(ancho * factor), alto: par(alto * factor),
    soloCamara: Estado.modo === "camara", camaraId: Config.texto("camara_id"), sonidoSistema: Estado.sonidoSistema });
  const r = await espera;
  if (Estado.cancelada) return;
  if (!r || !r.ok) return fallo(!r ? t("La grabadora no respondió.") : r.error === "permiso" ? t("No hay permiso para grabar la pantalla.") : r.error);
  try {
    Estado.video = fs.openSync(path.join(c, `captura.${r.ext === "mp4" ? "mp4" : "webm"}`), "w");
    Estado.microfono = r.microfono ? new EscritorWav(path.join(c, "microfono.wav")) : null;
    // Con el sonido del computador mezclado en el video, la transcripción usa solo microfono.wav (la voz).
    if (r.sonidoSistema) Grabaciones.actualizarMeta(c, { sonido_sistema: true });
    // Un área: se graba la pantalla entera y al terminar ffmpeg recorta (en píxeles del video).
    if (Estado.modo === "area" && Estado.area && r.ancho) {
      const k = r.ancho / p.size.width, a = Estado.area;
      fs.writeFileSync(path.join(c, ".recorte.json"), JSON.stringify({ x: par(a.x * k), y: par(a.y * k),
        ancho: par(Math.min(a.ancho * k, r.ancho - a.x * k)), alto: par(Math.min(a.alto * k, (r.alto || 1e9) - a.y * k)) }));
    }
  } catch (e) { return fallo(e.message); }
  if (process.env.GRABA_PRUEBAS === "1") console.log("grabadora:", JSON.stringify(r));
  Estado.inicio = Date.now();
  Estado.segundos = 0;
  Estado.pausada = false;
  cambiarFase("grabando");
  enTeleprompter({ corriendo: true }); // el texto empieza a avanzar junto con la grabación
  Estado.reloj = setInterval(() => {
    if (Estado.pausada) return;
    Estado.segundos += 1;
    actualizarBarra();
    if (bandeja) bandeja.setToolTip(`Graba · ${reloj(Estado.segundos)}`);
  }, 1000);
}

/** Pausa o reanuda (botón de la barra, bandeja, ventana o Ctrl+Alt+Shift+P). El video sigue de corrido. */
function alternarPausa() {
  if (Estado.fase !== "grabando") return;
  Estado.pausada = !Estado.pausada;
  if (grabadora && !grabadora.isDestroyed()) grabadora.webContents.send("pausar", Estado.pausada);
  enTeleprompter({ corriendo: !Estado.pausada });
  actualizarBarra();
  actualizarBandeja();
  enviarEstado();
}

/** Ctrl+Alt+Shift+R: sin grabar, abre la barra y empieza al tiro; preparando, empieza; grabando, termina (como ⌃⌥⌘R en Mac). */
function atajoGrabar() {
  if (Estado.fase === "inactiva") { grabar(); if (Estado.fase === "preparando") iniciar(); }
  else if (Estado.fase === "preparando") iniciar();
  else if (Estado.fase === "grabando") detener();
}
const ATAJOS = { grabar: "CommandOrControl+Alt+Shift+R", pausar: "CommandOrControl+Alt+Shift+P" };
const ATAJOS_TEXTO = { grabar: "Ctrl+Alt+Shift+R", pausar: "Ctrl+Alt+Shift+P" };

/** Detiene la grabadora y cierra los archivos. Devuelve la duración en segundos. */
async function pararGrabadora() {
  clearInterval(Estado.reloj);
  Estado.reloj = null;
  Estado.pausada = false;
  let r = null;
  if (grabadora && !grabadora.isDestroyed()) {
    const espera = esperarGrabadora("detenida", 15000);
    grabadora.webContents.send("detener");
    r = await espera;
  }
  if (Estado.video != null) { try { fs.closeSync(Estado.video); } catch {} Estado.video = null; }
  if (Estado.microfono) { Estado.microfono.cerrar(); Estado.microfono = null; }
  return r && r.ms ? r.ms / 1000 : (Date.now() - Estado.inicio) / 1000;
}

async function detener() {
  if (Estado.fase === "cuenta" || Estado.fase === "preparando") return cancelar();
  if (Estado.fase !== "grabando" || !Estado.carpeta) return;
  const c = Estado.carpeta;
  Estado.fase = "terminando";
  actualizarBandeja();
  ocultarFlotantes();
  const duracion = await pararGrabadora();
  Estado.carpeta = null;
  const captura = Grabaciones.captura(c);
  if (duracion < 1 || !captura || fs.statSync(captura).size === 0) {
    fs.rmSync(c, { recursive: true, force: true });
    cambiarFase("inactiva");
    return mostrar({ aviso: t("La grabación quedó vacía.") });
  }
  Grabaciones.actualizarMeta(c, { duracion_seg: Math.round(duracion) });
  Grabaciones.escribirEstado(c, { estado: "procesando", paso: 0, total: 3, texto: "Preparando el video…" });
  cambiarFase("inactiva");
  mostrar({ seleccionar: c });
  await terminarVideo(c);
}

/** Convierte el video y encola el procesamiento (transcribir → IA). */
async function terminarVideo(c) {
  preparando.add(c);
  host.ocupar();
  try { await prepararVideo(c); } catch (e) { console.error("Graba: preparar video", e); }
  preparando.delete(c);
  host.soltar();
  if (!Grabaciones.video(c)) {
    Grabaciones.escribirEstado(c, { estado: "error", error: t("No pude guardar el video.") });
    return enviarEstado();
  }
  Procesamiento.encolar(c);
  enviarEstado();
}

async function cancelar() {
  Estado.cancelada = true;
  const c = Estado.carpeta, estaba = Estado.fase;
  if (estaba === "inactiva" || estaba === "terminando") return;
  Estado.fase = "terminando";
  actualizarBandeja();
  ocultarFlotantes();
  if (estaba === "grabando" || c) await pararGrabadora();
  else clearInterval(Estado.reloj);
  if (c) fs.rmSync(c, { recursive: true, force: true });
  Estado.carpeta = null;
  cambiarFase("inactiva");
}

async function fallo(mensaje) {
  const c = Estado.carpeta;
  Estado.cancelada = true;
  ocultarFlotantes();
  await pararGrabadora();
  if (c) fs.rmSync(c, { recursive: true, force: true });
  Estado.carpeta = null;
  cambiarFase("inactiva");
  mostrar({ aviso: `${t("No pude grabar:")} ${mensaje}` });
}

/** El mensaje viene del marco principal de una página propia (graba://app/… o graba://ui/…), nunca de un iframe ni de otra página. */
function esDeLaApp(e, origen) {
  return !!e.senderFrame && e.senderFrame === e.sender.mainFrame && String(e.senderFrame.url || "").startsWith(origen);
}
/** El mensaje viene de la ventana `w` (y de su página propia). */
const desde = (w, e, origen = "graba://app/") => !!w && !w.isDestroyed() && e.sender === w.webContents && esDeLaApp(e, origen);

ipcMain.on("grabadora-lista", (e, d) => { if (desde(grabadora, e)) Estado.esperando.lista?.(d); });
ipcMain.on("grabadora-detenida", (e, d) => { if (desde(grabadora, e)) Estado.esperando.detenida?.(d || {}); });
ipcMain.on("grabadora-video", (e, buf) => {
  if (desde(grabadora, e) && buf instanceof Uint8Array && Estado.video != null) try { fs.writeSync(Estado.video, buf); } catch {}
});
ipcMain.on("grabadora-pcm", (e, buf) => {
  if (!desde(grabadora, e) || !(buf instanceof Uint8Array) || !Estado.microfono) return;
  const n = Math.floor(buf.length / 2) * 2;
  Estado.microfono.escribir(buf.subarray(0, n));
});
ipcMain.on("grabadora-cortada", (e) => { if (desde(grabadora, e)) detener(); });
ipcMain.on("dispositivos", (e, lista) => { if (desde(grabadora, e)) Estado.esperando.dispositivos?.(lista); });
ipcMain.on("burbuja-sin-camara", (e) => { if (desde(burbuja, e)) { cerrar(burbuja); burbuja = null; } });

function crearGrabadora() {
  grabadora = new BrowserWindow({ show: false, width: 320, height: 240, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, "preload-interno.js"), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  grabadora.loadURL("graba://app/grabadora.html");
  grabadora.on("closed", () => { grabadora = null; });
}

/** Cámaras y micrófonos (los lista la grabadora oculta, que ya tiene permiso). */
async function dispositivos() {
  if (!grabadora || grabadora.isDestroyed()) return [];
  const espera = esperarGrabadora("dispositivos", 1500);
  grabadora.webContents.send("dispositivos");
  return (await espera) || [];
}

// ───────────────────────── Flotantes (equivale a Flotantes.swift y Barra.swift) ─────────────────────────
const flotante = (extra) => new BrowserWindow({
  frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
  alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: "#00000000",
  webPreferences: { preload: path.join(__dirname, "preload-interno.js"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  ...extra,
});
const cerrar = (w) => { if (w && !w.isDestroyed()) w.close(); };
/** Lo que solo ve la persona (barra, cuenta, teleprompter, área) queda fuera del video: en Windows 10 (2004+) funciona; en Linux no hay cómo. */
const noGrabar = (w) => { w.setAlwaysOnTop(true, "screen-saver"); w.setContentProtection(true); };

let barra = null, cuenta = null, area = null, tamanoBarra = { ancho: 520, alto: 46 };
function mostrarBarra() {
  cerrar(barra);
  barra = flotante({ width: tamanoBarra.ancho, height: tamanoBarra.alto });
  noGrabar(barra);
  ubicarBarra();
  barra.loadURL("graba://app/barra.html");
  barra.webContents.once("did-finish-load", () => { actualizarBarra(); barra?.showInactive(); });
  barra.on("closed", () => { barra = null; });
}
function ubicarBarra() {
  if (!barra || barra.isDestroyed() || !Estado.pantalla) return;
  const a = Estado.pantalla.workArea, { ancho, alto } = tamanoBarra;
  barra.setBounds({ x: Math.round(a.x + a.width / 2 - ancho / 2), y: Math.round(a.y + a.height - alto - 22), width: ancho, height: alto });
}
ipcMain.on("barra-tamano", (e, d) => {
  if (!desde(barra, e)) return;
  const ancho = Math.min(1200, Math.max(60, Number(d && d.ancho) || 0)), alto = Math.min(120, Math.max(30, Number(d && d.alto) || 0));
  if (ancho === tamanoBarra.ancho && alto === tamanoBarra.alto) return;
  tamanoBarra = { ancho, alto };
  ubicarBarra();
});

function actualizarBarra() {
  if (!barra || barra.isDestroyed()) return;
  const c = Config.leer(), grabando = Estado.fase === "grabando", listo = listoParaGrabar();
  const detalle = Estado.modo === "ventana" ? (Estado.ventana ? Estado.ventana.nombre : t("Elige una ventana"))
    : Estado.modo === "area" && Estado.area ? `${Math.round(Estado.area.ancho)} × ${Math.round(Estado.area.alto)}`
    : Estado.modo === "camara" ? t("Solo la cámara") : "";
  barra.webContents.send("barra", {
    fase: Estado.fase, segundos: Estado.segundos, pausada: Estado.pausada, modo: Estado.modo, detalle, listo,
    camara: !!c.camara, microfono: !!c.microfono, teleprompter: !!c.teleprompter,
    textos: {
      grabar: t("Grabar"), terminar: t("Terminar"), cuenta: Idioma.f("Empieza en {n}…", Estado.cuenta || 3), en_pausa: t("En pausa"),
      ayuda_pausar: t(Estado.pausada ? "Reanudar (Ctrl+Alt+Shift+P)" : "Pausar (Ctrl+Alt+Shift+P)"),
      ayuda_grabaciones: t("Mis grabaciones"), ayuda_pantalla: t("Toda la pantalla"), ayuda_ventana: t("Una ventana"), ayuda_area: t("Un área"),
      ayuda_solocamara: t("Solo la cámara"),
      ayuda_camara: t("Cámara: cuál, forma y tamaño"), ayuda_microfono: t("Micrófono"),
      ayuda_guion: t(c.teleprompter ? "Ocultar el guion" : "Guion (teleprompter): solo tú lo ves"),
      ayuda_grabar: t(listo ? "Empezar a grabar" : "Elige una ventana primero"), ayuda_terminar: t("Terminar y guardar"),
      ayuda_cerrar: t(grabando ? "Descartar la grabación" : "Cerrar"),
    },
  });
}

/** Menú nativo junto al botón de la barra. */
function menuEn(items, d) {
  if (!barra || barra.isDestroyed()) return;
  Menu.buildFromTemplate(items).popup({ window: barra, x: Math.round(Number(d && d.x) || 0), y: Math.round(Number(d && d.y) || 0) });
}
function elegirModo(modo) {
  Estado.modo = modo;
  if (modo !== "area") Estado.area = null;
  if (modo !== "ventana") Estado.ventana = null;
  actualizarBarra();
  aplicarFlotantes();
}

const ACCIONES_BARRA = {
  pantalla() { elegirModo("pantalla"); },
  async ventana(d) {
    // Las ventanas propias de Graba no se ofrecen.
    const propias = new Set(BrowserWindow.getAllWindows().map((w) => { try { return w.getMediaSourceId(); } catch { return ""; } }));
    let fuentes = [];
    try { fuentes = (await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } })).filter((f) => !propias.has(f.id) && f.name); } catch {}
    menuEn(fuentes.length ? fuentes.slice(0, 40).map((f) => ({ label: f.name.length > 60 ? f.name.slice(0, 59) + "…" : f.name, type: "radio",
      checked: Estado.ventana?.id === f.id, click: () => { Estado.ventana = { id: f.id, nombre: f.name.slice(0, 40) }; elegirModo("ventana"); } }))
      : [{ label: t("No encontré ventanas abiertas."), enabled: false }], d);
  },
  area() { elegirArea(); },
  solocamara() { Config.guardar({ camara: true }); elegirModo("camara"); },
  async camara(d) {
    const c = Config.leer(), forma = c.camara_forma || "circulo", tam = c.camara_tamano || "m";
    const guardar = (cambios) => { Config.guardar(cambios); actualizarBarra(); aplicarFlotantes(); actualizarBandeja(); enviarEstado(); };
    const camaras = (await dispositivos()).filter((x) => x.tipo === "videoinput");
    const items = [{ label: t(c.camara ? "Ocultar la cámara" : "Mostrar la cámara"), click: () => guardar({ camara: !c.camara }) }, { type: "separator" }];
    if (camaras.length > 1) {
      items.push({ label: t("Cámara"), submenu: camaras.map((x, i) => ({ label: x.nombre || `${t("Cámara")} ${i + 1}`, type: "radio",
        checked: (c.camara_id || camaras[0].id) === x.id, click: () => guardar({ camara_id: x.id, camara: true }) })) });
    }
    items.push({ label: t("Forma"), submenu: [["circulo", "Círculo"], ["cuadrado", "Cuadrado"], ["horizontal", "Horizontal"], ["vertical", "Vertical"]]
      .map(([id, n]) => ({ label: t(n), type: "radio", checked: forma === id, click: () => guardar({ camara_forma: id, camara: true }) })) });
    items.push({ label: t("Tamaño"), submenu: [["s", "Chica"], ["m", "Mediana"], ["l", "Grande"], ["xl", "Muy grande"]]
      .map(([id, n]) => ({ label: t(n), type: "radio", checked: tam === id, click: () => guardar({ camara_tamano: id, camara: true }) })) });
    menuEn(items, d);
  },
  async microfono(d) {
    const c = Config.leer();
    const guardar = (cambios) => { Config.guardar(cambios); actualizarBarra(); actualizarBandeja(); enviarEstado(); };
    const mics = (await dispositivos()).filter((x) => x.tipo === "audioinput");
    const items = [{ label: t(c.microfono ? "Apagar el micrófono" : "Encender el micrófono"), click: () => guardar({ microfono: !c.microfono }) }];
    if (ES_WIN) items.push({ label: t("Incluir el sonido del computador"), type: "checkbox", checked: !!c.sonido_sistema, click: () => guardar({ sonido_sistema: !c.sonido_sistema }) });
    if (mics.length > 1) {
      items.push({ type: "separator" }, { label: t("Micrófono"), submenu: mics.map((x, i) => ({ label: x.nombre || `${t("Micrófono")} ${i + 1}`, type: "radio",
        checked: (c.microfono_id || mics[0].id) === x.id, click: () => guardar({ microfono_id: x.id, microfono: true }) })) });
    }
    menuEn(items, d);
  },
  guion() {
    Config.guardar({ teleprompter: !Config.bool("teleprompter") });
    actualizarBarra();
    aplicarFlotantes();
  },
  grabar() { iniciar(); },
  async grabaciones() { await cancelar(); mostrar(); },
  terminar() { detener(); },
  pausar() { alternarPausa(); },
  cerrar() { cancelar(); },
};
ipcMain.on("barra", (e, accion, d) => {
  if (!desde(barra, e) || typeof accion !== "string" || !Object.hasOwn(ACCIONES_BARRA, accion)) return;
  if (Estado.fase !== "preparando" && !["terminar", "cerrar", "pausar"].includes(accion)) return;
  ACCIONES_BARRA[accion](d);
});

function mostrarCuenta() {
  const b = Estado.pantalla.bounds, lado = 150;
  cuenta = flotante({ width: lado, height: lado, x: Math.round(b.x + b.width / 2 - lado / 2), y: Math.round(b.y + b.height / 2 - lado / 2), focusable: false });
  noGrabar(cuenta);
  cuenta.setIgnoreMouseEvents(true);
  cuenta.loadURL("graba://app/cuenta.html");
  cuenta.webContents.once("did-finish-load", () => { cuenta?.webContents.send("cuenta", Estado.cuenta || 3); cuenta?.showInactive(); });
  cuenta.on("closed", () => { cuenta = null; });
}

/** Un área: capa transparente sobre la pantalla para arrastrar un rectángulo (Esc cancela). */
function elegirArea() {
  cerrar(area);
  const b = Estado.pantalla.bounds;
  area = flotante({ ...b, width: b.width, height: b.height, focusable: true });
  area.setAlwaysOnTop(true, "screen-saver");
  area.setContentProtection(true);
  area.loadURL("graba://app/area.html");
  area.webContents.once("did-finish-load", () => {
    area?.webContents.send("area", { ayuda: t("Arrastra para elegir el área que quieres grabar. Esc para cancelar.") });
    area?.show(); area?.focus();
  });
  area.on("closed", () => { area = null; });
}
ipcMain.on("area-elegida", (e, r) => {
  if (!desde(area, e)) return;
  cerrar(area); area = null;
  const n = (v) => Math.max(0, Number(v) || 0);
  if (r && n(r.ancho) >= 40 && n(r.alto) >= 40) { Estado.area = { x: n(r.x), y: n(r.y), ancho: n(r.ancho), alto: n(r.alto) }; elegirModo("area"); }
});

/** Cámara y teleprompter en vivo según lo elegido en la barra. */
function aplicarFlotantes() {
  const c = Config.leer();
  // Con «solo la cámara» se graba la cámara directo (no la pantalla): la burbuja no hace falta.
  if (c.camara && Permisos.paraJS().camara && Estado.modo !== "camara") mostrarBurbuja(); else { cerrar(burbuja); burbuja = null; }
  if (c.teleprompter) { if (!teleprompter || teleprompter.isDestroyed()) mostrarTeleprompter(Estado.pantalla); } else { cerrar(teleprompter); teleprompter = null; }
}

const LADO_BURBUJA = { s: 140, m: 200, l: 290, xl: 400 };
const PROPORCION = { circulo: 1, cuadrado: 1, horizontal: 16 / 9, vertical: 9 / 16 };
function mostrarBurbuja() {
  const c = Config.leer(), forma = PROPORCION[c.camara_forma] ? c.camara_forma : "circulo", lado = LADO_BURBUJA[c.camara_tamano] || 200;
  const prop = PROPORCION[forma], ancho = Math.round(prop >= 1 ? lado * prop : lado), alto = Math.round(prop >= 1 ? lado : lado / prop);
  // Abajo a la izquierda de la pantalla (o del área elegida, para que la cámara salga en el video).
  const a = Estado.modo === "area" && Estado.area
    ? { x: Estado.pantalla.bounds.x + Estado.area.x, y: Estado.pantalla.bounds.y + Estado.area.y, width: Estado.area.ancho, height: Estado.area.alto }
    : Estado.pantalla.workArea;
  const margen = Estado.modo === "area" ? 16 : 28;
  const caja = { x: Math.round(a.x + margen), y: Math.round(a.y + a.height - alto - margen), width: ancho, height: alto };
  const datos = { forma, dispositivo: c.camara_id || "" };
  if (burbuja && !burbuja.isDestroyed()) { burbuja.setBounds(caja); burbuja.webContents.send("burbuja", datos); return; }
  burbuja = flotante(caja);
  burbuja.setAlwaysOnTop(true, "floating");
  burbuja.loadURL("graba://app/burbuja.html");
  burbuja.webContents.once("did-finish-load", () => { burbuja?.webContents.send("burbuja", datos); burbuja?.showInactive(); });
  burbuja.on("closed", () => { burbuja = null; });
}

// Teleprompter: solo lo ve la persona (en Windows no sale en el video). Se puede escribir ahí mismo o llegar con
// "Usar en el teleprompter" / "Grabar con este guion" desde la ventana.
function mostrarTeleprompter(pantalla) {
  const a = pantalla.workArea, ancho = 560, alto = 230;
  teleprompter = flotante({ width: ancho, height: alto, x: Math.round(a.x + a.width / 2 - ancho / 2), y: a.y + 24, resizable: true, minWidth: 320, minHeight: 140, focusable: true });
  noGrabar(teleprompter);
  teleprompter.loadURL("graba://app/teleprompter.html");
  teleprompter.webContents.once("did-finish-load", () => {
    const c = Config.leer();
    enTeleprompter({ texto: Config.texto("teleprompter_texto"), velocidad: Number(c.teleprompter_velocidad) || 30, letra: Number(c.teleprompter_letra) || 26,
      corriendo: Estado.fase === "grabando",
      textos: { pausar: t("Pausar"), seguir: t("Seguir"), inicio: t("Volver al inicio"), menos: t("Letra más chica"), mas: t("Letra más grande"),
        velocidad: t("Velocidad"), editar: t("Editar el texto"), listo: t("Listo"),
        vacio: t("Escribe o pega aquí lo que vas a decir. Solo tú lo ves: no sale en el video.") } });
    teleprompter?.showInactive();
  });
  teleprompter.on("closed", () => { teleprompter = null; });
}
const enTeleprompter = (d) => { if (teleprompter && !teleprompter.isDestroyed()) teleprompter.webContents.send("teleprompter", d); };
ipcMain.on("teleprompter-ajustes", (e, d) => {
  if (!desde(teleprompter, e)) return;
  const v = Number(d && d.velocidad), l = Number(d && d.letra);
  if (v >= 5 && v <= 120 && l >= 14 && l <= 56) Config.guardar({ teleprompter_velocidad: v, teleprompter_letra: l });
});
ipcMain.on("teleprompter-texto", (e, texto) => {
  if (desde(teleprompter, e) && typeof texto === "string") Config.guardar({ teleprompter_texto: texto.slice(0, 200000) });
});

function ocultarFlotantes() {
  for (const w of [barra, cuenta, area, burbuja, teleprompter]) cerrar(w);
  barra = cuenta = area = burbuja = teleprompter = null;
}

// ───────────────────────── Bandeja (equivale a BarraMenu) ─────────────────────────
function crearBandeja() {
  bandeja = new Tray(icono(ES_WIN ? "bandeja-16.png" : "bandeja-32.png"));
  // En Windows el clic abre el menú (como en la barra de menú del Mac); en Linux muchos escritorios solo muestran el menú.
  bandeja.on("click", () => bandeja.popUpContextMenu());
  actualizarBandeja();
}

function actualizarBandeja() {
  if (!bandeja) return;
  const grabando = Estado.fase === "grabando";
  bandeja.setImage(icono(`${grabando ? "bandeja-grabando" : "bandeja"}-${ES_WIN ? 16 : 32}.png`));
  bandeja.setToolTip(grabando ? `Graba · ${reloj(Estado.segundos)}` : "Graba");
  // Primer uso: el idioma va primero. Estos textos son bilingües a propósito (aún no se sabe cuál prefiere la persona).
  if (faltaIdioma()) {
    return bandeja.setContextMenu(Menu.buildFromTemplate([{ label: "Elegir idioma · Choose language…", click: () => mostrar() },
      { type: "separator" }, { label: "Salir · Quit", click: () => host.salir() }]));
  }
  const items = [];
  if (Estado.fase === "preparando") {
    items.push({ label: t("Empezar a grabar"), click: () => iniciar() }, { label: t("Cerrar"), click: () => cancelar() });
  } else if (Estado.fase === "grabando" || Estado.fase === "cuenta") {
    if (Estado.fase === "grabando") items.push({ label: t(Estado.pausada ? "Reanudar la grabación" : "Pausar la grabación"), accelerator: ATAJOS.pausar, click: () => alternarPausa() });
    items.push({ label: t("Terminar grabación"), accelerator: ATAJOS.grabar, click: () => detener() }, { label: t("Descartar grabación"), click: () => cancelar() });
  } else if (Estado.fase === "terminando") {
    items.push({ label: t("Guardando…"), enabled: false });
  } else {
    items.push({ label: t("Grabar pantalla"), accelerator: ATAJOS.grabar, click: () => grabar() },
      { label: t("Cámara"), type: "checkbox", checked: Config.bool("camara"), click: () => alternar("camara") },
      { label: t("Micrófono"), type: "checkbox", checked: Config.bool("microfono"), click: () => alternar("microfono") });
  }
  if (act.disponible.hay) items.push({ type: "separator" }, { label: t("Hay una versión nueva: actualizar…"), click: () => mostrar() });
  items.push({ type: "separator" }, { label: t("Abrir Graba"), click: () => mostrar() },
    { label: t("Abrir la carpeta de grabaciones"), click: () => { fs.mkdirSync(BASE, { recursive: true }); shell.openPath(BASE); } },
    { type: "separator" }, { label: t("Salir de Graba"), click: () => host.salir() });
  bandeja.setContextMenu(Menu.buildFromTemplate(items));
}

function alternar(clave) {
  Config.guardar({ [clave]: !Config.bool(clave) });
  actualizarBandeja();
  enviarEstado();
}

// ───────────────────────── Desde la interfaz: las acciones propias de Graba (equivale a Acciones.swift) ─────────────────────────
// Lo que trae el host (listo, config, copiar, abrirEnlace, buscarActualizacion, actualizar) y lo declarado en acciones.json
// (probarIA, de la pieza «ia») no va aquí.
const rutaValida = (d) => dentroDeBase(d && d.ruta);
const archivosElegidos = new Set();

const ACCIONES = {
  grabar() {
    grabar();
  },
  terminar() {
    if (Estado.fase === "grabando") detener();
  },
  pausar() {
    alternarPausa();
  },
  async recortar(d) {
    // No mientras se procesa esa misma grabación.
    if (!rutaValida(d) || Procesamiento.enCurso === path.resolve(d.ruta)) return llamar("recortado", { ok: false, error: t("Espera a que termine de procesar y vuelve a intentarlo.") });
    const c = path.resolve(d.ruta), inicio = Number(d.inicio), fin = Number(d.fin);
    if (!(fin - inicio >= 1) || inicio < 0) return llamar("recortado", { ok: false, error: t("El recorte tiene que durar al menos un segundo.") });
    let r = await host.procesador.correrJSON("recortar.py", ["preparar", c]);
    if (r.ok) {
      try { await recortarVideo(c, inicio, fin); r = await host.procesador.correrJSON("recortar.py", ["textos", c, String(inicio), String(fin)]); }
      catch (e) { r = { ok: false, error: e.message }; }
    }
    llamar("recortado", r);
    enviarEstado();
  },
  async deshacerRecorte(d) {
    if (!rutaValida(d) || Procesamiento.enCurso === path.resolve(d.ruta)) return llamar("recortado", { ok: false, deshacer: true, error: t("Espera a que termine de procesar y vuelve a intentarlo.") });
    const c = path.resolve(d.ruta);
    let r;
    try { deshacerRecorteVideo(c); r = await host.procesador.correrJSON("recortar.py", ["deshacer", c]); }
    catch (e) { r = { ok: false, error: e.message }; }
    llamar("recortado", { ...r, deshacer: true });
    enviarEstado();
  },
  abrirCarpeta(d) {
    if (rutaValida(d)) host.mostrarEnCarpeta(path.resolve(d.ruta));
    else { fs.mkdirSync(BASE, { recursive: true }); shell.openPath(BASE); }
  },
  async borrar(d) {
    if (rutaValida(d)) await host.papelera(path.resolve(d.ruta));
    enviarEstado();
  },
  procesar(d) {
    if (!rutaValida(d)) return;
    const ruta = path.resolve(d.ruta);
    Grabaciones.escribirEstado(ruta, { estado: "procesando", paso: 0, total: 3, texto: "En espera…" });
    Procesamiento.encolar(ruta, d.soloIA === true);
    enviarEstado();
  },
  async descargarModelo(d) {
    const id = String(d.id || "");
    let error = "";
    try { await Modelos.descargar(id, (pct) => llamar("modeloProgreso", { id, pct })); } catch (e) { error = e.message || "?"; }
    if (!error) Config.guardar({ modelo: id });
    llamar("modeloListo", { id, ok: !error, error });
    enviarEstado();
  },
  permiso(d) {
    Permisos.pedir(String(d.tipo || ""));
    enviarEstado();
  },
  async corregir(d) {
    // "Dice Grava y es Graba": la IA corrige el texto y las palabras mal transcritas también en los subtítulos (bin/corregir.py).
    // La instrucción va en un archivo 0600 dentro de una carpeta propia (nunca como argumento) que se borra al terminar.
    const texto = String(d.texto || "").trim();
    if (!rutaValida(d) || !texto || texto.length > 20000) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graba-"));
    const instruccion = path.join(dir, "instruccion.txt");
    fs.writeFileSync(instruccion, texto, { encoding: "utf8", mode: 0o600 });
    const r = await Procesamiento.correrJSON("corregir.py", [path.resolve(d.ruta), instruccion]);
    fs.rmSync(dir, { recursive: true, force: true });
    llamar("corregido", r);
    if (r.carpeta) pendiente.seleccionar = r.carpeta;
    enviarEstado();
  },
  async elegirArchivos() {
    // Presentación, documentos o imágenes para que la IA escriba el guion (solo se leen, no se mueven).
    const r = await dialog.showOpenDialog(host.ventana() || undefined, { title: t("Elige tu presentación, documentos o imágenes"), properties: ["openFile", "multiSelections"],
      filters: [{ name: t("Presentaciones, documentos e imágenes"), extensions: ["pdf", "pptx", "key", "docx", "txt", "md", "rtf", "png", "jpg", "jpeg", "gif", "webp", "heic"] }] });
    if (r.canceled || !r.filePaths.length) return;
    r.filePaths.forEach((f) => archivosElegidos.add(path.resolve(f)));
    llamar("archivosElegidos", r.filePaths.map((f) => ({ ruta: f, nombre: path.basename(f) })));
  },
  async crearGuion(d) {
    // Solo se pasan a la IA archivos que la persona eligió en el diálogo (la interfaz no puede pedir otros).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graba-"));
    const entrada = path.join(dir, "guion.json");
    const archivos = (Array.isArray(d.archivos) ? d.archivos : []).map((f) => path.resolve(String(f))).filter((f) => archivosElegidos.has(f));
    fs.writeFileSync(entrada, JSON.stringify({ ...d, archivos }), { encoding: "utf8", mode: 0o600 });
    const r = await Procesamiento.correrJSON("guion.py", [entrada]);
    fs.rmSync(dir, { recursive: true, force: true });
    llamar("guionCreado", r);
  },
  grabarConGuion(d) {
    // El guion queda en el teleprompter y se abre la barra para grabar: llegar y grabar.
    Config.guardar({ teleprompter_texto: String(d.texto || "").slice(0, 200000), teleprompter: true });
    if (Estado.fase === "preparando") { cerrar(teleprompter); teleprompter = null; aplicarFlotantes(); actualizarBarra(); }
    else grabar();
  },
  teleprompter(d) {
    // El guion de una grabación queda listo en el teleprompter para la próxima (solo lo ve la persona), igual que en Mac.
    Config.guardar({ teleprompter_texto: String(d.texto || "").slice(0, 200000), teleprompter: true });
    enviarEstado();
  },
  async youtubeConectar() {
    const r = await YouTube.conectar();
    llamar("youtubeConectado", r);
    enviarEstado();
  },
  youtubeDesconectar() {
    YouTube.desconectar();
    enviarEstado();
  },
  youtubeSubir(d) {
    if (!rutaValida(d)) return;
    subirAYouTube(path.resolve(d.ruta));
  },
};
for (const [nombre, fn] of Object.entries(ACCIONES)) host.acciones.registrar(nombre, fn);

/** Sube a YouTube (la interfaz se refresca cada segundo mientras tanto: youtube.json tiene el avance). */
async function subirAYouTube(carpeta) {
  const espera = YouTube.subir(carpeta);
  enviarEstado();
  const r = await espera;
  if (r) llamar("youtubeSubido", r);
  enviarEstado();
}

// ───────────────────────── Medios: los videos y las páginas propias (barra, cuenta, área, burbuja, teleprompter, grabadora) ─────────────────────────
// graba://video/<versión>/<ruta dentro de ~/Graba> (solo videos de una grabación) y graba://app/<página> (solo estos archivos de src/).
host.medios.registrar("video", (ruta) => videoDe(ruta));
const PAGINAS = new Set(["area", "barra", "burbuja", "cuenta", "grabadora", "teleprompter"].flatMap((n) => [`${n}.html`, `${n}.js`]).concat(["pcm.js"]));
host.medios.registrar("app", (ruta) => (PAGINAS.has(ruta) ? path.join(__dirname, ruta) : null));

// ───────────────────────── Salir y arranque ─────────────────────────
/** Si estaba grabando se cierra bien el archivo; la conversión y el procesamiento se terminan al volver a abrir Graba. */
async function antesDeSalir() {
  globalShortcut.unregisterAll();
  if (Estado.fase === "grabando" || Estado.fase === "cuenta") {
    const c = Estado.carpeta;
    ocultarFlotantes();
    Estado.cancelada = true;
    await pararGrabadora();
    if (c) Grabaciones.actualizarMeta(c, { duracion_seg: Math.round((Date.now() - Estado.inicio) / 1000) });
  }
}

// Lo que Chromium guarda (caché, preferencias del navegador) sigue en la carpeta de siempre (la del sistema para «Graba»): el host
// la movería a ~/Graba/.graba/electron y quien ya usaba Graba empezaría de cero. Pendiente para Pieza: una opción para no moverla.
const datosDeElectron = app.getPath("userData");
migrarBienvenida();
if (host.iniciar()) {
  app.setPath("userData", datosDeElectron);
  app.whenReady().then(() => {
    // Pantalla bajo el mouse (la que se eligió al empezar a grabar). En Wayland el sistema pregunta qué pantalla compartir.
    session.defaultSession.setDisplayMediaRequestHandler((_req, responder) => {
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }).then((fuentes) => {
        const id = Estado.pantalla ? String(Estado.pantalla.id) : "";
        // En Windows se puede sumar el sonido del computador ("loopback"); en Linux Chromium no lo ofrece.
        const sonido = ES_WIN && Estado.sonidoSistema ? { audio: "loopback" } : {};
        responder({ video: fuentes.find((f) => f.display_id === id) || fuentes[0], ...sonido });
      }).catch(() => responder({}));
    });
    Procesamiento.alCambiar = () => enviarEstado();
    // Al terminar bien una grabación nueva: a YouTube si la persona lo dejó activado.
    Procesamiento.alTerminarBien = (c) => { if (Config.bool("youtube_auto") && YouTube.conectado && dentroDeBase(c)) subirAYouTube(c); };
    // Si la app se cerró en medio de una grabación o de un procesamiento: se termina el video que faltaba o queda como error recuperable.
    for (const c of Grabaciones.repararCortadas()) {
      Grabaciones.escribirEstado(c, { estado: "procesando", paso: 0, total: 3, texto: "Preparando el video…" });
      terminarVideo(c);
    }
    crearGrabadora();
    crearBandeja();
    // Atajos globales (como ⌃⌥⌘R / ⌃⌥⌘P en Mac). Si otro programa ya los usa, la app sigue funcionando sin ellos.
    try { globalShortcut.register(ATAJOS.grabar, atajoGrabar); globalShortcut.register(ATAJOS.pausar, alternarPausa); } catch (e) { console.error("Graba: atajos", e.message); }
  });
}

/** Quien ya usaba Graba con todo listo y nunca eligió idioma sigue sin que se le pregunte: queda la bienvenida como hecha
 *  (`bienvenida: true`, la clave de la pieza «bienvenida»), así el host revisa las actualizaciones y arma el menú como antes. */
function migrarBienvenida() {
  const c = host.config.leer();
  if (!c.idioma_ui && c.bienvenida === undefined && !faltaAlgo()) {
    Config.guardar({ bienvenida: true });
  }
}

// Pruebas automáticas (escritorio/pruebas): acceso al estado y a las acciones desde Playwright.
if (process.env.GRABA_PRUEBAS === "1") global.grabaPruebas = { Estado, ACCIONES, ACCIONES_BARRA, grabar, iniciar, detener, cancelar, alternarPausa, atajoGrabar, enviarEstado, mostrar, host, ventanas: () => ({ ventana: host.ventana(), grabadora, barra, cuenta, burbuja, teleprompter }) };
