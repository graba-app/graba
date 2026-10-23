import AVFoundation
import AppKit

/// Graba: graba tu pantalla con tu cámara (como Loom), transcribe en tu Mac y tu IA te deja notas, guion para YouTube,
/// títulos, descripción, capítulos y subtítulos. Vive en la barra de menú; la ventana es la interfaz web de ui/.
@main
@MainActor
final class GrabaApp: NSObject, NSApplicationDelegate {
    static func main() {
        let app = NSApplication.shared
        let delegado = GrabaApp()
        app.delegate = delegado
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ aviso: Notification) {
        try? FileManager.default.createDirectory(at: Rutas.interno, withIntermediateDirectories: true)
        Grabaciones.repararCortadas()
        // El idioma en que se habla parte igual al del sistema: con poca voz, "detectar solo" puede confundirse.
        if Grabaciones.leerJSON(Rutas.config)["idioma_audio"] == nil {
            let sistema = String((Locale.preferredLanguages.first ?? "es").prefix(2))
            Config.guardar(["idioma_audio": ["es", "en", "pt", "fr", "de", "it"].contains(sistema) ? sistema : "auto"])
        }
        BarraMenu.shared.instalar()
        Actualizaciones.revisarCadaRato()
        // La primera vez (o si falta algo para funcionar) se abre la ventana con el asistente.
        if Config.texto("ia").isEmpty || !Modelos.lista.contains(where: Modelos.existe) { Ventana.shared.mostrar() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        Ventana.shared.mostrar()
        return true
    }
}

// MARK: - Grabación

@MainActor
enum Estado {
    enum Fase: String { case inactiva, preparando, cuenta, grabando, terminando }
    static var fase = Fase.inactiva { didSet { BarraMenu.shared.actualizar() } }
    static var segundos = 0
    private static let grabadora = Grabadora()
    private static var carpeta: URL?
    private static var reloj: Timer?
    private static var cancelada = false

    /// Primero se elige qué grabar (pantalla, ventana o área), la cámara y el teleprompter; después viene la cuenta 3-2-1.
    static func grabar() {
        guard fase == .inactiva else { return }
        guard CGPreflightScreenCaptureAccess() else {
            Permisos.pedir("pantalla") {}
            Ventana.shared.mostrar()
            return
        }
        Ventana.shared.ocultar()
        fase = .preparando
        Barra.shared.mostrar(grabar: { iniciar($0) }, terminar: { detener() }, cancelar: { cancelar() })
    }

    private static func iniciar(_ p: Preparacion) {
        let pantalla = p.pantalla
        let microfono = p.microfono && AVCaptureDevice.authorizationStatus(for: .audio) != .denied
        let fuente: Grabadora.Fuente
        switch p.modo {
        case "ventana":
            guard let id = p.ventanaElegida else { fase = .inactiva; return }
            fuente = .ventana(id)
            if let v = p.ventanas.first(where: { $0.id == id }) { NSRunningApplication(processIdentifier: v.pid)?.activate() }
        case "area":
            guard let r = p.area else { fase = .inactiva; return }
            fuente = .area(pantalla, r)
        default:
            fuente = .pantalla(pantalla)
        }
        fase = .cuenta
        cancelada = false
        Task { @MainActor in
            for n in stride(from: 3, through: 1, by: -1) {
                Barra.shared.cuenta(n)
                try? await Task.sleep(for: .seconds(1))
                if cancelada { return }
            }
            let c = Grabaciones.nueva()
            carpeta = c
            do {
                // Lo que solo ve la persona (controles, teleprompter, marco del área) queda fuera; la cámara siempre entra.
                let fuera = [Barra.shared.ventana, Teleprompter.shared.ventana, MarcoArea.shared.id].compactMap { $0 }
                try await grabadora.empezar(en: c.appendingPathComponent("video.mp4"), fuente: fuente, excluyendo: fuera,
                                            incluyendo: [Burbuja.shared.ventana].compactMap { $0 }, microfono: microfono)
                grabadora.alFallar = { mensaje in Task { @MainActor in fallo(mensaje) } }
                fase = .grabando
                segundos = 0
                Barra.shared.grabando()
                if p.teleprompter { Teleprompter.shared.empezar() }
                reloj = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                    Task { @MainActor in
                        segundos += 1
                        Barra.shared.estado.segundos = segundos
                        BarraMenu.shared.actualizar()
                    }
                }
            } catch {
                fallo(error.localizedDescription)
            }
        }
    }

    /// Cierra todo lo que flota sobre la pantalla.
    private static func limpiarFlotantes() {
        Barra.shared.ocultar()
        Burbuja.shared.ocultar()
        Teleprompter.shared.ocultar()
        MarcoArea.shared.ocultar()
    }

    static func detener() {
        guard fase == .grabando, let c = carpeta else { if fase == .cuenta { cancelar() }; return }
        fase = .terminando
        reloj?.invalidate()
        limpiarFlotantes()
        Task { @MainActor in
            let duracion = await grabadora.detener()
            fase = .inactiva
            carpeta = nil
            guard duracion >= 1 else {
                try? FileManager.default.removeItem(at: c)
                Ventana.shared.mostrar(aviso: Idioma.t("La grabación quedó vacía."))
                return
            }
            Grabaciones.actualizarMeta(c, ["duracion_seg": Int(duracion.rounded())])
            Grabaciones.escribirEstado(c.path, ["estado": "procesando", "paso": 0, "total": 3, "texto": "Preparando el audio…"])
            Ventana.shared.mostrar(seleccionar: c.path)
            _ = try? await Grabadora.extraerAudio(de: c.appendingPathComponent("video.mp4"), a: c.appendingPathComponent("audio.wav"))
            Procesador.encolar(c.path) { Ventana.shared.enviarEstado() }
            Ventana.shared.enviarEstado()
        }
    }

    static func cancelar() {
        if fase == .preparando { limpiarFlotantes(); fase = .inactiva; return }
        cancelada = true
        let c = carpeta
        let estaba = fase
        fase = .terminando
        reloj?.invalidate()
        limpiarFlotantes()
        Task { @MainActor in
            if estaba == .grabando { _ = await grabadora.detener() }
            if let c { try? FileManager.default.removeItem(at: c) }
            carpeta = nil
            fase = .inactiva
        }
    }

    private static func fallo(_ mensaje: String) {
        let c = carpeta
        cancelada = true
        reloj?.invalidate()
        limpiarFlotantes()
        Task { @MainActor in
            _ = await grabadora.detener()
            if let c { try? FileManager.default.removeItem(at: c) }
            carpeta = nil
            fase = .inactiva
            Ventana.shared.mostrar(aviso: Idioma.t("No pude grabar:") + " " + mensaje)
        }
    }
}

// MARK: - Grabaciones en disco (~/Graba/<fecha - título>/)

@MainActor
enum Grabaciones {
    static func nueva() -> URL {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HHmmss"
        let c = Rutas.base.appendingPathComponent(f.string(from: Date()) + " - " + Idioma.t("Grabando"))
        try? FileManager.default.createDirectory(at: c, withIntermediateDirectories: true)
        let iso = DateFormatter()
        iso.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        actualizarMeta(c, ["inicio": iso.string(from: Date()), "app": "mac"])
        escribirEstado(c.path, ["estado": "grabando"])
        return c
    }

    static func leerJSON(_ url: URL) -> [String: Any] {
        guard let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return j
    }

    static func escribirJSON(_ url: URL, _ datos: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: datos, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: url, options: .atomic) }
    }

    static func actualizarMeta(_ c: URL, _ cambios: [String: Any]) {
        let url = c.appendingPathComponent("meta.json")
        var m = leerJSON(url)
        m.merge(cambios) { _, nuevo in nuevo }
        escribirJSON(url, m)
    }

    static func escribirEstado(_ carpeta: String, _ datos: [String: Any]) {
        escribirJSON(URL(fileURLWithPath: carpeta).appendingPathComponent("estado.json"), datos)
    }

    /// Si la app se cerró en medio de una grabación o de un procesamiento, lo deja como error recuperable.
    static func repararCortadas() {
        for t in listar() {
            let e = (t["estado"] as? [String: Any])?["estado"] as? String
            if e == "grabando" || e == "procesando" {
                escribirEstado(t["ruta"] as! String, ["estado": "error", "error": Idioma.t("Se interrumpió. Puedes volver a procesarla.")])
            }
        }
    }

    static func listar() -> [[String: Any]] {
        let fm = FileManager.default
        let carpetas = (try? fm.contentsOfDirectory(at: Rutas.base, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        var lista: [[String: Any]] = []
        for c in carpetas where !c.lastPathComponent.hasPrefix(".") {
            let meta = leerJSON(c.appendingPathComponent("meta.json"))
            guard !meta.isEmpty else { continue }
            let video = c.appendingPathComponent("video.mp4")
            let md = try? String(contentsOf: c.appendingPathComponent("grabacion.md"), encoding: .utf8)
            let srt = c.appendingPathComponent("subtitulos.srt")
            lista.append(["ruta": c.path, "nombre": c.lastPathComponent, "meta": meta,
                          "estado": leerJSON(c.appendingPathComponent("estado.json")),
                          "video": fm.fileExists(atPath: video.path) ? video.absoluteString : NSNull(),
                          "md": md ?? NSNull(),
                          "srt": fm.fileExists(atPath: srt.path) ? srt.path : NSNull(),
                          "audio": fm.fileExists(atPath: c.appendingPathComponent("audio.wav").path),
                          "youtube": leerJSON(c.appendingPathComponent("youtube.json"))])
        }
        return lista.sorted { (($0["meta"] as? [String: Any])?["inicio"] as? String ?? "") > (($1["meta"] as? [String: Any])?["inicio"] as? String ?? "") }
    }
}

// MARK: - Barra de menú

@MainActor
final class BarraMenu: NSObject, NSMenuDelegate {
    static let shared = BarraMenu()
    private var item: NSStatusItem?

    func instalar() {
        let i = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        i.menu = menu
        item = i
        actualizar()
    }

    func actualizar() {
        guard let boton = item?.button else { return }
        let grabando = Estado.fase == .grabando
        let img = NSImage(systemSymbolName: grabando ? "record.circle.fill" : "record.circle", accessibilityDescription: "Graba")
        img?.isTemplate = !grabando
        boton.image = grabando ? img?.withSymbolConfiguration(.init(paletteColors: [.systemRed])) : img
        boton.title = grabando ? " " + reloj(Estado.segundos) : ""
        boton.imagePosition = .imageLeading
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        func agregar(_ titulo: String, _ accion: Selector, tecla: String = "", marca: Bool? = nil) {
            let m = NSMenuItem(title: Idioma.t(titulo), action: accion, keyEquivalent: tecla)
            m.target = self
            if let marca { m.state = marca ? .on : .off }
            menu.addItem(m)
        }
        switch Estado.fase {
        case .grabando, .cuenta:
            agregar("Terminar grabación", #selector(terminar))
            agregar("Descartar grabación", #selector(descartar))
        case .terminando, .preparando:
            menu.addItem(NSMenuItem(title: Idioma.t(Estado.fase == .preparando ? "Preparando la grabación…" : "Guardando…"), action: nil, keyEquivalent: ""))
        case .inactiva:
            agregar("Grabar pantalla", #selector(grabar), tecla: "r")
            agregar("Cámara", #selector(alternarCamara), marca: Config.bool("camara"))
            agregar("Micrófono", #selector(alternarMicrofono), marca: Config.bool("microfono"))
        }
        menu.addItem(.separator())
        if Actualizaciones.disponible["hay"] as? Bool == true { agregar("Hay una versión nueva: actualizar…", #selector(abrir)) }
        agregar("Abrir Graba", #selector(abrir), tecla: "o")
        agregar("Abrir la carpeta de grabaciones", #selector(carpeta))
        menu.addItem(.separator())
        agregar("Salir de Graba", #selector(salir), tecla: "q")
    }

    @objc func grabar() { Estado.grabar() }
    @objc func terminar() { Estado.detener() }
    @objc func descartar() { Estado.cancelar() }
    @objc func alternarCamara() { Config.guardar(["camara": !Config.bool("camara")]); Ventana.shared.enviarEstado() }
    @objc func alternarMicrofono() { Config.guardar(["microfono": !Config.bool("microfono")]); Ventana.shared.enviarEstado() }
    @objc func abrir() { Ventana.shared.mostrar() }
    @objc func carpeta() { NSWorkspace.shared.open(Rutas.base) }
    @objc func salir() {
        if Estado.fase == .grabando { Estado.detener() }
        NSApp.terminate(nil)
    }
}
