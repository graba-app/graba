// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «trabajos» (Windows y Linux, Electron): lee el archivo de progreso de un script (JSONL, lo escribe trabajos.emitir) cada
// 0,5 s y pasa las líneas nuevas, como JSON, a aviso(eventos). Equivale a app/Sources/PiezaTrabajos/LectorProgreso.swift. Sin
// Electron adentro: se prueba en Node.
//
//   const { lectorProgreso } = require("./progreso");
//   const l = lectorProgreso((eventos) => llamar("progreso", { eventos }), { prefijo: "ana" });
//   env.ANA_PROGRESO = l.ruta;     // antes de lanzar el script
//   … al terminar el script: l.terminar()   (lo último que quedó, y se borra el archivo)
//
// Límites: una línea de más de MAX_LINEA bytes se descarta entera y en cada vuelta se leen hasta MAX_VUELTA bytes.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_LINEA = 1024 * 1024;
const MAX_VUELTA = 4 * 1024 * 1024;

function lectorProgreso(aviso, { prefijo = "pieza", cada = 500, dir = os.tmpdir() } = {}) {
  const p = String(prefijo).toLowerCase().replace(/[^a-z0-9]/g, "") || "pieza";
  const ruta = path.join(dir, `${p}-progreso-${crypto.randomUUID()}.jsonl`);
  fs.writeFileSync(ruta, "", { mode: 0o600, flag: "wx" });
  let desde = 0, resto = Buffer.alloc(0), saltando = false;
  /** Devuelve true si quedó algo por leer (más de MAX_VUELTA). */
  const leer = () => {
    let d;
    try {
      const fd = fs.openSync(ruta, "r");
      try {
        const tam = fs.fstatSync(fd).size;
        if (tam <= desde) return false;
        d = Buffer.alloc(Math.min(tam - desde, MAX_VUELTA));
        const n = fs.readSync(fd, d, 0, d.length, desde);
        d = d.subarray(0, n);
        desde += n;
      } finally { fs.closeSync(fd); }
    } catch { return false; }
    resto = Buffer.concat([resto, d]);
    const eventos = [];
    let i;
    while ((i = resto.indexOf(0x0a)) >= 0) {
      const linea = resto.subarray(0, i);
      resto = resto.subarray(i + 1);
      if (saltando) { saltando = false; continue; }   // el final de una línea demasiado larga
      if (linea.length > MAX_LINEA) continue;
      try { const j = JSON.parse(linea.toString("utf8")); if (j && typeof j === "object" && !Array.isArray(j)) eventos.push(j); } catch {}
    }
    if (resto.length > MAX_LINEA) { resto = Buffer.alloc(0); saltando = true; }
    if (eventos.length) aviso(eventos);
    try { return fs.statSync(ruta).size > desde; } catch { return false; }
  };
  const reloj = setInterval(leer, cada);
  if (reloj.unref) reloj.unref();
  return {
    ruta,
    leer,
    terminar() {
      clearInterval(reloj);
      for (let k = 0; k < 8 && leer(); k++);
      try { fs.unlinkSync(ruta); } catch {}
    },
  };
}

module.exports = { lectorProgreso, MAX_LINEA, MAX_VUELTA };
