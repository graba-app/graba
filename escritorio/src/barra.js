// Barra de grabación. El estado y los textos (ya traducidos) llegan del proceso principal; los menús (ventanas, cámara, micrófono)
// son menús nativos que abre el principal junto al botón.
const $ = (id) => document.getElementById(id);
const reloj = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
  : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
const ayuda = (id, texto) => { $(id).title = texto || ""; $(id).setAttribute("aria-label", texto || ""); };

window.interno.alBarra((d) => {
  const T = d.textos || {};
  $("preparando").hidden = d.fase !== "preparando";
  $("cuenta").hidden = d.fase !== "cuenta";
  $("grabando").hidden = d.fase !== "grabando";
  $("cuenta").textContent = T.cuenta || "";
  $("reloj").textContent = d.pausada ? (T.en_pausa || "") : reloj(d.segundos || 0);
  document.querySelector(".punto.rec").classList.toggle("pausa", !!d.pausada);
  $("i-pausa").hidden = !!d.pausada;
  $("i-seguir").hidden = !d.pausada;
  for (const m of ["pantalla", "ventana", "area"]) $(m).classList.toggle("activo", d.modo === m);
  $("solocamara").classList.toggle("activo", d.modo === "camara");
  $("camara").classList.toggle("activo", !!d.camara);
  $("microfono").classList.toggle("activo", !!d.microfono);
  $("guion").classList.toggle("activo", !!d.teleprompter);
  $("detalle").hidden = !d.detalle;
  $("detalle").textContent = d.detalle || "";
  $("grabar").disabled = !d.listo;
  $("t-grabar").textContent = T.grabar || "";
  $("t-terminar").textContent = T.terminar || "";
  for (const id of ["grabaciones", "pantalla", "ventana", "area", "solocamara", "camara", "microfono", "guion", "grabar", "terminar", "pausar", "cerrar"]) ayuda(id, T["ayuda_" + id]);
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-accion]");
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect();
  window.interno.barra(b.dataset.accion, { x: Math.round(r.left), y: Math.round(r.top) });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.interno.barra("cerrar", {});
});
// La ventana se ajusta al ancho de la barra (cambia según la fase) y el principal la re-centra abajo.
new ResizeObserver(() => {
  const r = $("barra").getBoundingClientRect();
  window.interno.barraTamano({ ancho: Math.ceil(r.width), alto: Math.ceil(r.height) });
}).observe($("barra"));
