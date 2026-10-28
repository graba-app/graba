# Cómo aportar a Graba

Graba es gratis y abierta, y la hacemos entre todos. Hay lugar para cualquiera, programes o no. *(English below.)*

## Sin programar
- **Conversa:** dudas, ideas a medio cocinar o lo que armaste con tus grabaciones → [Discussions](https://github.com/graba-app/graba/discussions).
- **Cuéntanos qué falla o qué te gustaría:** en [issues](https://github.com/graba-app/graba/issues/new/choose).
- **Pruébala en tu sistema:** los issues con la etiqueta [`probar`](https://github.com/graba-app/graba/labels/probar) piden justo eso.
- **Traducciones:** revisa o mejora `ui/idiomas/en.json`, o propón otro idioma.

## Programando (con o sin IA)
1. Lee [`AGENTS.md`](AGENTS.md): cómo funciona, reglas y cómo se conectan las piezas. Sirve igual para personas y para tu IA
   (`CLAUDE.md` y `GEMINI.md` solo apuntan a ese archivo).
2. Haz un fork, una rama y tu cambio. La sección "Desarrollo" del [README](README.md#desarrollo) explica cómo correrla.
3. Corre `bash pruebas/correr.sh` (lo mismo que revisa GitHub en cada cambio).
4. Si tu cambio se nota (una función nueva, otra forma de hacer algo, otra pantalla), deja al día lo que lo cuenta: el
   README, la página (`docs/`), las capturas y [`CHANGELOG.md`](CHANGELOG.md). Si no sabes bien qué tocar, dilo en el pull
   request y lo completamos nosotros.
5. Abre un pull request contando qué cambia para quien usa Graba y cómo lo probaste.

Reglas que importan: código, comentarios y textos en español (todo texto nuevo de la interfaz con su traducción en `ui/idiomas/en.json`);
**nada personal** en el repo (usa datos ficticios); solo biblioteca estándar en Python; y no romper el
[formato de las grabaciones](README.md#formato-de-las-grabaciones), porque hay gente con scripts que dependen de él.

## Cómo revisamos
Todo entra por pull request y lo junta alguien que mantiene el proyecto: nadie puede subir cambios directo. Revisamos:
- **Siempre:** que las pruebas de GitHub pasen, que no haya datos personales y que el cambio haga lo que dice. Si es tu primer
  aporte, GitHub espera a que aprobemos correr las pruebas (es normal).
- **Que la documentación diga la verdad:** si el cambio agrega, cambia o quita algo que se nota, revisamos que el
  README, la página, las guías y el `CHANGELOG.md` cuenten la app como queda. Lo que falte lo completamos antes de juntar.
- **Código:** que no cambie el formato de las grabaciones, que los textos nuevos tengan su traducción y que no agregue dependencias
  ni conexiones a internet nuevas sin conversarlo antes.
- **Traducciones:** que una persona que hable el idioma revise el texto.

Si algo falta te lo pedimos con un comentario; casi nunca cerramos un aporte sin conversar.

¿Buscas por dónde empezar? Mira los issues con la etiqueta
[`good first issue`](https://github.com/graba-app/graba/labels/good%20first%20issue) o pregunta en Discussions.

**Fallas de seguridad:** nunca en un issue público. Avísanos en privado como explica [SECURITY.md](SECURITY.md).

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

---

## Contributing (English)
- **No code needed:** chat in [Discussions](https://github.com/graba-app/graba/discussions), report bugs or ideas in
  [issues](https://github.com/graba-app/graba/issues/new/choose), test it on your system (label `probar`) and help with translations.
- **Code (with or without AI):** read [`AGENTS.md`](AGENTS.md), fork, branch, run `bash pruebas/correr.sh` and open a pull request.
  Code and comments are in Spanish; UI text needs its English entry in `ui/idiomas/en.json`; never commit personal data.
  If your change is visible, also update the README, the page (`docs/`), screenshots and `CHANGELOG.md`, or say so in the
  pull request and we'll do it.
- **Review:** everything goes through a pull request and a maintainer merges it. We check tests, privacy and the recordings format.
  We also check that the README, the page and the docs still describe the app as it is.
- **Security issues:** never in a public issue; report them privately as described in [SECURITY.md](SECURITY.md).
