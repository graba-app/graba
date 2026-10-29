// Firma del avance (equivale a Ventana.firmaAvance en Ventana.swift). Mientras se procesa o se sube una grabación, la ventana se
// refresca cada segundo; antes eso volvía a leer TODAS las grabaciones (con sus notas) y a mandarlas a la interfaz aunque nada hubiera
// cambiado. El avance de verdad vive en estado.json y youtube.json de las carpetas activas: si esos archivos no cambiaron, no se
// manda nada. Solo fs y path, para poder probarlo sin Electron (pruebas/avance.mjs).
const fs = require("fs");
const path = require("path");

const leer = (archivo) => { try { return fs.readFileSync(archivo, "utf8"); } catch { return ""; } };

/** Texto que cambia cuando cambia el avance de alguna carpeta activa (o cuando cambian las carpetas activas). */
function firmaAvance(carpetas) {
  return JSON.stringify([...new Set(carpetas.filter(Boolean))].map((c) => [c, leer(path.join(c, "estado.json")), leer(path.join(c, "youtube.json"))]));
}

module.exports = { firmaAvance };
