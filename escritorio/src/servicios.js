// Configuración, idioma, permisos, IA, modelos y procesamiento. Equivale a Servicios.swift (misma config que bin/ia.py).
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, net, safeStorage, shell, systemPreferences } = require("electron");
const { ES_WIN, HOME, INTERNO, CONFIG, MODELOS, recursos, herramientas, python } = require("./rutas");

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

// ───────────── Configuración (~/Graba/.graba/config.json, compartida con bin/ia.py) ─────────────
const Config = {
  porDefecto: { ia: "", modelo: "", idioma_audio: "auto", idioma_ui: "", camara: true, microfono: true },
  /** Claves que la interfaz puede cambiar con la acción "config" (las de arriba y las del teleprompter). */
  editables: ["ia", "modelo", "idioma_audio", "idioma_ui", "camara", "microfono", "teleprompter", "teleprompter_texto", "teleprompter_velocidad", "teleprompter_letra",
    "youtube_privacidad", "youtube_auto", "youtube_client_id", "youtube_client_secret"],
  leer() { return { ...this.porDefecto, ...(leerJSON(CONFIG, {}) || {}) }; },
  guardar(cambios) {
    const d = { ...this.leer(), ...(cambios || {}) };
    fs.mkdirSync(INTERNO, { recursive: true });
    escribirJSON(CONFIG, d);
  },
  bool(clave) { const v = this.leer()[clave]; return typeof v === "boolean" ? v : !!this.porDefecto[clave]; },
  texto(clave) { const v = this.leer()[clave]; return typeof v === "string" ? v : ""; },
};

// ───────────── Idioma (las claves son el texto en español, igual que en ui/idiomas) ─────────────
const Idioma = {
  _cache: null,
  get codigo() {
    const elegido = Config.texto("idioma_ui");
    if (elegido) return elegido;
    return (app.getLocale() || "").toLowerCase().startsWith("es") ? "es" : "en";
  },
  t(texto) {
    const c = this.codigo;
    if (c === "es") return texto;
    if (!this._cache || this._cache.codigo !== c) {
      const j = leerJSON(path.join(recursos(), "ui", "idiomas", `${c}.json`), {}) || {};
      this._cache = { codigo: c, textos: j.textos || {} };
    }
    return this._cache.textos[texto] || texto;
  },
  f(plantilla, n) { return this.t(plantilla).replace(/\{n\}/g, String(n)); },
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
  /** Prueba real: le pide una palabra. Así sabemos que está instalada y con la sesión iniciada. */
  probar(id) {
    return new Promise((fin) => {
      const ia = this.conocidas.find((x) => x.id === id), ruta = ia && this.buscar(ia.comandos);
      if (!ruta) return fin({ ok: false, texto: Idioma.t("No está instalada.") });
      const pedido = "Responde solo con la palabra: listo";
      const agy = /^agy(\.exe|\.cmd|\.bat)?$/i.test(path.basename(ruta));
      const args = id === "codex" ? ["exec", "--skip-git-repo-check", "-s", "read-only", "-"]
        : agy ? ["--output-format", "text", "--sandbox", "-p", pedido]
          : id === "gemini" ? ["-p", "Responde a las instrucciones de arriba.", "-o", "text"]
            : ["-p", "--output-format", "text"];
      let p;
      try { p = lanzar(ruta, args, { env: { ...process.env, PATH: this.path() }, cwd: os.tmpdir() }); } catch (e) { return fin({ ok: false, texto: e.message }); }
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      const reloj = setTimeout(() => p.kill(), 90000);
      p.on("error", (e) => { clearTimeout(reloj); fin({ ok: false, texto: e.message }); });
      p.on("close", (c) => { clearTimeout(reloj); fin(c === 0 && out.trim() ? { ok: true, texto: out.trim() } : { ok: false, texto: (err || out).slice(-300) }); });
      p.stdin.on("error", () => {});
      p.stdin.end(agy ? "" : pedido);
    });
  },
};

/** spawn que también sirve para los .cmd de npm en Windows (necesitan pasar por la consola). */
function lanzar(ruta, args, opciones = {}) {
  if (ES_WIN && /\.(cmd|bat)$/i.test(ruta)) {
    const citar = (a) => `"${String(a).replace(/"/g, '""')}"`;
    return spawn(`${citar(ruta)} ${args.map(citar).join(" ")}`, { ...opciones, shell: true, windowsHide: true });
  }
  return spawn(ruta, args, { ...opciones, windowsHide: true });
}

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

// ───────────── Procesamiento (bin/procesar.py con el Python que viene dentro de la app) ─────────────
const Procesador = {
  enCurso: null,
  cola: [],
  /** Avisos para la ventana (lo asigna main.js). */
  alCambiar: () => {},
  alFallarInicio: () => {},
  /** Al terminar bien una grabación nueva (no un "Regenerar"): main.js la sube a YouTube si está activado. */
  alTerminarBien: () => {},
  encolar(carpeta, soloIA = false) {
    this.cola.push([carpeta, soloIA]);
    this._siguiente();
  },
  entorno() {
    return { ...process.env, GRABA_RECURSOS: recursos(), GRABA_HERRAMIENTAS: herramientas(), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1", PATH: IA.path() };
  },
  /** Corre otro script de bin/ (p. ej. corregir.py) con el mismo Python y entorno; el último argumento es la ruta del JSON de salida. */
  correrJSON(script, args, entorno = {}) {
    return new Promise((fin) => {
      const salida = path.join(os.tmpdir(), `graba-${crypto.randomUUID()}.json`);
      const terminar = () => { const r = leerJSON(salida, null); fs.rmSync(salida, { force: true }); fin(r); };
      let p;
      try { p = spawn(python(), [path.join(recursos(), "bin", script), ...args, salida], { env: { ...this.entorno(), ...entorno }, stdio: "ignore", windowsHide: true }); }
      catch { return fin(null); }
      let listo = false;
      p.on("error", () => { if (!listo) { listo = true; terminar(); } });
      p.on("close", () => { if (!listo) { listo = true; terminar(); } });
    });
  },
  _siguiente() {
    if (this.enCurso || !this.cola.length) return;
    const [carpeta, soloIA] = this.cola.shift();
    this.enCurso = carpeta;
    const salida = path.join(os.tmpdir(), `graba-${crypto.randomUUID()}.json`);
    const terminar = () => {
      const r = leerJSON(salida, null);
      fs.rmSync(salida, { force: true });
      if (r && r.ok && !soloIA && r.carpeta) try { this.alTerminarBien(r.carpeta); } catch {}
      this.enCurso = null;
      this.alCambiar();
      this._siguiente();
    };
    let p;
    try {
      p = spawn(python(), [path.join(recursos(), "bin", "procesar.py"), carpeta, salida, ...(soloIA ? ["--solo-ia"] : [])],
        { env: this.entorno(), stdio: "ignore", windowsHide: true });
    } catch (e) {
      this.alFallarInicio(carpeta, e.message);
      return terminar();
    }
    let listo = false;
    p.on("error", (e) => { if (listo) return; listo = true; this.alFallarInicio(carpeta, e.message); terminar(); });
    p.on("close", () => { if (listo) return; listo = true; terminar(); });
  },
};

// ───────────── Tokens (cifrados con el llavero del sistema: DPAPI en Windows, libsecret/kwallet en Linux; nunca en texto plano) ─────────────
const Tokens = {
  archivo: path.join(INTERNO, ".tokens"),
  /** En Linux sin llavero (gnome-keyring, kwallet…) Electron cae a "basic_text", que no protege nada: ahí no se guarda. */
  get seguro() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    try { return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"; } catch { return true; }
  },
  _todos() { return leerJSON(this.archivo, {}) || {}; },
  guardar(cuenta, token) {
    if (!this.seguro) return false;
    const t = this._todos();
    t[cuenta] = safeStorage.encryptString(token).toString("base64");
    fs.mkdirSync(INTERNO, { recursive: true });
    escribirJSON(this.archivo, t);
    try { fs.chmodSync(this.archivo, 0o600); } catch {}
    return true;
  },
  leer(cuenta) {
    const c = this._todos()[cuenta];
    if (!c || !this.seguro) return null;
    try { return safeStorage.decryptString(Buffer.from(c, "base64")); } catch { return null; }
  },
  borrar(cuenta) {
    const t = this._todos();
    if (!(cuenta in t)) return;
    delete t[cuenta];
    escribirJSON(this.archivo, t);
  },
};

// ───────────── YouTube (bin/youtube.py; el permiso queda cifrado con el llavero del sistema) ─────────────
const YouTube = {
  subiendo: new Set(),
  get conectado() { return !!Tokens.leer("youtube"); },
  /** ¿Hay un cliente OAuth para conectar? (el del proyecto o el propio de la persona, en Ajustes). */
  get disponible() {
    const archivo = leerJSON(path.join(recursos(), "bin", "youtube_cliente.json"), {}) || {};
    return !!archivo.id || !!Config.texto("youtube_client_id");
  },
  paraJS() { return { conectado: this.conectado, disponible: this.disponible, canal: Config.texto("youtube_canal") }; },
  async conectar() {
    const r = (await Procesador.correrJSON("youtube.py", ["conectar"])) || { ok: false, error: Idioma.t("No pude terminar. Intenta de nuevo.") };
    if (r.ok && r.refresh_token) {
      if (!Tokens.guardar("youtube", r.refresh_token)) { delete r.refresh_token; return { ok: false, error: Idioma.t("No pude guardar el permiso de YouTube en el llavero del sistema.") }; }
      Config.guardar({ youtube_canal: r.canal || "" });
    }
    delete r.refresh_token; // a la interfaz nunca llega el token
    return r;
  },
  desconectar() {
    Tokens.borrar("youtube");
    Config.guardar({ youtube_canal: "", youtube_auto: false });
  },
  async subir(carpeta) {
    const token = Tokens.leer("youtube");
    if (!token || this.subiendo.has(carpeta)) return null;
    this.subiendo.add(carpeta);
    try { escribirJSON(path.join(carpeta, "youtube.json"), { estado: "subiendo", pct: 0 }); } catch {}
    const r = (await Procesador.correrJSON("youtube.py", ["subir", carpeta], { GRABA_YT_TOKEN: token })) || { ok: false, error: Idioma.t("No pude terminar. Intenta de nuevo.") };
    this.subiendo.delete(carpeta);
    return r;
  },
};

module.exports = { leerJSON, escribirJSON, Config, Idioma, Permisos, IA, Modelos, Procesador, Tokens, YouTube, descargarVerificado };
