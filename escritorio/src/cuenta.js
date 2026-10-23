const n = document.getElementById("n");
window.interno.alCuenta((valor) => { n.textContent = valor; n.classList.remove("cambio"); void n.offsetWidth; n.classList.add("cambio"); });
