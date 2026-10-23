import AVFoundation
import AppKit
import ScreenCaptureKit
import SwiftUI

/// Lo que se elige antes de grabar (en la barra): qué grabar (pantalla, ventana o área), la cámara, el micrófono y el guion.
/// Se aplica en vivo: la burbuja cambia mientras eliges.
struct VentanaApp: Identifiable, Hashable {
    let id: CGWindowID
    let app: String
    let titulo: String
    let pid: pid_t
}

@MainActor
final class Preparacion: ObservableObject {
    @Published var modo = Config.texto("modo").isEmpty ? "pantalla" : Config.texto("modo")
    @Published var ventanas: [VentanaApp] = []
    @Published var ventanaElegida: CGWindowID?
    @Published var area: CGRect?
    @Published var camara = Config.bool("camara")
    @Published var forma = Burbuja.Forma(rawValue: Config.texto("camara_forma")) ?? .circulo
    @Published var tamano = Config.texto("camara_tamano").isEmpty ? "m" : Config.texto("camara_tamano")
    @Published var microfono = Config.bool("microfono")
    @Published var camaraID = Config.texto("camara_id")
    @Published var microfonoID = Config.texto("microfono_id")

    /// Cámaras y micrófonos conectados (incluye externas y el iPhone como cámara).
    static func dispositivos(_ medio: AVMediaType) -> [(id: String, nombre: String)] {
        let tipos: [AVCaptureDevice.DeviceType] = medio == .video ? [.builtInWideAngleCamera, .external, .continuityCamera, .deskViewCamera]
            : [.microphone, .external]
        return AVCaptureDevice.DiscoverySession(deviceTypes: tipos, mediaType: medio, position: .unspecified).devices
            .map { ($0.uniqueID, $0.localizedName) }
    }
    @Published var teleprompter = Config.bool("teleprompter")
    var pantalla: NSScreen = Grabadora.pantallaActiva()

    var listo: Bool {
        switch modo {
        case "ventana": return ventanaElegida != nil
        case "area": return area != nil
        default: return true
        }
    }

    func cargarVentanas() async {
        let propia = Bundle.main.bundleIdentifier
        guard let c = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return }
        ventanas = c.windows.compactMap { w in
            guard w.windowLayer == 0, w.frame.width >= 160, w.frame.height >= 100, let app = w.owningApplication,
                  app.bundleIdentifier != propia, !app.applicationName.isEmpty else { return nil }
            return VentanaApp(id: w.windowID, app: app.applicationName, titulo: w.title ?? "", pid: app.processID)
        }.sorted { ($0.app.lowercased(), $0.titulo) < ($1.app.lowercased(), $1.titulo) }
        if let e = ventanaElegida, !ventanas.contains(where: { $0.id == e }) { ventanaElegida = nil }
    }

    func guardar() {
        Config.guardar(["modo": modo, "camara": camara, "camara_forma": forma.rawValue, "camara_tamano": tamano,
                        "camara_id": camaraID, "microfono_id": microfonoID,
                        "microfono": microfono, "teleprompter": teleprompter])
    }

    /// Aplica en vivo la cámara y el teleprompter según lo elegido.
    func aplicar() {
        guardar()  // primero: la burbuja lee la cámara elegida de la configuración
        if camara {
            if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
                AVCaptureDevice.requestAccess(for: .video) { _ in Task { @MainActor in self.aplicar() } }
                return
            }
            Burbuja.shared.mostrar(en: pantalla, forma: forma, tamano: tamano, dentroDe: area)
        } else {
            Burbuja.shared.ocultar()
        }
        if teleprompter { Teleprompter.shared.mostrar(en: pantalla) } else { Teleprompter.shared.ocultar() }
        guardar()
    }
}
