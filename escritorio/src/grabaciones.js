// Grabaciones en disco (~/Graba/<fecha - título>/). Mismo formato que Grabaciones en GrabaApp.swift (README, "Formato de las grabaciones").
// La grabadora deja captura.mp4 o captura.webm (lo que permita MediaRecorder) y microfono.wav (16 kHz mono);
// prepararVideo() los convierte en video.mp4 (H.264/AAC) y audio.wav con el ffmpeg que viene con la app.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { BASE, PLATAFORMA, binario } = require("./rutas");
const { leerJSON, escribirJSON, Idioma } = require("./servicios");

const dos = (n) => String(n).padStart(2, "0");
const fechaCarpeta = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
const fechaISO = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;

/** URL del video para la interfaz: se sirve por graba://video/… (el protocolo valida que esté dentro de ~/Graba). */
const urlVideo = (archivo) => "graba://video/" + encodeURIComponent(archivo);

const Grabaciones = {
  nueva() {
    const ahora = new Date();
    const c = path.join(BASE, `${fechaCarpeta(ahora)} - ${Idioma.t("Grabando")}`);
    fs.mkdirSync(c, { recursive: true });
    this.actualizarMeta(c, { inicio: fechaISO(ahora), app: PLATAFORMA });
    this.escribirEstado(c, { estado: "grabando" });
    return c;
  },
  actualizarMeta(c, cambios) {
    const ruta = path.join(c, "meta.json");
    escribirJSON(ruta, { ...(leerJSON(ruta, {}) || {}), ...cambios });
  },
  escribirEstado(c, datos) {
    try { escribirJSON(path.join(c, "estado.json"), datos); } catch {}
  },
  /** El video que hay en la carpeta: video.mp4 o, si no se pudo convertir, video.webm. */
  video(c) {
    for (const n of ["video.mp4", "video.webm"]) { const r = path.join(c, n); if (fs.existsSync(r)) return r; }
    return null;
  },
  captura(c) {
    for (const n of ["captura.mp4", "captura.webm"]) { const r = path.join(c, n); if (fs.existsSync(r)) return r; }
    return null;
  },
  listar() {
    let carpetas = [];
    try { carpetas = fs.readdirSync(BASE, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")); } catch {}
    const lista = [];
    for (const d of carpetas) {
      const c = path.join(BASE, d.name);
      const meta = leerJSON(path.join(c, "meta.json"), {}) || {};
      if (!Object.keys(meta).length) continue;
      const video = this.video(c);
      let md = null;
      try { md = fs.readFileSync(path.join(c, "grabacion.md"), "utf8"); } catch {}
      const srt = path.join(c, "subtitulos.srt");
      lista.push({ ruta: c, nombre: d.name, meta, estado: leerJSON(path.join(c, "estado.json"), {}) || {},
        video: video ? urlVideo(video) : null, md, srt: fs.existsSync(srt) ? srt : null, audio: fs.existsSync(path.join(c, "audio.wav")),
        youtube: leerJSON(path.join(c, "youtube.json"), {}) || {} });
    }
    return lista.sort((a, b) => String(b.meta.inicio || "").localeCompare(String(a.meta.inicio || "")));
  },
  /** Las que quedaron a medias porque la app se cerró: si falta convertir el video, se devuelven para terminarlas; el resto queda como error recuperable. */
  repararCortadas() {
    const pendientes = [];
    for (const t of this.listar()) {
      const e = t.estado.estado;
      if (e !== "grabando" && e !== "procesando") continue;
      if (this.captura(t.ruta) && !this.video(t.ruta)) pendientes.push(t.ruta);
      else this.escribirEstado(t.ruta, { estado: "error", error: Idioma.t("Se interrumpió. Puedes volver a procesarla.") });
    }
    return pendientes;
  },
};

function ffmpeg(args) {
  const ff = binario("ffmpeg");
  if (!ff) return Promise.resolve(false);
  return new Promise((fin) => {
    let p;
    try { p = spawn(ff, ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { stdio: "ignore", windowsHide: true }); } catch { return fin(false); }
    p.on("error", () => fin(false));
    p.on("close", (c) => fin(c === 0));
  });
}
const tamano = (r) => { try { return fs.statSync(r).size; } catch { return 0; } };

/** captura.* → video.mp4 (H.264 + AAC, listo para YouTube) y audio.wav (16 kHz mono, para whisper). */
async function prepararVideo(c) {
  const captura = Grabaciones.captura(c);
  // ffmpeg escribe a un nombre temporal: así la interfaz nunca ve (ni intenta reproducir) un video.mp4 a medias.
  const video = path.join(c, "video.mp4"), tmp = path.join(c, "convirtiendo.mp4"), audio = path.join(c, "audio.wav"), mic = path.join(c, "microfono.wav");
  // Un área: la barra dejó el recorte en .recorte.json (píxeles del video); se aplica al convertir.
  const archivoRecorte = path.join(c, ".recorte.json"), r = leerJSON(archivoRecorte, null);
  const recorte = r && [r.x, r.y, r.ancho, r.alto].every((n) => Number.isFinite(n) && n >= 0) && r.ancho >= 16 && r.alto >= 16
    ? `crop=${Math.floor(r.ancho)}:${Math.floor(r.alto)}:${Math.floor(r.x)}:${Math.floor(r.y)},` : "";
  if (captura) {
    let ok = false;
    // MediaRecorder en MP4 ya viene en H.264: el video se copia tal cual (rápido) y el audio queda en AAC; además se reordena
    // el archivo para que se pueda adelantar.
    if (captura.endsWith(".mp4") && !recorte) ok = await ffmpeg(["-y", "-i", captura, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]);
    if (!ok) {
      ok = await ffmpeg(["-y", "-i", captura, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-vf", `${recorte}scale=trunc(iw/2)*2:trunc(ih/2)*2`, "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]);
    }
    if (ok && tamano(tmp) > 0) {
      fs.renameSync(tmp, video);
      fs.rmSync(captura, { force: true });
      fs.rmSync(archivoRecorte, { force: true });
    } else {
      // Sin ffmpeg (o si falló): queda el video tal como lo grabó Chromium.
      fs.rmSync(tmp, { force: true });
      fs.renameSync(captura, path.join(c, captura.endsWith(".mp4") ? "video.mp4" : "video.webm"));
    }
  }
  // El audio para transcribir sale del video final (mismos tiempos que los subtítulos); si no se puede, el del micrófono.
  const final = Grabaciones.video(c), audioTmp = path.join(c, "convirtiendo.wav");
  if (fs.existsSync(mic) && final && (await ffmpeg(["-y", "-i", final, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioTmp])) && tamano(audioTmp) > 44) {
    fs.renameSync(audioTmp, audio);
    fs.rmSync(mic, { force: true });
  } else if (fs.existsSync(mic)) {
    fs.rmSync(audioTmp, { force: true });
    if (tamano(mic) > 44) fs.renameSync(mic, audio); else fs.rmSync(mic, { force: true });
  }
}

module.exports = { Grabaciones, prepararVideo };
