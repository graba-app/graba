import AVFoundation
import AppKit
import ScreenCaptureKit
import SwiftUI

/// Panel flotante que no le quita el foco a la app en la que la persona está trabajando.
class PanelFlotante: NSPanel {
    var puedeSerClave = false
    init(tamano: NSSize, redimensionable: Bool = false) {
        super.init(contentRect: NSRect(origin: .zero, size: tamano),
                   styleMask: redimensionable ? [.borderless, .nonactivatingPanel, .resizable] : [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        level = .floating
        isFloatingPanel = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }
    override var canBecomeKey: Bool { puedeSerClave }
}

/// Vista que acepta el primer clic aunque Graba no sea la app activa.
final class HostPrimerClic<V: View>: NSHostingView<V> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Ventanas propias que nunca deben salir en el video (controles, teleprompter, panel de preparación, marco del área).
@MainActor
func noGrabar(_ v: NSWindow) {
    v.sharingType = .none
}

// MARK: - Cámara (sale en el video porque es una ventana más de la pantalla)

@MainActor
final class Burbuja: NSObject, NSWindowDelegate {
    static let shared = Burbuja()
    enum Forma: String, CaseIterable { case circulo, cuadrado, horizontal, vertical }
    private var panel: PanelFlotante?
    private var sesion: AVCaptureSession?
    private var vista: NSView?
    private(set) var forma = Forma.circulo

    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }
    var visible: Bool { panel != nil }

    static func proporcion(_ f: Forma) -> CGFloat {
        switch f { case .circulo, .cuadrado: return 1; case .horizontal: return 16 / 9; case .vertical: return 9 / 16 }
    }
    static func ladoBase(_ tamano: String) -> CGFloat { ["s": 140, "m": 200, "l": 290, "xl": 400][tamano] ?? 200 }

    /// Muestra (o ajusta) la cámara con la forma y el tamaño elegidos. Si se da un área, la pone abajo a la izquierda dentro de ella.
    func mostrar(en pantalla: NSScreen, forma f: Forma, tamano: String, dentroDe area: CGRect? = nil) {
        forma = f
        let lado = Burbuja.ladoBase(tamano), prop = Burbuja.proporcion(f)
        let tam = prop >= 1 ? NSSize(width: lado * prop, height: lado) : NSSize(width: lado, height: lado / prop)
        if let panel {
            var marco = panel.frame
            marco.size = tam
            panel.setFrame(marco, display: true, animate: true)
            panel.contentAspectRatio = tam
            ajustarEsquinas()
            return
        }
        guard let camara = AVCaptureDevice.default(for: .video), let entrada = try? AVCaptureDeviceInput(device: camara) else { return }
        let s = AVCaptureSession()
        s.sessionPreset = .high
        guard s.canAddInput(entrada) else { return }
        s.addInput(entrada)
        let p = PanelFlotante(tamano: tam, redimensionable: true)
        p.contentAspectRatio = tam
        p.minSize = NSSize(width: 90, height: 90)
        p.delegate = self
        let v = NSView(frame: NSRect(origin: .zero, size: tam))
        v.wantsLayer = true
        v.layer?.masksToBounds = true
        v.layer?.borderWidth = 3
        v.layer?.borderColor = NSColor.white.withAlphaComponent(0.9).cgColor
        let capa = AVCaptureVideoPreviewLayer(session: s)
        capa.videoGravity = .resizeAspectFill
        capa.frame = v.bounds
        capa.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        if let c = capa.connection, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = true }
        v.layer?.addSublayer(capa)
        p.contentView = v
        let f0 = area ?? pantalla.visibleFrame
        p.setFrameOrigin(NSPoint(x: f0.minX + 24, y: f0.minY + 24))
        p.orderFrontRegardless()
        panel = p
        sesion = s
        vista = v
        ajustarEsquinas()
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    }

    private func ajustarEsquinas() {
        guard let v = vista else { return }
        let b = v.bounds
        v.layer?.cornerRadius = forma == .circulo ? min(b.width, b.height) / 2 : min(b.width, b.height) * 0.12
    }

    func windowDidResize(_ notification: Notification) { ajustarEsquinas() }

    func ocultar() {
        let s = sesion
        DispatchQueue.global(qos: .userInitiated).async { s?.stopRunning() }
        panel?.orderOut(nil)
        panel = nil
        sesion = nil
        vista = nil
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

    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }

    func mostrar(en pantalla: NSScreen, detener: @escaping () -> Void, cancelar: @escaping () -> Void) {
        let p = PanelFlotante(tamano: NSSize(width: 250, height: 52))
        p.contentView = HostPrimerClic(rootView: VistaControles(estado: estado, detener: detener, cancelar: cancelar))
        noGrabar(p)
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

// MARK: - Teleprompter (solo lo ves tú: no sale en el video)

@MainActor
final class EstadoTeleprompter: ObservableObject {
    @Published var texto = Config.texto("teleprompter_texto")
    @Published var velocidad = (Config.leer()["teleprompter_velocidad"] as? Double) ?? 30   // puntos por segundo
    @Published var letra = (Config.leer()["teleprompter_letra"] as? Double) ?? 26
    @Published var corriendo = false
    @Published var desplazamiento: CGFloat = 0
    @Published var editando = true

    func guardar() {
        Config.guardar(["teleprompter_texto": texto, "teleprompter_velocidad": velocidad, "teleprompter_letra": letra])
    }
}

@MainActor
final class Teleprompter {
    static let shared = Teleprompter()
    let estado = EstadoTeleprompter()
    private var panel: PanelFlotante?
    private var reloj: Timer?

    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }

    func mostrar(en pantalla: NSScreen) {
        estado.texto = Config.texto("teleprompter_texto")
        estado.editando = estado.texto.isEmpty
        estado.desplazamiento = 0
        guard panel == nil else { panel?.orderFrontRegardless(); return }
        let p = PanelFlotante(tamano: NSSize(width: 560, height: 230), redimensionable: true)
        p.puedeSerClave = true
        p.minSize = NSSize(width: 320, height: 140)
        p.contentView = HostPrimerClic(rootView: VistaTeleprompter(estado: estado))
        noGrabar(p)
        // Arriba al centro: cerca de la cámara, así la mirada no se nota.
        let f = pantalla.visibleFrame
        p.setFrameOrigin(NSPoint(x: f.midX - 280, y: f.maxY - 250))
        p.orderFrontRegardless()
        panel = p
    }

    /// Al empezar a grabar el texto avanza solo (se puede pausar con el botón o la barra espaciadora).
    func empezar() {
        estado.editando = false
        estado.guardar()
        estado.corriendo = true
        reloj?.invalidate()
        reloj = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { _ in
            Task { @MainActor in
                let e = Teleprompter.shared.estado
                if e.corriendo { e.desplazamiento += CGFloat(e.velocidad / 30) }
            }
        }
    }

    func ocultar() {
        estado.guardar()
        reloj?.invalidate()
        reloj = nil
        estado.corriendo = false
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct VistaTeleprompter: View {
    @ObservedObject var estado: EstadoTeleprompter

    var body: some View {
        VStack(spacing: 0) {
            if estado.editando {
                TextEditor(text: $estado.texto)
                    .font(.system(size: 15))
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .overlay(alignment: .topLeading) {
                        if estado.texto.isEmpty {
                            Text(Idioma.t("Escribe o pega aquí lo que vas a decir. Solo tú lo ves: no sale en el video."))
                                .foregroundStyle(.white.opacity(0.45)).padding(15).allowsHitTesting(false)
                        }
                    }
            } else {
                GeometryReader { geo in
                    Text(estado.texto)
                        .font(.system(size: estado.letra, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineSpacing(estado.letra * 0.35)
                        .multilineTextAlignment(.center)
                        .frame(width: geo.size.width - 40)
                        .padding(.horizontal, 20)
                        .padding(.top, geo.size.height * 0.35)
                        .offset(y: -estado.desplazamiento)
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
                        .clipped()
                }
                .overlay(alignment: .top) {
                    // Marca de lectura: la línea que toca leer.
                    Rectangle().fill(Color(red: 0.43, green: 0.36, blue: 0.99).opacity(0.5)).frame(height: 2).padding(.top, 70)
                }
            }
            HStack(spacing: 10) {
                Button { estado.editando.toggle(); if !estado.editando { estado.guardar() } } label: {
                    Image(systemName: estado.editando ? "checkmark" : "pencil")
                }.help(estado.editando ? Idioma.t("Listo") : Idioma.t("Editar el texto"))
                if !estado.editando {
                    Button { estado.corriendo.toggle() } label: { Image(systemName: estado.corriendo ? "pause.fill" : "play.fill") }
                        .keyboardShortcut(.space, modifiers: [])
                        .help(estado.corriendo ? Idioma.t("Pausar") : Idioma.t("Seguir"))
                    Button { estado.desplazamiento = 0 } label: { Image(systemName: "backward.end.fill") }.help(Idioma.t("Volver al inicio"))
                }
                Image(systemName: "tortoise.fill").foregroundStyle(.white.opacity(0.6))
                Slider(value: $estado.velocidad, in: 5...120).frame(maxWidth: 120)
                Image(systemName: "hare.fill").foregroundStyle(.white.opacity(0.6))
                Spacer(minLength: 6)
                Button { estado.letra = max(14, estado.letra - 2) } label: { Image(systemName: "textformat.size.smaller") }.help(Idioma.t("Letra más chica"))
                Button { estado.letra = min(56, estado.letra + 2) } label: { Image(systemName: "textformat.size.larger") }.help(Idioma.t("Letra más grande"))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Color.black.opacity(0.25))
        }
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(red: 0.07, green: 0.07, blue: 0.09).opacity(0.92)))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .environment(\.colorScheme, .dark)
    }
}

// MARK: - Elegir un área de la pantalla

/// Capa transparente sobre la pantalla para dibujar el área con el mouse. Esc cancela.
@MainActor
final class SelectorArea {
    static let shared = SelectorArea()
    private var ventana: NSWindow?

    func elegir(en pantalla: NSScreen, listo: @escaping (CGRect?) -> Void) {
        let v = NSWindow(contentRect: pantalla.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        v.level = .screenSaver
        v.backgroundColor = .clear
        v.isOpaque = false
        v.ignoresMouseEvents = false
        v.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let vista = VistaSelector(frame: NSRect(origin: .zero, size: pantalla.frame.size))
        vista.alTerminar = { [weak self] r in
            self?.ventana?.orderOut(nil)
            self?.ventana = nil
            NSCursor.arrow.set()
            // De coordenadas de la ventana a coordenadas globales.
            listo(r.map { $0.offsetBy(dx: pantalla.frame.minX, dy: pantalla.frame.minY) })
        }
        v.contentView = vista
        v.makeKeyAndOrderFront(nil)
        v.makeFirstResponder(vista)
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.crosshair.set()
        ventana = v
    }
}

private final class VistaSelector: NSView {
    var alTerminar: ((CGRect?) -> Void)?
    private var inicio: NSPoint?
    private var rect: NSRect?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    override func draw(_ dirty: NSRect) {
        NSColor.black.withAlphaComponent(0.35).setFill()
        bounds.fill()
        if let rect {
            NSColor.clear.setFill()
            rect.fill(using: .copy)
            NSColor(red: 0.55, green: 0.49, blue: 1, alpha: 1).setStroke()
            let borde = NSBezierPath(rect: rect)
            borde.lineWidth = 2
            borde.stroke()
            let texto = "\(Int(rect.width)) × \(Int(rect.height))" as NSString
            texto.draw(at: NSPoint(x: rect.minX + 6, y: rect.maxY + 6), withAttributes: [.foregroundColor: NSColor.white, .font: NSFont.systemFont(ofSize: 13, weight: .semibold)])
        } else {
            let t = Idioma.t("Arrastra para elegir el área que quieres grabar. Esc para cancelar.") as NSString
            let a: [NSAttributedString.Key: Any] = [.foregroundColor: NSColor.white, .font: NSFont.systemFont(ofSize: 18, weight: .semibold)]
            let s = t.size(withAttributes: a)
            t.draw(at: NSPoint(x: bounds.midX - s.width / 2, y: bounds.midY), withAttributes: a)
        }
    }

    override func mouseDown(with e: NSEvent) { inicio = convert(e.locationInWindow, from: nil); rect = nil }
    override func mouseDragged(with e: NSEvent) {
        guard let inicio else { return }
        let p = convert(e.locationInWindow, from: nil)
        rect = NSRect(x: min(inicio.x, p.x), y: min(inicio.y, p.y), width: abs(p.x - inicio.x), height: abs(p.y - inicio.y))
        needsDisplay = true
    }
    override func mouseUp(with e: NSEvent) {
        guard let r = rect, r.width >= 80, r.height >= 60 else { rect = nil; needsDisplay = true; return }
        alTerminar?(r.integral)
    }
    override func keyDown(with e: NSEvent) { if e.keyCode == 53 { alTerminar?(nil) } else { super.keyDown(with: e) } }
}

/// Marco que muestra el área elegida mientras se prepara y se graba (no sale en el video y no estorba los clics).
@MainActor
final class MarcoArea {
    static let shared = MarcoArea()
    private var ventana: NSWindow?
    var id: CGWindowID? { ventana.map { CGWindowID($0.windowNumber) } }

    func mostrar(_ r: CGRect) {
        ocultar()
        let v = NSWindow(contentRect: r.insetBy(dx: -3, dy: -3), styleMask: [.borderless], backing: .buffered, defer: false)
        v.level = .floating
        v.backgroundColor = .clear
        v.isOpaque = false
        v.ignoresMouseEvents = true
        v.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let vista = NSView()
        vista.wantsLayer = true
        vista.layer?.borderWidth = 3
        vista.layer?.borderColor = NSColor(red: 0.55, green: 0.49, blue: 1, alpha: 0.95).cgColor
        vista.layer?.cornerRadius = 4
        v.contentView = vista
        noGrabar(v)
        v.orderFrontRegardless()
        ventana = v
    }

    func ocultar() {
        ventana?.orderOut(nil)
        ventana = nil
    }
}
