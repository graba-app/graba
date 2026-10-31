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
  "E=>{E.sel=E.grabaciones[0].ruta}", "E=>{E.sel=E.grabaciones[2].ruta}", "E=>{E.pestana='youtube';E.youtube={conectado:true,disponible:true,canal:'Canal de Ana'}}", "E=>{E.grabaciones[1].youtube={estado:'subiendo',pct:40}}", "E=>{E.grabaciones[1].youtube={estado:'lista',url:'https://youtu.be/x',privacidad:'unlisted',aviso:'x'}}", "E=>{E.grabaciones[1].youtube={estado:'error',error:'x'}}", "E=>{E.youtube={conectado:false,disponible:false};E.grabaciones[1].youtube={}}", "E=>{E.youtube={conectado:true,disponible:true,canal:'x'};E.ajustes=true}", "E=>{E.ajustes=false;E.youtube={conectado:false,disponible:true}}", "E=>{E.pestana='notas'}",
  "E=>{E.sel=E.grabaciones[1].ruta;E.corregir={ruta:E.sel,texto:''}}", "E=>{E.corregir={ruta:E.sel,texto:'x',enviando:true}}", "E=>{E.corregir=null;E.guion={paso:'pedir',idea:'',minutos:3,para:'youtube',archivos:[{ruta:'/x/a.pdf',nombre:'presentacion.pdf'}],error:'x'}}", "E=>{E.guion.paso='creando'}", "E=>{E.guion={paso:'listo',titulo:'Presupuesto',texto:'Hola, soy Ana.'}}", "E=>{E.guion=null;E.ajustes=true}",
  // Borrar pregunta antes (confirmar de la pieza «componentes»); la vista siguiente dice que no.
  "E=>{E.ajustes=false;window.Graba._pruebas.ui.confirmar({titulo:'¿Borrar esta grabación?',texto:'Se va a la Papelera con el video, las notas y los subtítulos. Puedes recuperarla desde ahí.',si:'Mover a la Papelera',peligro:true})}",
  "E=>{document.querySelector('[data-pz-confirmar=no]')?.click();window.Graba.actualizacionRevisada({hay:true,detalle:'Versión 0.2.0'})}", "E=>{window.Graba.actualizacionProgreso({paso:'2',texto:'Preparando la versión nueva…',total:3,pct:40})}", "E=>{window.Graba.actualizacionProgreso({paso:'error',texto:'x'})}", "E=>{window.Graba._pruebas.ui.act.estado=null;window.Graba.actualizacionRevisada({hay:false});E.ajustes=true}",
  "E=>{E.ajustes=true;window.Graba.iaProbada({ia:'claude',ok:false,codigo:'sin_respuesta',plantilla:'{ia} no respondió. {detalle}',valores:{ia:'Claude',detalle:''}})}",
  "E=>{window.Graba._pruebas.ui.abrirComentarios({tipo:'idea'})}", "E=>{document.querySelector('[data-pz-cerrar]')?.click()}",
  "E=>{E.ajustes=false;E.sel=E.grabaciones[1].ruta;E.recorte={ruta:E.sel,inicio:12.5,fin:131,duracion:140,enviando:false,error:'x'}}",
  "E=>{E.recorte.enviando=true;E.recorte.error=''}", "E=>{E.recorte=null;E.grabaciones[1].recortada=true}",
  "E=>{E.grabaciones[1].recortada=false;E.fase='grabando';E.grabandoDesde=Date.now()-65000}", "E=>{E.pausada=true;E.segundos=65}",
  "E=>{E.fase='inactiva';E.pausada=false;E.grabaciones=[]}"];
const navegador = await chromium.launch();
for (const [idioma, consulta] of [["español", ""], ["inglés", "?idioma=en"]]) {
  for (const bv of [false, true]) {
    const p = await navegador.newPage({ viewport: { width: 1180, height: 780 } });
    p.on("pageerror", (e) => falla(`error de JavaScript (${idioma}): ${e.message}`));
    await p.addInitScript(() => { window._faltantes = new Set(); });
    await p.goto(BASE + (consulta ? consulta + (bv ? "&bienvenida" : "") : bv ? "?bienvenida" : ""));
    await p.waitForFunction(() => window.Graba && document.querySelector(".app, .pantalla-idioma"));
    const pasos = bv ? [0, 1, 2, 3, 4].map((n) => `E=>{E.bv=${n}}`) : VISTAS;
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
// Primer uso: lo primero es elegir el idioma (sin la app detrás); al elegir English, la bienvenida sigue en inglés y queda guardado.
for (const [locale, sugerido] of [["en-US", "en"], ["es-CL", "es"]]) {
  const p = await navegador.newPage({ locale, viewport: { width: 1180, height: 780 } });
  p.on("pageerror", (e) => falla(`error de JavaScript (idioma primero): ${e.message}`));
  await p.goto(BASE + "?bienvenida");
  await p.waitForSelector(".pantalla-idioma");
  const primera = await p.evaluate(() => ({ app: !!document.querySelector(".app"), titulo: document.querySelector("#t-idioma")?.textContent,
    botones: [...document.querySelectorAll("[data-idioma-ui]")].map((b) => b.querySelector("b").textContent), foco: document.activeElement?.dataset?.idiomaUi }));
  if (primera.app || !/Elige tu idioma/.test(primera.titulo) || !/Choose your language/.test(primera.titulo)) falla(`con ?bienvenida la primera pantalla no es la de idioma: ${JSON.stringify(primera)}`);
  if (primera.botones.join("|") !== "Español|English") falla(`opciones de idioma: ${primera.botones}`);
  if (primera.foco !== sugerido) falla(`con el sistema en ${locale} el foco debería estar en "${sugerido}" y está en "${primera.foco}"`);
  if (locale === "en-US") {
    // Con teclado: flecha a Español y de vuelta a English, Enter.
    await p.keyboard.press("ArrowLeft");
    if (await p.evaluate(() => document.activeElement?.dataset?.idiomaUi) !== "es") falla("las flechas no mueven el foco entre idiomas");
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Enter");
    await p.waitForSelector("#t-bv");
    const despues = await p.evaluate(() => { let g; window.Graba._probar((E) => { g = { idioma_ui: E.config.idioma_ui, bv: E.bv }; }); return { ...g, titulo: document.querySelector("#t-bv").textContent, lang: document.documentElement.lang }; });
    if (despues.titulo !== "Hi, this is Graba" || despues.lang !== "en") falla(`al elegir English el siguiente paso no quedó en inglés: ${JSON.stringify(despues)}`);
    if (despues.idioma_ui !== "en") falla(`no se guardó idioma_ui (quedó ${JSON.stringify(despues.idioma_ui)})`);
    if (despues.bv !== 1) falla(`después del idioma debería venir el saludo (paso 1) y vino ${despues.bv}`);
  }
  await p.close();
}
console.log("  ✓ El idioma va primero");
// Si ya había elegido el idioma, la bienvenida parte en el saludo.
{
  const p = await navegador.newPage();
  await p.goto(BASE + "?bienvenida");
  await p.waitForSelector(".pantalla-idioma");
  await p.evaluate(() => window.Graba._probar((E) => { E.bv = null; E.config.idioma_ui = "es"; }));
  await p.evaluate(() => window.Graba.estado({ config: { ia: "", idioma_ui: "es" }, ias: [], modelos: { lista: [] } }));
  if (!(await p.$("#t-bv")) || (await p.$(".pantalla-idioma"))) falla("con el idioma ya elegido no debería volver a preguntarlo");
  await p.close();
}
// Contraste del botón Grabar en modo claro y oscuro.
for (const esquema of ["light", "dark"]) {
  const p = await navegador.newPage({ colorScheme: esquema });
  await p.goto(BASE); await p.waitForSelector(".pz-boton.grabar");
  const c = await p.evaluate(() => {
    const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map((x) => { x = x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const razon = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const cs = getComputedStyle(document.querySelector(".pz-boton.grabar"));
    // Rojo y verde de la pieza «tema» como texto, sobre el fondo y el panel (AA: 4,5).
    const color = (v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const pares = {};
    for (const t of ["--rojo", "--verde", "--texto-suave"]) for (const f of ["--fondo", "--panel"]) pares[`${t} sobre ${f}`] = razon(color(t), color(f));
    return { grabar: razon(cs.color, cs.backgroundColor), pares };
  });
  const modo = esquema === "light" ? "claro" : "oscuro";
  if (c.grabar < 4.5) falla(`modo ${modo}: el botón Grabar casi no se lee (contraste ${c.grabar.toFixed(2)})`); else console.log(`  ✓ Contraste del botón Grabar en modo ${modo} (${c.grabar.toFixed(1)})`);
  for (const [n, r] of Object.entries(c.pares)) if (r < 4.5) falla(`modo ${modo}: ${n} no pasa AA (${r.toFixed(2)})`);
  await p.close();
}
await navegador.close();
servidor.close();
if (errores.length) { console.log(`\n✗ ${errores.length} problemas`); process.exit(1); }
console.log("\n✓ Interfaz en orden");
