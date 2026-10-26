// Puente de las páginas propias de la app (grabadora oculta, barra, cuenta, área, teleprompter y burbuja de la cámara).
// En sus scripts no declares globales con el nombre que se expone aquí ("interno"): da un SyntaxError silencioso.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("interno", {
  // Grabadora
  alEmpezar: (f) => ipcRenderer.on("empezar", (_e, d) => f(d)),
  alDetener: (f) => ipcRenderer.on("detener", () => f()),
  alPausar: (f) => ipcRenderer.on("pausar", (_e, si) => f(!!si)),
  video: (buffer) => ipcRenderer.send("grabadora-video", Buffer.from(buffer)),
  pcm: (buffer) => ipcRenderer.send("grabadora-pcm", Buffer.from(buffer)),
  lista: (d) => ipcRenderer.send("grabadora-lista", d),
  detenida: (d) => ipcRenderer.send("grabadora-detenida", d),
  cortada: (motivo) => ipcRenderer.send("grabadora-cortada", motivo),
  alDispositivos: (f) => ipcRenderer.on("dispositivos", async () => ipcRenderer.send("dispositivos", await f())),
  // Barra, cuenta y área
  alBarra: (f) => ipcRenderer.on("barra", (_e, d) => f(d)),
  barra: (accion, d) => ipcRenderer.send("barra", accion, d),
  barraTamano: (d) => ipcRenderer.send("barra-tamano", d),
  alCuenta: (f) => ipcRenderer.on("cuenta", (_e, n) => f(n)),
  alArea: (f) => ipcRenderer.on("area", (_e, d) => f(d)),
  areaElegida: (r) => ipcRenderer.send("area-elegida", r),
  // Teleprompter
  alTeleprompter: (f) => ipcRenderer.on("teleprompter", (_e, d) => f(d)),
  teleprompterAjustes: (d) => ipcRenderer.send("teleprompter-ajustes", d),
  teleprompterTexto: (texto) => ipcRenderer.send("teleprompter-texto", texto),
  // Burbuja
  alBurbuja: (f) => ipcRenderer.on("burbuja", (_e, d) => f(d)),
  sinCamara: (motivo) => ipcRenderer.send("burbuja-sin-camara", motivo),
});
