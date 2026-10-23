import AppKit
import UniformTypeIdentifiers
import WebKit

/// Ventana principal: la interfaz web (ui/) dentro de un WKWebView. La interfaz llama `host.enviar(accion, datos)`
/// y la app responde con `window.Graba.<funcion>(json)`. Cada acción está también en escritorio/ (Windows y Linux).
@MainActor
final class Ventana: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    static let shared = Ventana()
    private var ventana: NSWindow?
    private var web: WKWebView?
    private var lista = false
    fileprivate(set) var pendiente: [String: Any] = [:]
    private var refresco: Timer?

    func mostrar(seleccionar ruta: String? = nil, aviso: String? = nil) {
        if let ruta { pendiente["seleccionar"] = ruta }
        if let aviso { pendiente["aviso"] = aviso }
        if ventana == nil { crear() }
        NSApp.setActivationPolicy(.regular)
        ventana?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if lista { enviarEstado() }
        iniciarRefresco()
    }

    func ocultar() {
        ventana?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
    }

    private func crear() {
        let control = WKUserContentController()
        control.add(self, name: "graba")
        control.addUserScript(WKUserScript(source: "window.GRABA_HOST = 'mac';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let conf = WKWebViewConfiguration()
        conf.userContentController = control
        conf.mediaTypesRequiringUserActionForPlayback = []
        let w = WKWebView(frame: NSRect(x: 0, y: 0, width: 1120, height: 740), configuration: conf)
        w.setValue(false, forKey: "drawsBackground")
        let v = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 740),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        v.titlebarAppearsTransparent = true
        v.titleVisibility = .hidden
        v.minSize = NSSize(width: 760, height: 520)
        v.contentView = w
        v.delegate = self
        v.isReleasedWhenClosed = false
        v.setFrameAutosaveName("Graba")
        if !v.setFrameUsingName("Graba") { v.center() }
        ventana = v
        web = w
        let indice = Rutas.recursos.appendingPathComponent("ui/index.html")
        // Acceso de lectura a todo el disco del usuario para reproducir los videos de ~/Graba (solo lectura).
        w.loadFileURL(indice, allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        ocultar()
        return false
    }

    /// Mientras se procesa una grabación, la interfaz se actualiza sola cada segundo (avance por pasos).
    private func iniciarRefresco() {
        refresco?.invalidate()
        refresco = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                guard Ventana.shared.ventana?.isVisible == true else { return }
                if Procesador.enCurso != nil { Ventana.shared.enviarEstado() }
            }
        }
    }

    // MARK: Hacia la interfaz

    func llamar(_ funcion: String, _ datos: Any) {
        guard let web, let d = try? JSONSerialization.data(withJSONObject: datos), let json = String(data: d, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.Graba && window.Graba.\(funcion)(\(json))")
    }

    func enviarEstado() {
        guard lista else { return }
        var e: [String: Any] = [
            "fase": Estado.fase.rawValue, "grabaciones": Grabaciones.listar(), "config": Config.leer(), "ias": IA.paraJS,
            "modelos": Modelos.paraJS, "permisos": Permisos.paraJS, "carpeta": Rutas.base.path,
            "procesando": Procesador.enCurso ?? NSNull(),
            "actualizacion": Actualizaciones.disponible,
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
        ]
        e.merge(pendiente) { _, nuevo in nuevo }
        pendiente = [:]
        llamar("estado", e)
    }

    // MARK: Desde la interfaz

    func userContentController(_ c: WKUserContentController, didReceive mensaje: WKScriptMessage) {
        guard let m = mensaje.body as? [String: Any], let accion = m["accion"] as? String else { return }
        let d = m["datos"] as? [String: Any] ?? [:]
        let ruta = d["ruta"] as? String ?? ""
        // Solo se tocan carpetas dentro de ~/Graba.
        let rutaValida = !ruta.isEmpty && URL(fileURLWithPath: ruta).standardizedFileURL.path.hasPrefix(Rutas.base.path + "/")
        switch accion {
        case "listo":
            lista = true
            enviarEstado()
        case "grabar":
            Estado.grabar()
        case "abrirCarpeta":
            if rutaValida { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: ruta)]) } else { NSWorkspace.shared.open(Rutas.base) }
        case "abrirVideo":
            if rutaValida { NSWorkspace.shared.open(URL(fileURLWithPath: ruta).appendingPathComponent("video.mp4")) }
        case "copiar":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(d["texto"] as? String ?? "", forType: .string)
        case "borrar":
            if rutaValida { try? FileManager.default.trashItem(at: URL(fileURLWithPath: ruta), resultingItemURL: nil) }
            enviarEstado()
        case "procesar":
            guard rutaValida else { return }
            Grabaciones.escribirEstado(ruta, ["estado": "procesando", "paso": 0, "total": 3, "texto": "En espera…"])
            Procesador.encolar(ruta, soloIA: d["soloIA"] as? Bool ?? false) { Ventana.shared.enviarEstado() }
            enviarEstado()
        case "config":
            Config.guardar(d)
            enviarEstado()
        case "probarIA":
            let id = d["id"] as? String ?? ""
            IA.probar(id) { ok, texto in
                if ok { Config.guardar(["ia": id]) }
                Ventana.shared.llamar("iaProbada", ["id": id, "ok": ok, "texto": texto])
                Ventana.shared.enviarEstado()
            }
        case "descargarModelo":
            let id = d["id"] as? String ?? ""
            Modelos.descargar(id, progreso: { Ventana.shared.llamar("modeloProgreso", ["id": id, "pct": $0]) }) { ok, error in
                if ok { Config.guardar(["modelo": id]) }
                Ventana.shared.llamar("modeloListo", ["id": id, "ok": ok, "error": error ?? ""])
                Ventana.shared.enviarEstado()
            }
        case "permiso":
            Permisos.pedir(d["tipo"] as? String ?? "") { Ventana.shared.enviarEstado() }
        case "corregir":
            // "Dice Grava y es Graba": la IA corrige todo el texto y las palabras mal transcritas también en subtítulos.
            let texto = (d["texto"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard rutaValida, !texto.isEmpty else { return }
            let instr = FileManager.default.temporaryDirectory.appendingPathComponent("graba-instruccion-\(UUID().uuidString).txt")
            try? texto.write(to: instr, atomically: true, encoding: .utf8)
            Procesador.correrJSON("corregir.py", [ruta, instr.path]) { r in
                try? FileManager.default.removeItem(at: instr)
                Ventana.shared.llamar("corregido", r)
                if let c = r["carpeta"] as? String { Ventana.shared.pendiente["seleccionar"] = c }
                Ventana.shared.enviarEstado()
            }
        case "elegirArchivos":
            // Presentación, documentos o imágenes para que la IA escriba el guion (solo se leen, no se mueven).
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = true
            panel.canChooseDirectories = false
            panel.allowedContentTypes = [.pdf, .plainText, .image, .presentation, .text, .rtf]
                + ["pptx", "key", "docx", "md"].compactMap { UTType(filenameExtension: $0) }
            panel.message = Idioma.t("Elige tu presentación, documentos o imágenes")
            if let v = ventana {
                panel.beginSheetModal(for: v) { r in
                    guard r == .OK else { return }
                    Ventana.shared.llamar("archivosElegidos", panel.urls.map { ["ruta": $0.path, "nombre": $0.lastPathComponent] })
                }
            }
        case "crearGuion":
            let entrada = FileManager.default.temporaryDirectory.appendingPathComponent("graba-guion-\(UUID().uuidString).json")
            Grabaciones.escribirJSON(entrada, d)
            Procesador.correrJSON("guion.py", [entrada.path]) { r in
                try? FileManager.default.removeItem(at: entrada)
                Ventana.shared.llamar("guionCreado", r)
            }
        case "grabarConGuion":
            // El guion queda en el teleprompter y se abre la barra para grabar: llegar y grabar.
            Config.guardar(["teleprompter_texto": d["texto"] as? String ?? "", "teleprompter": true])
            Estado.grabar()
        case "buscarActualizacion":
            Actualizaciones.revisar { hay, detalle in
                Ventana.shared.llamar("actualizacionRevisada", ["hay": hay, "detalle": detalle, "sinConexion": detalle == Actualizaciones.sinConexion])
                Ventana.shared.enviarEstado()
            }
        case "actualizar":
            // Nunca en medio de una grabación o de un procesamiento: cerrar la app los cortaría.
            guard Estado.fase == .inactiva, Procesador.enCurso == nil else {
                llamar("actualizacionProgreso", ["paso": "error", "texto": Idioma.t("Espera a que termine la grabación o el procesamiento y vuelve a intentarlo.")])
                return
            }
            Actualizaciones.seguir { Ventana.shared.llamar("actualizacionProgreso", $0) }
            Actualizaciones.instalar { ok, error in
                if !ok { Ventana.shared.llamar("actualizacionProgreso", ["paso": "error", "texto": error]) }
            }
        case "teleprompter":
            // El guion de una grabación queda listo en el teleprompter para la próxima (solo lo ve la persona).
            Config.guardar(["teleprompter_texto": d["texto"] as? String ?? "", "teleprompter": true])
        case "abrirEnlace":
            if let u = URL(string: d["url"] as? String ?? ""), u.scheme == "https" { NSWorkspace.shared.open(u) }
        default:
            break
        }
    }
}
