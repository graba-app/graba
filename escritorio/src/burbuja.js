// Muestra la cámara en espejo, con la forma elegida (círculo, cuadrado, horizontal o vertical: el tamaño lo da la ventana).
// Si no hay cámara (o no hay permiso), avisa y el proceso principal cierra la burbuja.
let flujo = null, dispositivo = null;
async function abrir(id) {
  flujo?.getTracks().forEach((t) => t.stop());
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ video: id ? { ...video, deviceId: { exact: id } } : video, audio: false });
  } catch (e) {
    if (id) return abrir(""); // la cámara elegida ya no está: la de siempre
    return window.interno.sinCamara(e.name || String(e));
  }
  document.getElementById("video").srcObject = flujo;
}
window.interno.alBurbuja((d) => {
  document.getElementById("burbuja").classList.toggle("recta", d.forma !== "circulo");
  if (d.dispositivo !== dispositivo || !flujo) { dispositivo = d.dispositivo; abrir(d.dispositivo || ""); }
});
