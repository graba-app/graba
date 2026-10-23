const marco = document.getElementById("marco");
let inicio = null;
window.interno.alArea((d) => { document.getElementById("ayuda").textContent = d.ayuda; });
const rect = (e) => ({ x: Math.min(inicio.x, e.clientX), y: Math.min(inicio.y, e.clientY), ancho: Math.abs(e.clientX - inicio.x), alto: Math.abs(e.clientY - inicio.y) });
document.addEventListener("mousedown", (e) => { inicio = { x: e.clientX, y: e.clientY }; document.getElementById("ayuda").hidden = true; });
document.addEventListener("mousemove", (e) => {
  if (!inicio) return;
  const r = rect(e);
  Object.assign(marco.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.ancho + "px", height: r.alto + "px" });
});
document.addEventListener("mouseup", (e) => {
  if (!inicio) return;
  const r = rect(e);
  inicio = null;
  if (r.ancho < 40 || r.alto < 40) { marco.style.display = "none"; document.getElementById("ayuda").hidden = false; return; }
  window.interno.areaElegida(r);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.interno.areaElegida(null); });
