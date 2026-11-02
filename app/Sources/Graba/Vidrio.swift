import AppKit
import PiezaHost
import WebKit

/// La ventana principal de Graba sobre la de la pieza «host-mac» (`Puente.shared`: la crea, la carga con ui/ y atiende el
/// puente). Aquí queda lo propio de una app de barra de menú:
///  · Graba vive en la barra de menú (sin ícono en el Dock): la ventana aparece en el Dock solo mientras está abierta.
///  · Al abrir, la ventana sale solo si falta algo (la bienvenida); si no, Graba queda en la barra de menú.
///  · Vidrio: el fondo translúcido de macOS detrás de la interfaz, sin barra de título, y una franja arriba para moverla.
///  · El estado completo (grabaciones, fase, permisos…) y el refresco del avance mientras se procesa.
/// Pendiente para Pieza (ver el PR): que el host traiga esto como opciones (`barraDeMenu`, `abrirAlArrancar`, `vidrio`).
@MainActor
final class Ventana {
    static let shared = Ventana()
    /// Lo que se manda una vez con el próximo estado: la grabación a seleccionar o un aviso.
    var pendiente: [String: Any] = [:]
    private var refresco: Timer?
    private var ultimaFirma = ""
    private var conVidrio: NSWindow?

    private var p: Puente { Puente.shared }

    /// Antes de crear la ventana: la interfaz sabe que va con vidrio y los videos se reproducen sin tocar nada.
    func preparar(_ p: Puente) {
        p.alConfigurarWeb = { conf in
            conf.mediaTypesRequiringUserActionForPlayback = []
            conf.userContentController.addUserScript(WKUserScript(source: "window.GRABA_VIDRIO = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    /// El host abre la ventana al arrancar; si no falta nada, se esconde en seguida y Graba queda en la barra de menú.
    func alArrancar(abrir: Bool) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                let v = Ventana.shared
                if abrir { v.mostrar() } else { v.ajustar(); v.ocultar() }
            }
        }
    }

    func mostrar(seleccionar ruta: String? = nil, aviso: String? = nil) {
        if let ruta { pendiente["seleccionar"] = ruta }
        if let aviso { pendiente["aviso"] = aviso }
        NSApp.setActivationPolicy(.regular)
        p.mostrar()
        ajustar()
        if p.lista { enviarEstado() }
        iniciarRefresco()
    }

    func ocultar() {
        p.ventana?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
    }

    func llamar(_ funcion: String, _ datos: Any) { p.llamar(funcion, datos) }
    func enviarEstado() { p.enviarEstado() }

    /// Lo de Graba sobre el estado del host (versión, idioma, plataforma, config, actualización).
    func estado(_ base: [String: Any]) -> [String: Any] {
        var e = base
        e["fase"] = Estado.fase.rawValue
        e["grabandoDesde"] = Estado.desde.map { Int($0.timeIntervalSince1970 * 1000) } ?? 0
        e["pausada"] = Estado.pausada
        e["segundos"] = Estado.segundos
        e["atajos"] = ["grabar": Atajos.grabar, "pausar": Atajos.pausar]
        e["grabaciones"] = Grabaciones.listar()
        e["config"] = Config.conDefectos
        e["ias"] = IA.paraJS
        e["modelos"] = Modelos.paraJS
        e["permisos"] = Permisos.paraJS
        e["carpeta"] = Rutas.base.path
        e["procesando"] = Procesamiento.enCurso ?? NSNull()
        e["youtube"] = ["conectado": YouTube.conectado, "disponible": YouTube.disponible, "canal": Config.texto("youtube_canal")]
        e.merge(pendiente) { _, nuevo in nuevo }
        pendiente = [:]
        return e
    }

    /// Vidrio como la barra de grabación: el fondo translúcido lo pone macOS y la interfaz dibuja encima sin fondo propio. La web
    /// tapa la barra de título: la franja de arriba es la que mueve la ventana. Cerrarla la esconde y Graba vuelve a la barra de menú.
    private func ajustar() {
        guard let v = p.ventana, let w = p.web, conVidrio !== v else { return }
        conVidrio = v
        v.styleMask.insert(.fullSizeContentView)
        v.titlebarAppearsTransparent = true
        v.titleVisibility = .hidden
        v.isOpaque = false
        v.backgroundColor = .clear
        w.setValue(false, forKey: "drawsBackground")
        let fondo = NSVisualEffectView(frame: v.contentView?.bounds ?? w.frame)
        fondo.material = .hudWindow
        fondo.blendingMode = .behindWindow
        fondo.state = .active
        v.contentView = fondo
        w.frame = fondo.bounds
        w.autoresizingMask = [.width, .height]
        fondo.addSubview(w)
        let franja = FranjaArrastre(frame: NSRect(x: 0, y: fondo.bounds.height - 38, width: fondo.bounds.width, height: 38))
        franja.autoresizingMask = [.width, .minYMargin]
        fondo.addSubview(franja)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: v, queue: .main) { _ in
            MainActor.assumeIsolated { NSApp.setActivationPolicy(.accessory) }
        }
    }

    /// Mientras se procesa una grabación, la interfaz se actualiza sola cada segundo (avance por pasos), pero solo si el avance
    /// cambió: releer todas las grabaciones (con sus notas) y mandarlas cada segundo sobra.
    private func iniciarRefresco() {
        guard refresco == nil else { return }
        refresco = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                let v = Ventana.shared
                // Sin nada en curso se olvida la firma: lo próximo que empiece se manda en el primer segundo.
                guard Procesamiento.enCurso != nil || !YouTube.subiendo.isEmpty else { v.ultimaFirma = ""; return }
                guard Puente.shared.ventana?.isVisible == true else { return }
                let firma = Ventana.firmaAvance([Procesamiento.enCurso].compactMap { $0 } + YouTube.subiendo.sorted())
                guard firma != v.ultimaFirma else { return }
                v.ultimaFirma = firma
                v.enviarEstado()
            }
        }
    }

    /// Lo mismo que firmaAvance en escritorio/src/avance.js: estado.json y youtube.json de las carpetas activas, tal cual.
    static func firmaAvance(_ carpetas: [String]) -> String {
        var vistas = Set<String>()
        return carpetas.filter { vistas.insert($0).inserted }.map { c in
            let u = URL(fileURLWithPath: c)
            let leer = { (n: String) in (try? String(contentsOf: u.appendingPathComponent(n), encoding: .utf8)) ?? "" }
            return [c, leer("estado.json"), leer("youtube.json")].joined(separator: "\u{1}")
        }.joined(separator: "\u{2}")
    }
}

/// Franja invisible arriba de la ventana: arrastrar la mueve y el doble clic la agranda, como una barra de título normal.
/// (WKWebView no entiende `-webkit-app-region`, así que sin esto la ventana no se podía mover.)
final class FranjaArrastre: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with e: NSEvent) {
        if e.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: e) }
    }
}
