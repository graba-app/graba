// Teleprompter: el texto avanza solo mientras se graba (barra espaciadora o ⏸ para pausar). Velocidad en puntos por segundo, como en Mac.
const $ = (id) => document.getElementById(id);
const E = { velocidad: 30, letra: 26, corriendo: false, y: 0, textos: {}, editando: false };
let ultimo = 0;

function pintar() {
  $("texto").style.fontSize = E.letra + "px";
  $("texto").style.paddingTop = Math.round($("vista").clientHeight * 0.35) + "px";
  $("texto").style.transform = `translateY(${-E.y}px)`;
  $("pausa").textContent = E.corriendo ? "⏸" : "▶";
  const titulo = E.corriendo ? E.textos.pausar : E.textos.seguir;
  $("pausa").title = titulo || ""; $("pausa").setAttribute("aria-label", titulo || "");
}
function cuadro(ahora) {
  if (E.corriendo && ultimo) {
    const max = Math.max(0, $("texto").scrollHeight - 70);
    E.y = Math.min(max, E.y + (E.velocidad * (ahora - ultimo)) / 1000);
    $("texto").style.transform = `translateY(${-E.y}px)`;
  }
  ultimo = ahora;
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
const guardar = () => window.interno.teleprompterAjustes({ velocidad: E.velocidad, letra: E.letra });

// Editar: se escribe o pega el texto aquí mismo (queda guardado para la próxima).
function editar(si) {
  const estaba = E.editando;
  E.editando = si;
  if (si) { E.corriendo = false; $("edicion").value = $("texto").textContent; }
  else if (estaba) { $("texto").textContent = $("edicion").value; E.y = 0; window.interno.teleprompterTexto($("edicion").value); }
  $("edicion").hidden = !si; $("texto").hidden = si; $("linea").hidden = si;
  const t = si ? E.textos.listo : E.textos.editar;
  $("editar").textContent = si ? "✓" : "✎"; $("editar").title = t || ""; $("editar").setAttribute("aria-label", t || "");
  if (si) $("edicion").focus();
  pintar();
}
$("editar").addEventListener("click", () => editar(!E.editando));

window.interno.alTeleprompter((d) => {
  if (d.texto != null) $("texto").textContent = d.texto;
  if (d.velocidad) { E.velocidad = d.velocidad; $("velocidad").value = d.velocidad; }
  if (d.letra) E.letra = d.letra;
  if (d.textos) {
    E.textos = d.textos;
    for (const [id, clave] of [["inicio", "inicio"], ["menos", "menos"], ["mas", "mas"], ["velocidad", "velocidad"]]) {
      $(id).title = d.textos[clave]; $(id).setAttribute("aria-label", d.textos[clave]);
    }
  }
  if (d.textos) { $("edicion").placeholder = d.textos.vacio || ""; }
  if (d.texto != null) editar(!d.texto.trim());
  if (d.corriendo != null && !E.editando) E.corriendo = d.corriendo;
  pintar();
});
$("pausa").addEventListener("click", () => { E.corriendo = !E.corriendo; pintar(); });
$("inicio").addEventListener("click", () => { E.y = 0; pintar(); });
$("velocidad").addEventListener("input", (e) => { E.velocidad = Number(e.target.value); guardar(); });
$("menos").addEventListener("click", () => { E.letra = Math.max(14, E.letra - 2); pintar(); guardar(); });
$("mas").addEventListener("click", () => { E.letra = Math.min(56, E.letra + 2); pintar(); guardar(); });
document.addEventListener("keydown", (e) => { if (e.code === "Space" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) { e.preventDefault(); E.corriendo = !E.corriendo; pintar(); } });
window.addEventListener("resize", pintar);
