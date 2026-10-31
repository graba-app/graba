// Versiones nuevas de Graba, dentro de la app (nunca una alerta del sistema): se revisa al abrir y cada 6 horas. Equivale a Actualizaciones.swift.
// Windows: el instalador del Release (Graba-Windows.exe, en silencio: cierra Graba y la vuelve a abrir).
// Linux: el AppImage se reemplaza a sí mismo; la instalación de instalar.sh (~/.local/share/Graba) se cambia completa con el tar.gz.
// Todo verificado con su .sha256 y solo desde github.com/graba-app/graba/releases/download/. Las grabaciones viven en ~/Graba, fuera de la app: actualizar no borra nada.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, net } = require("electron");
const { ES_WIN, HOME } = require("./rutas");
const { Idioma } = require("./servicios");

const REPO = "graba-app/graba";
const SIN_CONEXION = "sin-conexion";
const t = (s) => Idioma.t(s);

/** Cómo está instalada esta copia (y por lo tanto qué archivo del Release la actualiza). */
function instalacion() {
  if (!app.isPackaged) return null; // desarrollo: se actualiza con git
  if (ES_WIN) return { tipo: "windows", archivo: "Graba-Windows.exe" };
  if (process.env.APPIMAGE) return { tipo: "appimage", archivo: "Graba-Linux.AppImage", destino: process.env.APPIMAGE };
  const dir = path.dirname(process.execPath);
  if (dir === path.join(HOME, ".local", "share", "Graba")) return { tipo: "tar", archivo: "Graba-Linux.tar.gz", destino: dir };
  return null; // copia descomprimida a mano en otro lugar: mejor no tocarla
}

/** Texto entre comillas simples para bash (igual que comillas() en Actualizaciones.swift). */
const comillas = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";

/** Solo se descarga desde los Releases de este repo en github.com (GitHub redirige luego a su almacenamiento, por https). */
function esDescargaNuestra(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && x.host === "github.com" && x.pathname.startsWith(`/${REPO}/releases/download/`) && !x.search && !x.username;
  } catch { return false; }
}

/** "0.10.0" > "0.9.3" */
function esMayor(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}

async function descargar(url, destino, progreso = () => {}) {
  if (!esDescargaNuestra(url)) throw new Error("origen");
  const r = await net.fetch(url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;
  const salida = fs.createWriteStream(destino), hash = crypto.createHash("sha256"), lector = r.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      hash.update(value);
      bytes += value.length;
      if (!salida.write(value)) await new Promise((ok) => salida.once("drain", ok));
      if (total) progreso(bytes / total);
    }
  } finally { await new Promise((ok) => salida.end(ok)); }
  return hash.digest("hex");
}

const Actualizaciones = {
  disponible: { hay: false },
  _urls: null,
  get version() { return app.getVersion(); },

  /** Revisa si hay versión nueva: { hay, detalle } (detalle = SIN_CONEXION si no pudo consultar). */
  async revisar() {
    const inst = instalacion();
    let r;
    try {
      r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Graba/${this.version}` } });
    } catch { return this._fin(false, SIN_CONEXION); }
    if (r.status === 404) return this._fin(false, ""); // aún no hay versiones
    if (r.status !== 200) return this._fin(false, SIN_CONEXION);
    const o = await r.json().catch(() => ({}));
    const tag = String(o.tag_name || "").replace(/^v/, "");
    const assets = Array.isArray(o.assets) ? o.assets : [];
    const url = (n) => assets.find((a) => a.name === n)?.browser_download_url;
    if (!inst || !tag || !esMayor(tag, this.version) || !esDescargaNuestra(url(inst.archivo)) || !esDescargaNuestra(url(inst.archivo + ".sha256"))) return this._fin(false, "");
    this._urls = { archivo: url(inst.archivo), huella: url(inst.archivo + ".sha256") };
    const notas = String(o.body || "").split("\n").slice(0, 4).join("\n");
    return this._fin(true, `${t("Versión")} ${tag}\n${notas}`);
  },
  _fin(hay, detalle) {
    this.disponible = { hay, detalle: hay ? detalle : "" };
    return { hay, detalle };
  },

  /** Descarga, verifica e instala. `avisar({ paso: "1"|"2"|"3"|"error", texto, total, pct })`. Al final la app se cierra y se vuelve a abrir. */
  async instalar(avisar) {
    const inst = instalacion();
    const tErrBajar = t("No pude descargar la versión nueva. Revisa tu conexión e intenta de nuevo.");
    const tErrArmar = t("No pude preparar la versión nueva. Graba sigue igual que antes; intenta de nuevo más tarde.");
    if (!inst || !this._urls) return avisar({ paso: "error", texto: t("No encontré la descarga de la versión nueva.") });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "graba-actualizacion-"));
    const archivo = path.join(tmp, inst.archivo);
    avisar({ paso: "1", texto: t("Descargando la versión nueva…"), total: 3 });
    let huella, esperada;
    try {
      let ultimo = 0;
      huella = await descargar(this._urls.archivo, archivo, (p) => {
        if (Date.now() - ultimo > 500) { ultimo = Date.now(); avisar({ paso: "1", texto: t("Descargando la versión nueva…"), total: 3, pct: Math.round(p * 100) }); }
      });
      if (!esDescargaNuestra(this._urls.huella)) throw new Error("origen");
      const r = await net.fetch(this._urls.huella);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      esperada = (await r.text()).trim().split(/\s+/)[0].toLowerCase();
    } catch { return avisar({ paso: "error", texto: tErrBajar }); }
    if (!/^[0-9a-f]{64}$/.test(esperada || "") || huella !== esperada) { fs.rmSync(tmp, { recursive: true, force: true }); return avisar({ paso: "error", texto: tErrBajar }); }
    avisar({ paso: "2", texto: t("Preparando la versión nueva…"), total: 3 });
    const fin = () => { avisar({ paso: "3", texto: t("Instalando: Graba se cerrará y volverá a abrirse sola"), total: 3 }); };
    try {
      if (inst.tipo === "windows") {
        fin();
        // El instalador (por usuario, /S) cierra Graba, reemplaza sus archivos y la vuelve a abrir.
        spawn(archivo, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        setTimeout(() => app.exit(0), 1500);
      } else if (inst.tipo === "appimage") {
        const nuevo = inst.destino + ".nueva";
        fs.copyFileSync(archivo, nuevo);
        fs.chmodSync(nuevo, 0o755);
        fs.renameSync(nuevo, inst.destino); // en Linux se puede reemplazar el archivo aunque esté abierto
        fin();
        setTimeout(() => { app.relaunch({ execPath: inst.destino, args: process.argv.slice(1) }); app.exit(0); }, 1500);
      } else {
        const nueva = path.join(tmp, "nueva");
        fs.mkdirSync(nueva);
        const tar = spawn("tar", ["-xzf", archivo, "-C", nueva, "--strip-components=1"], { stdio: "ignore" });
        const ok = await new Promise((r) => { tar.on("error", () => r(false)); tar.on("close", (c) => r(c === 0)); });
        if (!ok || !fs.existsSync(path.join(nueva, "graba"))) throw new Error("tar");
        // Un script espera a que Graba se cierre, cambia la carpeta (deja la anterior si algo falla) y la vuelve a abrir.
        const d = inst.destino, guion = path.join(tmp, "actualizar.sh");
        const lanzador = path.join(HOME, ".local", "bin", "graba");
        // Todo lo variable va con comillas(): ninguna ruta se interpreta como código.
        const q = comillas, ant = d + ".anterior";
        fs.writeFileSync(guion, `#!/bin/bash
while kill -0 ${Number(process.pid)} 2>/dev/null; do sleep 0.5; done
rm -rf ${q(ant)}; mv ${q(d)} ${q(ant)} && mv ${q(nueva)} ${q(d)} && rm -rf ${q(ant)} || { rm -rf ${q(d)}; mv ${q(ant)} ${q(d)}; }
rm -rf ${q(tmp)}
if [ -x ${q(lanzador)} ]; then exec ${q(lanzador)}; else exec ${q(path.join(d, "graba"))}; fi
`);
        spawn("/bin/bash", [guion], { detached: true, stdio: "ignore" }).unref();
        fin();
        setTimeout(() => app.exit(0), 1500);
      }
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true });
      avisar({ paso: "error", texto: tErrArmar });
    }
  },
};

module.exports = { Actualizaciones, SIN_CONEXION, esDescargaNuestra, comillas };
