// Dónde vive cada cosa (equivale a Rutas en Servicios.swift). Los datos del usuario en ~/Graba (nunca dentro de la app)
// y el código (bin/, ui/) dentro de la app; sin empaquetar, el del repo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

const ES_WIN = process.platform === "win32";
const PLATAFORMA = ES_WIN ? "windows" : "linux";
/** Carpeta de escritorio/vendor (mismos nombres que usa electron-builder en ${os}: linux, win). */
const VENDOR = ES_WIN ? "win" : "linux";
const HOME = os.homedir();
/** Datos del usuario: una carpeta por grabación. Fuera de la app, así actualizar no borra nada. */
const BASE = path.join(HOME, "Graba");
const INTERNO = path.join(BASE, ".graba");
const CONFIG = path.join(INTERNO, "config.json");
const MODELOS = path.join(INTERNO, "modelos");
/** Raíz del repo cuando se corre sin empaquetar (escritorio/src → raíz). */
const REPO = path.resolve(__dirname, "..", "..");

/** Código (bin/, ui/): dentro de la app si está empaquetada; si no, el del repo. */
function recursos() {
  return app.isPackaged ? path.join(process.resourcesPath, "graba") : REPO;
}

/** whisper-cli y ffmpeg (vienen con la app). */
function herramientas() {
  return app.isPackaged ? path.join(process.resourcesPath, "herramientas") : path.join(REPO, "escritorio", "vendor", VENDOR, "herramientas");
}

/** Python portátil que viene con la app; en desarrollo (sin vendor/), el del sistema. */
function python() {
  const dentro = app.isPackaged ? path.join(process.resourcesPath, "python") : path.join(REPO, "escritorio", "vendor", VENDOR, "python");
  const r = ES_WIN ? path.join(dentro, "python.exe") : path.join(dentro, "bin", "python3");
  return fs.existsSync(r) ? r : ES_WIN ? "python" : "python3";
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

/** Solo se tocan carpetas dentro de ~/Graba (igual que rutaValida en Ventana.swift). */
function dentroDeBase(ruta) {
  if (typeof ruta !== "string" || !ruta) return false;
  const r = path.resolve(ruta);
  const relativa = path.relative(BASE, r);
  return !!relativa && !relativa.startsWith("..") && !path.isAbsolute(relativa);
}

module.exports = { ES_WIN, PLATAFORMA, HOME, BASE, INTERNO, CONFIG, MODELOS, REPO, recursos, herramientas, python, binario, dentroDeBase };
