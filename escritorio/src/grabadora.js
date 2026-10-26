// Grabadora (ventana oculta). Pantalla: getDisplayMedia (el proceso principal elige la pantalla bajo el mouse).
// Micrófono: getUserMedia. MediaRecorder escribe el video por bloques de un segundo (MP4/H.264 si Chromium lo permite, si no WebM)
// y un AudioWorklet manda el micrófono a 16 kHz mono para microfono.wav (respaldo del audio para whisper).
const puente = window.interno;
let grabador = null, ctx = null, flujos = [], cadena = Promise.resolve(), inicio = 0;
// Pausa: MediaRecorder sigue el video de corrido; el micrófono a 16 kHz deja de mandarse y el tiempo en pausa no cuenta.
let enPausa = false, pausaDesde = 0, pausado = 0;
let mezcla = null; // AudioContext que junta la voz y el sonido del computador
// Si piden detener mientras todavía se pide la pantalla (Descartar durante el arranque), no se empieza a grabar.
let abortar = false;

const FORMATOS = [
  ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.640028", "mp4"],
  ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "mp4"],
  ["video/mp4;codecs=avc1.640028,opus", "video/mp4;codecs=avc1.640028", "mp4"], // Chromium en Linux: H.264 sí, AAC no
  ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "webm"],
  ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "webm"],
  ["video/webm", "video/webm", "webm"],
];
function formato(conAudio) {
  for (const [conA, sinA, ext] of FORMATOS) {
    const tipo = conAudio ? conA : sinA;
    if (MediaRecorder.isTypeSupported(tipo)) return { tipo, ext };
  }
  return { tipo: "", ext: "webm" };
}

async function microfonoA16k(stream) {
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("pcm.js");
  if (ctx.state !== "running") await ctx.resume();
  const fuente = ctx.createMediaStreamSource(stream);
  const nodo = new AudioWorkletNode(ctx, "pcm", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit" });
  nodo.port.onmessage = (e) => {
    if (enPausa) return;
    const f = e.data, pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    puente.pcm(pcm.buffer);
  };
  fuente.connect(nodo);
}

function soltar() {
  flujos.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  flujos = [];
  try { ctx?.close(); } catch {}
  ctx = null;
  try { mezcla?.close(); } catch {}
  mezcla = null;
}

const abortada = () => { if (!abortar) return false; soltar(); puente.lista({ ok: false, error: "cancelada" }); return true; };

puente.alEmpezar(async ({ microfono, microfonoId, ancho, alto, soloCamara, camaraId, sonidoSistema }) => {
  abortar = false;
  let pantalla, mic = null;
  try {
    if (soloCamara) {
      // Solo la cámara: se graba directo (hasta 1080p), sin pasar por la pantalla.
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } };
      try { pantalla = await navigator.mediaDevices.getUserMedia({ audio: false, video: camaraId ? { ...video, deviceId: { exact: camaraId } } : video }); }
      catch { pantalla = await navigator.mediaDevices.getUserMedia({ audio: false, video }); }
    } else {
      pantalla = await navigator.mediaDevices.getDisplayMedia({ audio: !!sonidoSistema, video: { width: { ideal: ancho, max: ancho }, height: { ideal: alto, max: alto }, frameRate: { ideal: 30, max: 30 } } });
    }
    flujos.push(pantalla);
  } catch (e) {
    soltar();
    return puente.lista({ ok: false, error: e.name === "NotAllowedError" ? "permiso" : String(e.message || e) });
  }
  if (abortada()) return;
  if (microfono) {
    try {
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: microfonoId ? { ...audio, deviceId: { exact: microfonoId } } : audio }); }
      catch { mic = await navigator.mediaDevices.getUserMedia({ audio }); } // el elegido ya no está: el de siempre
      flujos.push(mic);
    } catch { mic = null; } // sin micrófono se graba igual (queda "sin voz"), como en Mac
  }
  if (abortada()) return;
  // Sonido del computador (Windows): se mezcla con la voz en una sola pista para el video; microfono.wav sigue siendo solo la voz.
  const sistema = pantalla.getAudioTracks()[0] || null;
  let pistaAudio = mic ? mic.getAudioTracks()[0] : null;
  if (sistema) {
    try {
      mezcla = new AudioContext({ sampleRate: 48000 });
      const destino = mezcla.createMediaStreamDestination();
      mezcla.createMediaStreamSource(new MediaStream([sistema])).connect(destino);
      if (mic) mezcla.createMediaStreamSource(mic).connect(destino);
      pistaAudio = destino.stream.getAudioTracks()[0];
    } catch { /* sin mezcla: queda solo la voz */ }
  }
  const pistas = [...pantalla.getVideoTracks(), ...(pistaAudio ? [pistaAudio] : [])];
  const f = formato(!!pistaAudio);
  try {
    grabador = new MediaRecorder(new MediaStream(pistas), { mimeType: f.tipo || undefined, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
  } catch (e) {
    soltar();
    return puente.lista({ ok: false, error: String(e.message || e) });
  }
  cadena = Promise.resolve();
  // Los bloques se mandan en orden aunque arrayBuffer() tarde distinto en cada uno.
  grabador.ondataavailable = (e) => { if (e.data && e.data.size) cadena = cadena.then(async () => puente.video(await e.data.arrayBuffer())); };
  grabador.onstop = async () => {
    await cadena;
    soltar();
    if (enPausa) { pausado += Date.now() - pausaDesde; enPausa = false; }
    puente.detenida({ ms: Date.now() - inicio - pausado });
  };
  // Si el sistema deja de compartir la pantalla (p. ej. el aviso de Wayland), se termina la grabación.
  pantalla.getVideoTracks()[0].addEventListener("ended", () => puente.cortada("pantalla"));
  try { if (mic) await microfonoA16k(mic); } catch { /* el audio igual queda dentro del video */ }
  if (abortada()) return;
  const ajustes = pantalla.getVideoTracks()[0].getSettings();
  grabador.start(1000);
  inicio = Date.now();
  enPausa = false; pausado = 0;
  puente.lista({ ok: true, ext: f.ext, tipo: grabador.mimeType || f.tipo, microfono: !!mic, sonidoSistema: !!sistema, ancho: ajustes.width, alto: ajustes.height });
});

puente.alPausar((si) => {
  if (!grabador || grabador.state === "inactive") return;
  if (si && grabador.state === "recording") { grabador.pause(); enPausa = true; pausaDesde = Date.now(); }
  else if (!si && grabador.state === "paused") { grabador.resume(); enPausa = false; pausado += Date.now() - pausaDesde; }
});

puente.alDetener(() => {
  if (grabador && grabador.state !== "inactive") { grabador.stop(); grabador = null; }
  else { abortar = true; soltar(); puente.detenida({ ms: 0 }); }
});

// Cámaras y micrófonos para los menús de la barra.
puente.alDispositivos(async () => {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ tipo: d.kind, id: d.deviceId, nombre: d.label }));
  } catch { return []; }
});
