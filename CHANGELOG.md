# Cambios · Changelog

Lo que cambia para quien usa Graba, en palabras simples. Las versiones anteriores a este archivo están en
[Releases](https://github.com/graba-app/graba/releases).
*What changes for people using Graba, in plain words. Earlier versions are listed in Releases.*

## Sin publicar · Unreleased
- **Tus «gracias» quedan:** si al final de un video dices «Gracias» o «Thank you», ahora queda en la transcripción y los
  subtítulos; solo se quita cuando whisper lo inventa en un silencio. · *Your «thank you» stays: if you say «Gracias» or «Thank
  you» at the end of a video, it now stays in the transcript and subtitles; it's only removed when whisper makes it up in silence.*
- **Actualizaciones más claras:** el aviso dice «Hay una versión nueva» cuando hay una versión, y «Hay cambios nuevos en el código»
  solo si instalaste Graba desde su código. · *Clearer updates: the notice says «There's a new version» when there is one, and
  «There are new changes in the code» only if you installed Graba from its source.*
- **Apariencia y comentarios:** en Ajustes ahora puedes elegir claro, oscuro o como el sistema, y mandarnos un comentario o contar
  un error (se abre GitHub con tu mensaje listo; lo publicas tú). Los diálogos se usan entero con el teclado (Tab no se escapa, Esc
  cierra y el foco vuelve a donde estabas), los avisos ya no se pisan entre ellos y el rojo y el verde se leen mejor. · *Appearance
  and feedback: in Settings you can now choose light, dark or match system, and send us feedback or report a bug (GitHub opens with
  your message ready; you post it yourself). Dialogs work fully with the keyboard (Tab stays inside, Esc closes and focus goes back
  where you were), notices no longer cover each other, and red and green are easier to read.*
- **Borrar con más cuidado:** al confirmar que quieres borrar una grabación, el botón marcado es «Cancelar», así un Enter apurado
  no la borra. En Ajustes, cada IA tiene una sola acción clara y una que no está instalada se puede revisar de nuevo. · *Safer
  deleting: when you confirm deleting a recording, «Cancel» is the selected button, so a hasty Enter won't delete it. In Settings,
  each AI has a single clear action, and one that isn't installed can be checked again.*
- **Transcripción más fiel:** en Windows y Linux, las palabras que corregiste antes (nombres, marcas) ahora también ayudan a
  transcribir, como en Mac, y whisper se repite menos y anota menos ruidos. Tus subtítulos y archivos quedan con el mismo formato.
  · *More faithful transcripts: on Windows and Linux, the words you corrected before (names, brands) now also help transcription,
  as on Mac, and whisper repeats itself less and writes down fewer noises. Your subtitles and files keep the same format.*
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
