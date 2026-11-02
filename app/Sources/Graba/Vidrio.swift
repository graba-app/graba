import AppKit
import PiezaHost
import WebKit

/// La ventana principal de Graba sobre la de la pieza «host-mac» (`Puente.shared`: la crea, la carga con ui/ y atiende el
/// puente). Lo de una app de barra de menú lo trae el host (`barraDeMenu`, `abrirAlArrancar`, `vidrio`, `altoFranja` en
/// `GrabaApp.main`); aquí queda lo propio de Graba:
///  · Esconder la ventana al empezar a grabar (sin Dock mientras tanto) y mostrarla con una grabación elegida o un aviso.
///  · El estado completo (grabaciones, fase, permisos…) y el refresco del avance mientras se procesa.
@MainActor
final class Ventana {
    static let shared = Ventana()
    /// Lo que se manda una vez con el próximo estado: la grabación a seleccionar o un aviso.
    var pendiente: [String: Any] = [:]
    private var refresco: Timer?
    private var ultimaFirma = ""

    private var p: Puente { Puente.shared }

    /// Antes de crear la ventana: los videos se reproducen sin tocar nada. El refresco del avance corre desde el arranque (también
    /// si la ventana se abre desde el Dock o Spotlight); solo manda algo con la ventana a la vista y un avance nuevo.
    func preparar(_ p: Puente) {
        p.alConfigurarWeb = { conf in conf.mediaTypesRequiringUserActionForPlayback = [] }
        iniciarRefresco()
    }

    func mostrar(seleccionar ruta: String? = nil, aviso: String? = nil) {
        if let ruta { pendiente["seleccionar"] = ruta }
        if let aviso { pendiente["aviso"] = aviso }
        p.mostrar()
        if p.lista { enviarEstado() }
    }

    /// Esconder sin cerrar (al empezar a grabar): el host solo vuelve a quitar el Dock al cerrar la ventana, así que aquí también.
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
