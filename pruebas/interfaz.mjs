// Pruebas de la interfaz (ui/) en un navegador real con los datos ficticios de ui/demo.json.
// Uso: node pruebas/interfaz.mjs   (necesita Playwright; PLAYWRIGHT=/ruta/a/playwright si no está instalado aquí)
// Revisa: 1) ninguna vista tira errores de JavaScript (español e inglés); 2) todo texto tiene traducción en ui/idiomas/en.json;
// 3) el botón principal se lee (contraste) en modo claro y oscuro. Con CAPTURAS=carpeta guarda capturas de cada vista.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || "playwright");
const CAPTURAS = process.env.CAPTURAS || "";
const errores = [];
const falla = (m) => { errores.push(m); console.log("  ✗ " + m); };
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const servidor = http.createServer((q, r) => {
  const ruta = path.join(RAIZ, "ui", decodeURIComponent(new URL(q.url, "http://x").pathname));
  if (!ruta.startsWith(path.join(RAIZ, "ui")) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": tipos[path.extname(ruta)] || "application/octet-stream" });
  fs.createReadStream(ruta).pipe(r);
}).listen(0);
const BASE = `http://localhost:${servidor.address().port}/index.html`;
const demo = fs.readFileSync(path.join(RAIZ, "ui", "demo.json"), "utf8");
// Textos que vienen de los datos (notas de ejemplo, nombres de IA) o que no se traducen.
const esDato = (t) => demo.includes(t) || /^(Graba|Claude|ChatGPT \(Codex\)|Gemini|YouTube|English|Español|subtitulos\.srt)$/.test(t);

const VISTAS = ["E=>{E.sel=E.grabaciones[1].ruta}", ...["notas", "guion", "youtube", "subtitulos", "transcripcion"].map((t) => `E=>{E.pestana='${t}'}`),
  "E=>{E.sel=E.grabaciones[0].ruta}", "E=>{E.sel=E.grabaciones[2].ruta}", "E=>{E.sel=E.grabaciones[1].ruta;E.corregir={ruta:E.sel,texto:''}}", "E=>{E.corregir={ruta:E.sel,texto:'x',enviando:true}}", "E=>{E.corregir=null;E.guion={paso:'pedir',idea:'',minutos:3,para:'youtube',archivos:[{ruta:'/x/a.pdf',nombre:'presentacion.pdf'}],error:'x'}}", "E=>{E.guion.paso='creando'}", "E=>{E.guion={paso:'listo',titulo:'Presupuesto',texto:'Hola, soy Ana.'}}", "E=>{E.guion=null;E.ajustes=true}", "E=>{E.ajustes=false;E.borrar='x'}",
  "E=>{E.borrar=null;E.actualizacion={hay:true,detalle:'Versión 0.2.0'}}", "E=>{E.act={paso:'2',texto:'Preparando la versión nueva…',pct:40}}", "E=>{E.act={paso:'error',texto:'x'}}", "E=>{E.act=null;E.buscando='alDia';E.ajustes=true}", "E=>{E.ajustes=false;E.grabaciones=[]}"];
const navegador = await chromium.launch();
for (const [idioma, consulta] of [["español", ""], ["inglés", "?idioma=en"]]) {
  for (const bv of [false, true]) {
    const p = await navegador.newPage({ viewport: { width: 1180, height: 780 } });
    p.on("pageerror", (e) => falla(`error de JavaScript (${idioma}): ${e.message}`));
    await p.addInitScript(() => { window._faltantes = new Set(); });
    await p.goto(BASE + (consulta ? consulta + (bv ? "&bienvenida" : "") : bv ? "?bienvenida" : ""));
    await p.waitForFunction(() => window.Graba && document.querySelector(".app"));
    const pasos = bv ? [0, 1, 2, 3].map((n) => `E=>{E.bv=${n}}`) : VISTAS;
    for (const [i, f] of pasos.entries()) {
      await p.evaluate(`window.Graba._probar(${f})`);
      await p.waitForTimeout(80);
      if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, `${idioma}-${bv ? "bienvenida" : "vista"}-${i}.png`) });
    }
    if (idioma === "inglés") {
      const faltan = [...new Set(await p.evaluate(() => [...window._faltantes]))].filter((t) => !esDato(t));
      if (faltan.length) falla(`${faltan.length} textos sin traducción en ui/idiomas/en.json:\n      ` + faltan.map((t) => JSON.stringify(t)).join("\n      "));
    }
    await p.close();
  }
  console.log(`  ✓ Vistas en ${idioma}`);
}
// Contraste del botón Grabar en modo claro y oscuro.
for (const esquema of ["light", "dark"]) {
  const p = await navegador.newPage({ colorScheme: esquema });
  await p.goto(BASE); await p.waitForSelector(".boton.principal");
  const c = await p.evaluate(() => {
    const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map((x) => { x = x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cs = getComputedStyle(document.querySelector(".boton.principal")); const a = lum(cs.color), b = lum(cs.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (c < 4.5) falla(`modo ${esquema}: el botón Grabar casi no se lee (contraste ${c.toFixed(2)})`); else console.log(`  ✓ Contraste en modo ${esquema === "light" ? "claro" : "oscuro"} (${c.toFixed(1)})`);
  await p.close();
}
await navegador.close();
servidor.close();
if (errores.length) { console.log(`\n✗ ${errores.length} problemas`); process.exit(1); }
console.log("\n✓ Interfaz en orden");
