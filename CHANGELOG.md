# Cambios · Changelog

Lo que cambia para quien usa Graba, en palabras simples. Las versiones anteriores a este archivo están en
[Releases](https://github.com/graba-app/graba/releases).
*What changes for people using Graba, in plain words. Earlier versions are listed in Releases.*

## Sin publicar · Unreleased
- **Apariencia y comentarios:** en Ajustes ahora puedes elegir claro, oscuro o como el sistema, y mandarnos un comentario o contar
  un error (se abre GitHub con tu mensaje listo; lo publicas tú). Los diálogos se usan entero con el teclado (Tab no se escapa, Esc
  cierra y el foco vuelve a donde estabas), los avisos ya no se pisan entre ellos y el rojo y el verde se leen mejor. · *Appearance
  and feedback: in Settings you can now choose light, dark or match system, and send us feedback or report a bug (GitHub opens with
  your message ready; you post it yourself). Dialogs work fully with the keyboard (Tab stays inside, Esc closes and focus goes back
  where you were), notices no longer cover each other, and red and green are easier to read.*
- **Por dentro, piezas de Pieza:** tu IA, la configuración y los idiomas ahora usan las piezas compartidas de la familia
  (`nucleo`, `ia`, `i18n`). Al probar tu IA en la bienvenida o en Ajustes, ahora va con las mismas protecciones que al escribir
  tus notas (sin herramientas ni tu memoria, en una carpeta temporal), y si falla te dice por qué en tu idioma. · *Under the hood,
  Pieza pieces: your AI, settings and languages now use the family's shared pieces (`nucleo`, `ia`, `i18n`). Testing your AI in
  the welcome or in Settings now uses the same protections as writing your notes (no tools or memory, in a temporary folder), and
  if it fails it tells you why in your language.*
- **Nueva licencia:** desde esta versión, Graba es AGPL-3.0, como sus apps hermanas. Sigue siendo gratis y abierta; si alguien la
  modifica y la ofrece a otras personas, tiene que compartir su código. Las versiones hasta la 0.1.0 siguen bajo MIT. · *New license:
  starting with this version, Graba is AGPL-3.0, like its sister apps. It's still free and open; anyone who modifies it and offers it
  to others has to share their code. Versions up to 0.1.0 remain under MIT.*
- Graba es más segura con tu IA: nunca la usa sin sus protecciones (si tu Claude es muy antiguo, no corre), no le
  pasa tu memoria de Claude ni datos internos de la app, y lo que le pide ya no queda a la vista de otros programas.
  Las actualizaciones solo se bajan desde las versiones oficiales de Graba en GitHub.
  *Graba is safer with your AI: it never runs it without its protections (if your Claude is too old, it doesn't run),
  doesn't pass it your Claude memory or the app's internal data, and what it asks is no longer visible to other programs.
  Updates are only downloaded from Graba's official releases on GitHub.*
- Mientras una grabación se procesa o se sube, Graba ya no vuelve a leer todas tus grabaciones cada segundo: solo actualiza la
  ventana cuando el avance cambia. Menos trabajo para tu computador, sobre todo con muchas grabaciones.
  *While a recording is processing or uploading, Graba no longer rereads all your recordings every second: it only updates the
  window when the progress changes. Less work for your computer, especially with many recordings.*
