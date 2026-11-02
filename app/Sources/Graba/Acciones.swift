import AppKit
import PiezaHost
import UniformTypeIdentifiers

/// Las acciones propias de Graba (lo nativo: grabar, recortar, permisos, modelos, guion, YouTube…), registradas en el puente de la
/// pieza «host-mac». Lo que trae el host (listo, config, copiar, abrirEnlace, buscarActualizacion, actualizar) y lo declarado en
/// acciones.json (probarIA, de la pieza «ia») no va aquí. Cada acción está también en escritorio/src/main.js (Windows y Linux).
@MainActor
enum Acciones {
    static func registrar(_ p: Puente) {
        p.registrar("grabar") { _ in Estado.grabar() }
        p.registrar("terminar") { _ in Estado.detener() }
        p.registrar("pausar") { _ in Estado.alternarPausa() }
        p.registrar("recortar") { d in recortar(d, deshacer: false) }
        p.registrar("deshacerRecorte") { d in recortar(d, deshacer: true) }
        p.registrar("abrirCarpeta") { d in
            if let c = carpeta(d) { p.mostrarEnFinder(c) } else { NSWorkspace.shared.open(Rutas.base) }
        }
        p.registrar("borrar") { d in
            if let c = carpeta(d) { _ = p.papelera(c) }
            p.enviarEstado()
        }
        p.registrar("procesar") { d in
            guard let c = carpeta(d) else { return }
            Grabaciones.escribirEstado(c.path, ["estado": "procesando", "paso": 0, "total": 3, "texto": "En espera…"])
            Procesamiento.encolar(c.path, soloIA: Texto.esBool(d["soloIA"]) && d["soloIA"] as? Bool == true) { p.enviarEstado() }
            p.enviarEstado()
        }
        p.registrar("descargarModelo") { d in
            let id = d["id"] as? String ?? ""
            Modelos.descargar(id, progreso: { p.llamar("modeloProgreso", ["id": id, "pct": $0]) }) { ok, error in
                if ok { Config.deLaApp(["modelo": id]) }
                p.llamar("modeloListo", ["id": id, "ok": ok, "error": error ?? ""])
                p.enviarEstado()
            }
        }
        p.registrar("permiso") { d in Permisos.pedir(d["tipo"] as? String ?? "") { p.enviarEstado() } }
        p.registrar("corregir") { d in corregir(d) }
        p.registrar("elegirArchivos") { _ in elegirArchivos() }
        p.registrar("crearGuion") { d in crearGuion(d) }
        p.registrar("grabarConGuion") { d in
            // El guion queda en el teleprompter y se abre la barra para grabar: llegar y grabar.
            Config.deLaApp(["teleprompter_texto": d["texto"] as? String ?? "", "teleprompter": true])
            Estado.grabar()
        }
        p.registrar("teleprompter") { d in
            // El guion de una grabación queda listo en el teleprompter para la próxima (solo lo ve la persona).
            Config.deLaApp(["teleprompter_texto": d["texto"] as? String ?? "", "teleprompter": true])
        }
        p.registrar("youtubeConectar") { _ in YouTube.conectar { r in p.llamar("youtubeConectado", r); p.enviarEstado() } }
        p.registrar("youtubeDesconectar") { _ in YouTube.desconectar(); p.enviarEstado() }
        p.registrar("youtubeSubir") { d in
            guard let c = carpeta(d) else { return }
            YouTube.subir(c.path)
            p.enviarEstado()
        }
    }

    /// Solo se tocan carpetas dentro de ~/Graba (la ruta viene de la interfaz).
    private static func carpeta(_ d: [String: Any]) -> URL? { Rutas.dentro(d["ruta"] as? String ?? "") }

    /// Recortar o deshacer un recorte. No mientras se procesa esa misma grabación (se cambiaría el video bajo los pies del procesamiento).
    private static func recortar(_ d: [String: Any], deshacer: Bool) {
        guard let c = carpeta(d), Procesamiento.enCurso != c.path else {
            return Puente.shared.llamar("recortado", ["ok": false, "deshacer": deshacer, "error": Idioma.t("Espera a que termine de procesar y vuelve a intentarlo.")])
        }
        let fin: @MainActor ([String: Any]) -> Void = { r in
            Puente.shared.llamar("recortado", r.merging(["deshacer": deshacer]) { a, _ in a })
            Puente.shared.enviarEstado()
        }
        if deshacer {
            Recorte.deshacer(c, listo: fin)
        } else {
            Recorte.recortar(c, inicio: (d["inicio"] as? NSNumber)?.doubleValue ?? 0, fin: (d["fin"] as? NSNumber)?.doubleValue ?? 0, listo: fin)
        }
    }

    /// "Dice Grava y es Graba": la IA corrige todo el texto y las palabras mal transcritas también en subtítulos. La instrucción va en
    /// un archivo (nunca como argumento) que se borra al terminar.
    private static func corregir(_ d: [String: Any]) {
        let texto = (d["texto"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let c = carpeta(d), !texto.isEmpty, texto.count <= 20_000 else { return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("graba-\(UUID().uuidString)")
        guard (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])) != nil else { return }
        let instr = dir.appendingPathComponent("instruccion.txt")
        FileManager.default.createFile(atPath: instr.path, contents: Data(texto.utf8), attributes: [.posixPermissions: 0o600])
        Procesamiento.correrJSON("corregir.py", [c.path, instr.path]) { r in
            try? FileManager.default.removeItem(at: dir)
            Puente.shared.llamar("corregido", r)
            if let nueva = r["carpeta"] as? String { Ventana.shared.pendiente["seleccionar"] = nueva }
            Puente.shared.enviarEstado()
        }
    }

    /// Presentación, documentos o imágenes para que la IA escriba el guion (solo se leen, no se mueven). Solo estos archivos, los que
    /// la persona eligió en el diálogo, llegan después a guion.py (igual que en Windows y Linux).
    private static var elegidos: Set<String> = []

    private static func elegirArchivos() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, .plainText, .image, .presentation, .text, .rtf]
            + ["pptx", "key", "docx", "md"].compactMap { UTType(filenameExtension: $0) }
        panel.message = Idioma.t("Elige tu presentación, documentos o imágenes")
        let alTerminar: (NSApplication.ModalResponse) -> Void = { r in
            Task { @MainActor in
                guard r == .OK else { return }
                let urls = panel.urls.map { $0.standardizedFileURL }
                elegidos.formUnion(urls.map(\.path))
                Puente.shared.llamar("archivosElegidos", urls.map { ["ruta": $0.path, "nombre": $0.lastPathComponent] })
            }
        }
        if let v = Puente.shared.ventana { panel.beginSheetModal(for: v, completionHandler: alTerminar) } else { panel.begin(completionHandler: alTerminar) }
    }

    private static func crearGuion(_ d: [String: Any]) {
        var datos = d
        let archivos = (d["archivos"] as? [Any] ?? []).compactMap { $0 as? String }.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        datos["archivos"] = archivos.filter { elegidos.contains($0) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("graba-\(UUID().uuidString)")
        guard (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])) != nil else { return }
        let entrada = dir.appendingPathComponent("guion.json")
        guard Archivos.escribirJSON(entrada, datos) else { try? FileManager.default.removeItem(at: dir); return }
        Procesamiento.correrJSON("guion.py", [entrada.path]) { r in
            try? FileManager.default.removeItem(at: dir)
            Puente.shared.llamar("guionCreado", r)
        }
    }
}
