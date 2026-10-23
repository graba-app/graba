import AVFoundation
import AppKit
import SwiftUI

/// Panel flotante que no le quita el foco a la app en la que la persona está trabajando.
class PanelFlotante: NSPanel {
    init(tamano: NSSize) {
        super.init(contentRect: NSRect(origin: .zero, size: tamano), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        level = .floating
        isFloatingPanel = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    }
    override var canBecomeKey: Bool { false }
}

/// Vista que acepta el primer clic aunque Graba no sea la app activa.
final class HostPrimerClic<V: View>: NSHostingView<V> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - Burbuja de la cámara (sale en el video porque es una ventana más de la pantalla)

@MainActor
final class Burbuja {
    static let shared = Burbuja()
    private var panel: PanelFlotante?
    private var sesion: AVCaptureSession?

    func mostrar(en pantalla: NSScreen) {
        guard panel == nil, let camara = AVCaptureDevice.default(for: .video), let entrada = try? AVCaptureDeviceInput(device: camara) else { return }
        let s = AVCaptureSession()
        s.sessionPreset = .high
        guard s.canAddInput(entrada) else { return }
        s.addInput(entrada)
        let lado: CGFloat = 190
        let p = PanelFlotante(tamano: NSSize(width: lado, height: lado))
        let vista = NSView(frame: NSRect(x: 0, y: 0, width: lado, height: lado))
        vista.wantsLayer = true
        vista.layer?.cornerRadius = lado / 2
        vista.layer?.masksToBounds = true
        vista.layer?.borderWidth = 3
        vista.layer?.borderColor = NSColor.white.withAlphaComponent(0.9).cgColor
        let capa = AVCaptureVideoPreviewLayer(session: s)
        capa.videoGravity = .resizeAspectFill
        capa.frame = vista.bounds
        if let c = capa.connection, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = true }
        vista.layer?.addSublayer(capa)
        p.contentView = vista
        let f = pantalla.visibleFrame
        p.setFrameOrigin(NSPoint(x: f.minX + 28, y: f.minY + 28))
        p.orderFrontRegardless()
        panel = p
        sesion = s
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    }

    func ocultar() {
        let s = sesion
        DispatchQueue.global(qos: .userInitiated).async { s?.stopRunning() }
        panel?.orderOut(nil)
        panel = nil
        sesion = nil
    }
}

// MARK: - Controles mientras se graba (no salen en el video)

@MainActor
final class EstadoControles: ObservableObject {
    @Published var cuenta = 0       // 3, 2, 1 antes de empezar; 0 = grabando
    @Published var segundos = 0
}

@MainActor
final class Controles {
    static let shared = Controles()
    let estado = EstadoControles()
    private var panel: PanelFlotante?

    /// Número de ventana, para dejarla fuera de la grabación.
    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }

    func mostrar(en pantalla: NSScreen, detener: @escaping () -> Void, cancelar: @escaping () -> Void) {
        let p = PanelFlotante(tamano: NSSize(width: 250, height: 52))
        p.contentView = HostPrimerClic(rootView: VistaControles(estado: estado, detener: detener, cancelar: cancelar))
        let f = pantalla.visibleFrame
        p.setFrameOrigin(NSPoint(x: f.midX - 125, y: f.minY + 24))
        p.orderFrontRegardless()
        panel = p
    }

    func ocultar() {
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct VistaControles: View {
    @ObservedObject var estado: EstadoControles
    let detener: () -> Void
    let cancelar: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if estado.cuenta > 0 {
                Text(Idioma.f("Grabando en {n}…", estado.cuenta)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
            } else {
                Circle().fill(Color.red).frame(width: 10, height: 10)
                Text(reloj(estado.segundos)).font(.system(size: 14, weight: .semibold).monospacedDigit()).foregroundStyle(.white)
                Spacer(minLength: 4)
                Button(action: detener) {
                    Label(Idioma.t("Terminar"), systemImage: "stop.fill").font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Capsule().fill(Color.red)).foregroundStyle(.white)
                }.buttonStyle(.plain).keyboardShortcut(.defaultAction)
            }
            Button(action: cancelar) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.8))
                    .frame(width: 26, height: 26).background(Circle().fill(Color.white.opacity(0.12)))
            }.buttonStyle(.plain).help(Idioma.t("Descartar la grabación"))
        }
        .padding(.horizontal, 14)
        .frame(width: 250, height: 52)
        .background(Capsule().fill(Color(red: 0.09, green: 0.09, blue: 0.11).opacity(0.94)))
    }
}

func reloj(_ s: Int) -> String {
    s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
}
