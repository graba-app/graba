// Prueba de Graba para Linux en una pantalla virtual: abre la app, revisa que la interfaz cargue sin errores, prueba la IA
// (con una de mentira), graba unos segundos (cámara y micrófono falsos de Chromium) y revisa la carpeta que queda.
// Uso (desde escritorio/): HOME=$(mktemp -d) xvfb-run -a node pruebas/arranque.mjs <carpeta-de-capturas>
//   Playwright puede estar instalado aparte: NODE_PATH=/ruta/node_modules. No toca tus datos si HOME es temporal.
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const requerir = createRequire(import.meta.url);
const { _electron: electron } = requerir(requerir.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH || "").split(":")] }));
const salida = process.argv[2] || path.join(process.env.HOME, "capturas");
const SEGUNDOS = Number(process.env.SEGUNDOS || 5);
fs.mkdirSync(salida, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const errores = [];
const falla = (m) => { errores.push(m); console.log("  ✗ " + m); };

const app = await electron.launch({
  executablePath: process.env.ELECTRON || path.resolve("node_modules/electron/dist/electron"),
  // Con REAL=1 se graba la pantalla de verdad (sin cámara ni micrófono falsos de Chromium, que también reemplazan la pantalla).
  args: ["--no-sandbox", ...(process.env.REAL ? [] : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]), ...(process.env.APP ? [] : ["."])],
  env: { ...process.env, GRABA_PRUEBAS: "1" },
});
app.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); else console.log("  [app]", m.text()); });
let ventana = null;
for (let i = 0; i < 60 && !ventana; i++) { ventana = app.windows().find((w) => w.url() === "graba://ui/index.html"); if (!ventana) await espera(250); }
if (!ventana) throw new Error("no apareció la ventana principal");
ventana.on("pageerror", (e) => falla("interfaz: " + e.message));
let esperar404 = false; // la prueba de abajo pide a propósito un archivo que no se sirve
ventana.on("console", (m) => { if (m.type() === "error" && !(esperar404 && /404/.test(m.text()))) falla("consola: " + m.text()); });
await espera(2500);
const info = await ventana.evaluate(() => ({ host: window.GRABA_HOST, html: document.getElementById("app").innerHTML.length, titulo: document.title }));
console.log("host:", info.host, "| título:", info.titulo, "| interfaz:", info.html, "caracteres");
if (info.host !== "linux") falla("GRABA_HOST no es linux");
if (info.html < 200) falla("la interfaz no se pintó");
await ventana.screenshot({ path: `${salida}/1-bienvenida.png` });

// SOLO_ARRANQUE=1: solo revisa que la app abra y la interfaz cargue (p. ej. con la app ya empaquetada: ELECTRON=dist/linux-unpacked/graba APP=1).
if (process.env.SOLO_ARRANQUE) {
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  console.log(errores.length ? `✗ ${errores.length} problemas: ${errores.slice(0, 3).join(" | ")}` : "✓ Graba para Linux: la app abre y la interfaz carga");
  process.exit(errores.length ? 1 : 0);
}

// IA de mentira (en el PATH de la prueba) y configuración.
const r = await ventana.evaluate(() => new Promise((ok) => {
  const antes = window.Graba.iaProbada;
  window.Graba.iaProbada = (x) => { antes(x); ok(x); };
  window.grabaEscritorio.enviar({ accion: "probarIA", datos: { id: "claude" } });
  setTimeout(() => ok({ ok: false, texto: "sin respuesta" }), 20000);
}));
console.log("probarIA:", JSON.stringify(r));
if (process.env.IA_FALSA && !r.ok) falla("probarIA no funcionó con la IA de mentira");
// Primer uso: la primera pantalla es la de idioma y, hasta elegirlo, grabar (o el atajo) solo trae la ventana.
if (!(await ventana.$(".pantalla-idioma"))) falla("la primera pantalla no es la de idioma");
await app.evaluate(() => { global.grabaPruebas.grabar(); });
await espera(300);
if ((await app.evaluate(() => global.grabaPruebas.Estado.fase)) !== "inactiva") falla("se pudo grabar antes de elegir el idioma");
await ventana.evaluate(() => window.grabaEscritorio.enviar({ accion: "config", datos: { camara: true, microfono: true, idioma_ui: "es", inventada: 1 } }));
await espera(400);
const config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, "Graba", ".graba", "config.json"), "utf8"));
if ("inventada" in config) falla("config aceptó una clave desconocida");

// Ajustes en inglés
await ventana.evaluate(() => window.Graba._probar((E) => { E.bv = null; E.bvCerrada = true; E.ajustes = true; }));
await espera(500);
await ventana.screenshot({ path: `${salida}/2-ajustes.png` });
await ventana.evaluate(() => window.Graba._probar((E) => { E.ajustes = false; }));

// Teleprompter (botón "Usar en el teleprompter" de la pestaña Guion)
await ventana.evaluate(() => window.grabaEscritorio.enviar({ accion: "teleprompter", datos: { texto: "Hola, soy Ana Pérez.\nHoy les muestro cómo armar un presupuesto.\n".repeat(6) } }));
await espera(400);

// Grabar: "Grabar" abre la barra (nada empieza solo); el botón rojo hace la cuenta 3-2-1 y graba. Se prueba con un área (recorte con ffmpeg).
await app.evaluate(() => { global.grabaPruebas.grabar(); });
await espera(1500);
const barraLista = await app.evaluate(() => { const v = global.grabaPruebas.ventanas(); return { fase: global.grabaPruebas.Estado.fase, barra: !!v.barra, burbuja: !!v.burbuja, teleprompter: !!v.teleprompter }; });
console.log("barra:", JSON.stringify(barraLista));
if (barraLista.fase !== "preparando" || !barraLista.barra) falla("no se abrió la barra para preparar");
if (!barraLista.teleprompter) falla("no apareció el teleprompter");
const barraVentana = app.windows().find((w) => w.url().includes("barra.html"));
if (barraVentana) await barraVentana.screenshot({ path: `${salida}/3-barra.png` }).catch(() => {});
await app.evaluate(() => { const E = global.grabaPruebas.Estado; E.modo = "area"; E.area = { x: 100, y: 100, ancho: 800, alto: 450 }; });
await app.evaluate(() => { global.grabaPruebas.iniciar(); }); // sin esperar: la cuenta dura 3 s
await espera(1200);
const durante = await app.evaluate(() => { const v = global.grabaPruebas.ventanas(); return { fase: global.grabaPruebas.Estado.fase, cuenta: !!v.cuenta, burbuja: !!v.burbuja }; });
console.log("en la cuenta:", JSON.stringify(durante));
if (durante.fase !== "cuenta" || !durante.cuenta) falla("no empezó la cuenta 3-2-1");
const cuentaVentana = app.windows().find((w) => w.url().includes("cuenta.html"));
if (cuentaVentana) await cuentaVentana.screenshot({ path: `${salida}/3-cuenta.png`, timeout: 5000 }).catch(() => {});
await espera(2500 + SEGUNDOS * 1000);
const fase = await app.evaluate(() => global.grabaPruebas.Estado.fase);
console.log("fase:", fase);
if (fase !== "grabando") falla("no quedó grabando");
const flotantes = app.windows().filter((w) => /barra|burbuja|teleprompter/.test(w.url()));
for (const w of flotantes) await w.screenshot({ path: `${salida}/4-${w.url().match(/(barra|burbuja|teleprompter)/)[1]}.png`, timeout: 5000 }).catch(() => {});
await app.evaluate(() => { global.grabaPruebas.detener(); });
// Esperar a que quede el video y empiece (y termine) el procesamiento.
const base = path.join(process.env.HOME, "Graba");
let carpeta = null, estado = null;
for (let i = 0; i < 120; i++) {
  await espera(500);
  carpeta = fs.readdirSync(base).filter((n) => !n.startsWith(".")).map((n) => path.join(base, n))[0];
  try { estado = JSON.parse(fs.readFileSync(path.join(carpeta, "estado.json"), "utf8")); } catch {}
  if (estado && (estado.estado === "error" || estado.estado === "lista")) break;
}
const archivos = carpeta ? fs.readdirSync(carpeta) : [];
console.log("carpeta:", carpeta && path.basename(carpeta), "| archivos:", archivos.join(", "));
console.log("meta:", carpeta && fs.readFileSync(path.join(carpeta, "meta.json"), "utf8").replace(/\s+/g, " "));
console.log("estado:", JSON.stringify(estado));
if (!archivos.includes("video.mp4") && !archivos.includes("video.webm")) falla("no quedó el video");
if (process.env.CON_FFMPEG && !archivos.includes("video.mp4")) falla("no quedó video.mp4");
await espera(800);
await ventana.screenshot({ path: `${salida}/5-grabacion.png` });
// El video se sirve por graba://video/ (con rangos) y se puede reproducir.
const video = await ventana.evaluate(async () => {
  const v = document.getElementById("video");
  if (!v) return { hay: false };
  await new Promise((ok) => { if (v.readyState >= 1) ok(); v.onloadedmetadata = ok; v.onerror = ok; setTimeout(ok, 5000); });
  return { hay: true, src: v.src.slice(0, 40), duracion: v.duration, ancho: v.videoWidth, error: v.error && v.error.code };
});
console.log("video en la interfaz:", JSON.stringify(video));
if (!video.hay || video.error || !(video.ancho > 0)) falla("el video no se puede reproducir en la interfaz");
if (process.env.CON_FFMPEG && video.ancho !== 800) falla(`el área no se recortó (ancho ${video.ancho}, se esperaba 800)`);
// Corregir con la IA (la de mentira no sabe corregir: basta con que llegue una respuesta a window.Graba.corregido)
const corregido = await ventana.evaluate((ruta) => new Promise((ok) => {
  const antes = window.Graba.corregido;
  window.Graba.corregido = (r) => { antes?.(r); ok(r); };
  window.grabaEscritorio.enviar({ accion: "corregir", datos: { ruta, texto: "dice Grava y es Graba" } });
  setTimeout(() => ok(null), 60000);
}), carpeta);
console.log("corregir:", JSON.stringify(corregido));
if (!corregido) falla("corregir no respondió");

// Crear un guion con la IA (la de mentira no sabe: basta con que llegue una respuesta a window.Graba.guionCreado)
const guion = await ventana.evaluate(() => new Promise((ok) => {
  const antes = window.Graba.guionCreado;
  window.Graba.guionCreado = (r) => { antes?.(r); ok(r); };
  window.grabaEscritorio.enviar({ accion: "crearGuion", datos: { idea: "Cómo armar un presupuesto", minutos: 3, para: "youtube", archivos: ["/etc/passwd"] } });
  setTimeout(() => ok(null), 60000);
}));
console.log("crearGuion:", JSON.stringify(guion).slice(0, 160));
if (!guion) falla("crearGuion no respondió");

// Buscar versión nueva (sin empaquetar nunca hay: se actualiza con git) y estado de YouTube en la interfaz
const revisada = await ventana.evaluate(() => new Promise((ok) => {
  const antes = window.Graba.actualizacionRevisada;
  window.Graba.actualizacionRevisada = (r) => { antes?.(r); ok(r); };
  window.grabaEscritorio.enviar({ accion: "buscarActualizacion", datos: {} });
  setTimeout(() => ok(null), 30000);
}));
console.log("buscarActualizacion:", JSON.stringify(revisada));
if (!revisada || revisada.hay) falla("buscarActualizacion no respondió bien");
const yt = await app.evaluate(() => { global.grabaPruebas.ACCIONES.youtubeDesconectar(); return true; });
if (!yt) falla("youtubeDesconectar falló");

// Rutas fuera de ~/Graba no se sirven (el 404 sale en la consola: es lo esperado)
esperar404 = true;
const fuera = await ventana.evaluate(() => fetch("graba://video/" + encodeURIComponent("/etc/passwd")).then((r) => r.status).catch(() => "error"));
if (fuera !== 404 && fuera !== "error") falla("graba://video sirvió un archivo fuera de ~/Graba");
await espera(300);
esperar404 = false;
fs.writeFileSync(`${salida}/errores.json`, JSON.stringify(errores, null, 1));
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
console.log(errores.length ? `✗ ${errores.length} problemas` : "✓ Graba para Linux: arranque y grabación en orden");
process.exit(errores.length ? 1 : 0);
