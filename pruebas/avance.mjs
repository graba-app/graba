// La ventana solo se refresca cuando cambia el avance (escritorio/src/avance.js; lo mismo en Ventana.swift).
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert/strict";

const { firmaAvance } = createRequire(import.meta.url)("../escritorio/src/avance.js");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "graba-avance-"));
const c = path.join(base, "2026-01-05 103000 - Grabando");
fs.mkdirSync(c);
const estado = (o) => fs.writeFileSync(path.join(c, "estado.json"), JSON.stringify(o), "utf8");

estado({ estado: "procesando", paso: 1, total: 3, texto: "Transcribiendo…" });
const f1 = firmaAvance([c, null]);
assert.equal(firmaAvance([c]), f1, "sin cambios, la misma firma (no se manda nada)");
assert.equal(firmaAvance([c, c]), f1, "una carpeta repetida (procesando y subiendo) cuenta una vez");
fs.writeFileSync(path.join(c, "grabacion.md"), "# Notas de Ana Pérez\n", "utf8");
assert.equal(firmaAvance([c]), f1, "otros archivos no cuentan: el avance vive en estado.json y youtube.json");

estado({ estado: "procesando", paso: 2, total: 3, texto: "Escribiendo con tu IA…" });
const f2 = firmaAvance([c]);
assert.notEqual(f2, f1, "otro paso, otra firma");

fs.writeFileSync(path.join(c, "youtube.json"), JSON.stringify({ estado: "subiendo", pct: 40 }), "utf8");
assert.notEqual(firmaAvance([c]), f2, "el avance de la subida también cuenta");

// Al terminar, procesar.py renombra la carpeta: la vieja ya no existe y la firma cambia.
const f3 = firmaAvance([c]);
fs.renameSync(c, path.join(base, "2026-01-05 103000 - Presupuesto en 3 minutos"));
assert.notEqual(firmaAvance([c]), f3, "carpeta renombrada, otra firma");
assert.notEqual(firmaAvance([]), firmaAvance([c]), "sin carpetas activas, otra firma");

fs.rmSync(base, { recursive: true, force: true });
console.log("Avance: la ventana se refresca solo cuando cambia (7 casos)");
