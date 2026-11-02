// Lo propio de Graba sobre la pieza «host-escritorio» (host.js): la ventana, el puente, config, idioma, el procesador con límite de
// tiempo, safeStorage y las actualizaciones ya los trae el host. Aquí queda lo de Graba (equivale a Servicios.swift): dónde viven las
// grabaciones y las herramientas, los valores por defecto de su config, permisos, la lista de IA instaladas, la descarga de modelos
// (pendiente #4 de Pieza: modelos en el host), la fila de procesamiento y YouTube. main.js lo conecta con el host (`usar(host)`).
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, net, shell, systemPreferences } = require("electron");

const ES_WIN = process.platform === "win32";
const PLATAFORMA = ES_WIN ? "windows" : "linux";
/** Carpeta de escritorio/vendor (mismos nombres que usa electron-builder en ${os}: linux, win). */
const VENDOR = ES_WIN ? "win" : "linux";
const HOME = os.homedir();
/** Las grabaciones: una carpeta por grabación. Fuera de la app, así actualizar no borra nada. La carpeta de datos del host
 *  (`"datos": "visible"` de app.json) es ~/Graba/.graba: la de siempre. */
const BASE = path.join(HOME, "Graba");
const INTERNO = path.join(BASE, ".graba");
const MODELOS = path.join(INTERNO, "modelos");
/** Raíz del repo cuando se corre sin empaquetar (escritorio/src → raíz). */
const REPO = path.resolve(__dirname, "..", "..");

/** whisper-cli y ffmpeg (vienen con la app). */
function herramientas() {
  return app.isPackaged ? path.join(process.resourcesPath, "herramientas") : path.join(REPO, "escritorio", "vendor", VENDOR, "herramientas");
}

/** Un binario de la app (herramientas/) o, si no viene, el del sistema (PATH). */
function binario(nombre) {
  const exe = ES_WIN ? nombre + ".exe" : nombre;
  const dentro = path.join(herramientas(), exe);
  if (fs.existsSync(dentro)) return dentro;
  for (const d of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const r = path.join(d, exe);
    try { if (fs.statSync(r).isFile()) return r; } catch {}
  }
  return null;
}

/** Solo se tocan carpetas dentro de ~/Graba (igual que Rutas.dentro en Servicios.swift). */
function dentroDeBase(ruta) {
  if (typeof ruta !== "string" || !ruta || ruta.includes("\0")) return false;
  const r = path.resolve(ruta);
  const relativa = path.relative(BASE, r);
  return !!relativa && !relativa.startsWith("..") && !path.isAbsolute(relativa);
}

function leerJSON(ruta, defecto = {}) {
  try { return JSON.parse(fs.readFileSync(ruta, "utf8")); } catch { return defecto; }
}
/** Escribe JSON con las claves ordenadas (igual que .sortedKeys en Mac) y de forma atómica. */
function escribirJSON(ruta, datos) {
  const ordenado = Object.fromEntries(Object.keys(datos).sort().map((k) => [k, datos[k]]));
  const tmp = ruta + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(ordenado, null, 2));
  fs.renameSync(tmp, ruta);
}

/** El host (pieza «host-escritorio»): lo pone main.js al arrancar. */
let H = null;
function usar(host) { H = host; }

// ───────────── Configuración (la del host, validada por app.json, con los valores por defecto de Graba) ─────────────
const Config = {
  porDefecto: { ia: "", modelo: "", idioma_audio: "auto", idioma_ui: "", camara: true, microfono: true },
  leer() { return { ...this.porDefecto, ...H.config.leer() }; },
  /** Lo que escribe la app (incluye las claves "interfaz": false de app.json: modo, cámara, micrófono elegido, canal…). */
  guardar(cambios) { H.config.guardar(cambios || {}, { desdeInterfaz: false }); },
  bool(clave) { const v = this.leer()[clave]; return typeof v === "boolean" ? v : !!this.porDefecto[clave]; },
  texto(clave) { const v = this.leer()[clave]; return typeof v === "string" ? v : ""; },
};

// ───────────── Idioma (el del host: las claves son el texto en español, igual que en ui/idiomas) ─────────────
const Idioma = {
  get codigo() { return H.idioma.codigo; },
  get elegido() { return H.idioma.elegido; },
  t(texto) { return H ? H.t(texto) : texto; },
  f(plantilla, n) { return H.idioma.f(plantilla, { n }); },
};

// ───────────── Permisos ─────────────
// Linux no tiene permisos por app: Chromium usa el micrófono y la cámara directo (y en Wayland el sistema pregunta qué pantalla compartir).
// Windows sí tiene interruptores de privacidad para cámara y micrófono; la pantalla no necesita permiso.
const Permisos = {
  _estado(tipo) {
    if (!ES_WIN) return true;
    try { return systemPreferences.getMediaAccessStatus(tipo === "camara" ? "camera" : "microphone") !== "denied"; } catch { return true; }
  },
  paraJS() { return { pantalla: true, camara: this._estado("camara"), microfono: this._estado("microfono") }; },
  pedir(tipo) {
    if (ES_WIN && (tipo === "camara" || tipo === "microfono") && !this._estado(tipo)) {
      shell.openExternal(tipo === "camara" ? "ms-settings:privacy-webcam" : "ms-settings:privacy-microphone");
    }
  },
};

// ───────────── IA del usuario (se detecta y se prueba, no se configura a mano) ─────────────
const IA = {
  conocidas: [
    { id: "claude", nombre: "Claude", comandos: ["claude"] },
    { id: "codex", nombre: "ChatGPT (Codex)", comandos: ["codex"] },
    { id: "gemini", nombre: "Gemini", comandos: ["agy", "gemini"] },
  ],
  /** Carpetas donde suelen quedar estas herramientas (la app no siempre hereda el PATH de la terminal). */
  dirs() {
    const d = [path.join(HOME, ".local", "bin"), path.join(HOME, ".claude", "local"), path.join(HOME, ".codex", "bin"), path.join(HOME, ".npm-global", "bin"),
      path.join(HOME, ".volta", "bin"), path.join(HOME, ".bun", "bin"), "/usr/local/bin", "/usr/bin"];
    if (ES_WIN) d.push(path.join(process.env.APPDATA || "", "npm"), path.join(process.env.LOCALAPPDATA || "", "Programs", "claude"));
    const nvm = path.join(HOME, ".nvm", "versions", "node");
    try {
      d.push(...fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => path.join(nvm, v, "bin")));
    } catch {}
    return [...(process.env.PATH || "").split(path.delimiter), ...d].filter(Boolean);
  },
  buscar(comandos) {
    const ext = ES_WIN ? [".exe", ".cmd", ".bat", ""] : [""];
    for (const c of comandos) for (const d of this.dirs()) for (const e of ext) {
      const r = path.join(d, c + e);
      try { if (fs.statSync(r).isFile()) return r; } catch {}
    }
    return null;
  },
  /** PATH completo para los procesos hijos (Python y la IA). */
  path() { return [herramientas(), ...new Set(this.dirs())].join(path.delimiter); },
  paraJS() { return this.conocidas.map((x) => ({ id: x.id, nombre: x.nombre, instalada: !!this.buscar(x.comandos) })); },
};

// ───────────── Modelos de transcripción (whisper.cpp), descargados y verificados por huella ─────────────
// Los mismos archivos y huellas que Modelos en Servicios.swift. Aquí whisper corre en el procesador (sin Metal):
// el modelo grande solo conviene en equipos potentes, por eso cambia el recomendado y el detalle.
const Modelos = {
  lista: [
    { id: "turbo", nombre: "Preciso", archivo: "ggml-large-v3-turbo-q5_0.bin", bytes: 574041195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
      detalle: "El mejor resultado. Sin tarjeta gráfica es más lento: recomendado con 8 núcleos y 16 GB de RAM o más." },
    { id: "small", nombre: "Liviano", archivo: "ggml-small-q5_1.bin", bytes: 190085487,
      sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
      detalle: "Más rápido y pequeño; el recomendado para la mayoría de los computadores." },
  ],
  existe(m) { try { return fs.statSync(path.join(MODELOS, m.archivo)).size === m.bytes; } catch { return false; } },
  hayAlguno() { return this.lista.some((m) => this.existe(m)); },
  get recomendado() { return os.cpus().length >= 8 && os.totalmem() >= 16 * 2 ** 30 ? "turbo" : "small"; },
  paraJS() {
    return { recomendado: this.recomendado,
      lista: this.lista.map((m) => ({ id: m.id, nombre: m.nombre, mb: Math.floor(m.bytes / 1e6), detalle: m.detalle, listo: this.existe(m) })) };
  },
  _bajando: null,
  async descargar(id, progreso) {
    const m = this.lista.find((x) => x.id === id);
    if (!m) throw new Error("?");
    if (this.existe(m)) return;
    if (this._bajando) throw new Error(Idioma.t("Ya hay una descarga en curso."));
    this._bajando = id;
    try {
      fs.mkdirSync(MODELOS, { recursive: true });
      await descargarVerificado(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.archivo}`, m.sha256, path.join(MODELOS, m.archivo),
        (b) => progreso(b / m.bytes));
    } finally { this._bajando = null; }
  },
};

/** Descarga a un temporal calculando la huella mientras llega; solo lo deja en su lugar si coincide. */
async function descargarVerificado(url, sha256, destino, progreso = () => {}) {
  const r = await net.fetch(url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const tmp = destino + ".descarga";
  const salida = fs.createWriteStream(tmp);
  const hash = crypto.createHash("sha256");
  let bytes = 0, ultimo = 0;
  const lector = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      hash.update(value);
      bytes += value.length;
      if (!salida.write(value)) await new Promise((ok) => salida.once("drain", ok));
      if (Date.now() - ultimo > 250) { ultimo = Date.now(); progreso(bytes); }
    }
  } finally {
    await new Promise((ok) => salida.end(ok));
  }
  if (hash.digest("hex") !== sha256) { fs.rmSync(tmp, { force: true }); throw new Error(Idioma.t("La descarga llegó dañada. Intenta de nuevo.")); }
  try { fs.rmSync(destino, { force: true }); fs.renameSync(tmp, destino); } catch { throw new Error(Idioma.t("No pude guardar la descarga.")); }
}

// ───────────── Procesamiento (bin/procesar.py, de a una grabación, con el procesador del host) ─────────────
const Procesamiento = {
  enCurso: null,
  cola: [],
  /** Avisos para la ventana (los asigna main.js). */
  alCambiar: () => {},
  /** Al terminar bien una grabación nueva (no un "Regenerar"): main.js la sube a YouTube si está activado. */
  alTerminarBien: () => {},
  /** Lo que los scripts de Graba necesitan además de lo que pone el host: whisper-cli y ffmpeg, y el PATH con las IA. */
  entorno() { return { GRABA_HERRAMIENTAS: herramientas(), PATH: IA.path() }; },
  encolar(carpeta, soloIA = false) {
    this.cola.push([carpeta, soloIA]);
    this._siguiente();
  },
  /** Otro script de bin/ (corregir.py, guion.py) con el entorno de Graba. La IA de la persona puede tardar: 15 minutos como mucho. */
  correrJSON(script, args, { limite = 900, entorno = {} } = {}) {
    return H.procesador.correrJSON(script, args, { limite, entorno: { ...this.entorno(), ...entorno } });
  },
  /** Sin tope de tiempo mientras procesar.py lata (pieza «trabajos»: `mantener_vivo()`): una grabación larga transcribe por mucho
   *  rato, pero si el proceso se cuelga (45 s sin latido) el host lo corta. */
  async _siguiente() {
    if (this.enCurso || !this.cola.length) return;
    const [carpeta, soloIA] = this.cola.shift();
    this.enCurso = carpeta;
    const r = await H.procesador.correrJSON("procesar.py", [carpeta, ...(soloIA ? ["--solo-ia"] : [])], { latido: true, entorno: this.entorno() });
    // El script no alcanzó a dejar su error (lo cortó el host o no arrancó): queda como error recuperable.
    if (!r.ok && (leerJSON(path.join(carpeta, "estado.json"), {}) || {}).estado === "procesando") {
      try { escribirJSON(path.join(carpeta, "estado.json"), { estado: "error", error: Idioma.t("No pude terminar. Intenta de nuevo.") }); } catch {}
    }
    if (r.ok && !soloIA && r.carpeta) try { this.alTerminarBien(r.carpeta); } catch {}
    this.enCurso = null;
    this.alCambiar();
    this._siguiente();
  },
};

// ───────────── YouTube (bin/youtube.py; el permiso queda cifrado con safeStorage, en el mismo archivo de siempre) ─────────────
/** Los secretos del host con el archivo de antes (~/Graba/.graba/.tokens, cuenta «youtube»): quien ya conectó su canal no lo pierde. */
const tokens = () => H.secretos("tokens", { archivo: ".tokens" });
const YouTube = {
  subiendo: new Set(),
  get conectado() { return !!tokens().leer("youtube"); },
  /** ¿Hay un cliente OAuth para conectar? (el del proyecto o el propio de la persona, en Ajustes). */
  get disponible() {
    const archivo = leerJSON(path.join(H.recursos, "bin", "youtube_cliente.json"), {}) || {};
    return !!archivo.id || !!Config.texto("youtube_client_id");
  },
  paraJS() { return { conectado: this.conectado, disponible: this.disponible, canal: Config.texto("youtube_canal") }; },
  /** Conectar espera a que la persona dé permiso en su navegador: hasta 10 minutos. */
  async conectar() {
    const r = await Procesamiento.correrJSON("youtube.py", ["conectar"], { limite: 600 });
    if (r.ok && r.refresh_token) {
      if (!tokens().guardar("youtube", r.refresh_token)) { delete r.refresh_token; return { ok: false, error: Idioma.t("No pude guardar el permiso de YouTube en el llavero del sistema.") }; }
      Config.guardar({ youtube_canal: r.canal || "" });
    }
    delete r.refresh_token; // a la interfaz nunca llega el token
    return r;
  },
  desconectar() {
    tokens().borrar("youtube");
    Config.guardar({ youtube_canal: "", youtube_auto: false });
  },
  /** bin/youtube.py lee el token de GRABA_YT_TOKEN (no se toca en esta migración: pendiente #5 de Pieza, la pieza «youtube»).
   *  Subir un video largo tarda: hasta una hora, el tope del host. */
  async subir(carpeta) {
    const token = tokens().leer("youtube");
    if (!token || this.subiendo.has(carpeta)) return null;
    this.subiendo.add(carpeta);
    try { escribirJSON(path.join(carpeta, "youtube.json"), { estado: "subiendo", pct: 0 }); } catch {}
    const r = await Procesamiento.correrJSON("youtube.py", ["subir", carpeta], { limite: 3600, entorno: { GRABA_YT_TOKEN: token } });
    this.subiendo.delete(carpeta);
    return r;
  },
};

module.exports = { ES_WIN, PLATAFORMA, HOME, BASE, INTERNO, MODELOS, herramientas, binario, dentroDeBase, leerJSON, escribirJSON, usar,
  Config, Idioma, Permisos, IA, Modelos, Procesamiento, YouTube, descargarVerificado };
