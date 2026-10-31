# Seguridad de Graba

*(English below.)*

Graba vive en tu computador y trabaja con cosas privadas: grabaciones de tu pantalla, cámara y micrófono, transcripciones y el permiso para subir videos a tu canal de YouTube. Si encuentras una falla de seguridad, gracias por
avisarnos **en privado** para arreglarla antes de que alguien la aproveche.

## Cómo avisar

1. Entra a [**Reportar una vulnerabilidad**](https://github.com/graba-app/graba/security/advisories/new) (pestaña *Security* del repo).
   Solo quienes mantienen el proyecto ven lo que escribas.
2. Cuenta qué encontraste, cómo reproducirlo (pasos, sistema y versión de Graba) y qué podría hacer alguien con eso.
3. **No abras un issue público ni un pull request** con el detalle mientras no esté arreglado.

Te respondemos dentro de una semana. Cuando esté resuelto publicamos una versión nueva (las apps se actualizan solas) y un
aviso de seguridad, con tu nombre si quieres.

## Qué cubre

- La app de Mac, la de Windows y Linux, los scripts de `bin/`, la interfaz (`ui/`), los instaladores (`instalar.sh`,
  `instalar.ps1`), el actualizador y los workflows de GitHub Actions.
- Ejemplos de lo que nos importa: código que se ejecuta desde contenido externo (archivos adjuntos, transcripciones, respuestas
  de la IA), acceso a archivos fuera de las carpetas de la app, fugas de tokens o grabaciones, descargas sin verificar y
  cualquier forma de publicar una versión que no salga de este repo.
- Fuera de alcance: fallas de la IA de cada persona (Claude Code, Codex, Gemini), de GitHub o del sistema operativo; avísales a
  ellos. Si afecta cómo Graba las usa, sí cuéntanos.

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/graba-app/graba/releases/latest).

## Cómo nos cuidamos

- Todo cambio entra por pull request y lo revisa una persona antes de juntarlo; los workflows nunca corren código de un
  pull request con permisos de escritura ni con secretos.
- Las actions de GitHub van fijadas por su commit (SHA) y con los permisos mínimos; Dependabot propone actualizaciones
  con unos días de espera.
- Las descargas que hace la app (versiones nuevas, modelos, Python, herramientas) se verifican con su huella SHA-256 antes
  de usarse.
- Lo que viene de afuera (transcripciones, archivos adjuntos, respuestas de la IA) es solo dato: se valida, se escapa
  antes de mostrarse y la interfaz tiene una política de contenido (CSP) que no deja ejecutar código que no sea el de la app.
- La IA corre en una carpeta temporal, sin herramientas ni servidores MCP, sin la memoria de Claude ni las variables de la
  app; el pedido nunca va como argumento del proceso. Las protecciones van siempre (nunca se quitan para que un CLI viejo funcione):
  si su CLI no conoce una, no corre. Lo hace la pieza «ia» de [Pieza](https://github.com/pieza-app/pieza) (`bin/ia.py`).
- Solo la interfaz propia (marco principal) puede hablarle a la app, y las versiones nuevas solo se bajan de
  `github.com/graba-app/graba/releases/download/`.

---

## Security (English)

Graba runs on your computer and handles private data (screen, camera and microphone recordings, transcripts and the permission to upload videos to your YouTube channel). If you find a security issue, please report it
**privately** through [**Report a vulnerability**](https://github.com/graba-app/graba/security/advisories/new) in the repo's
*Security* tab. Include what you found, how to reproduce it (steps, OS and Graba version) and its impact. Please don't
open a public issue or pull request with the details until it's fixed. We reply within a week, ship a fixed release (the
apps update themselves) and publish an advisory, crediting you if you want. Only the latest release is supported.
