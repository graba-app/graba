import AVFoundation
import AppKit
import SwiftUI

/// La barra de grabación: una sola pieza abajo al centro, como la de captura de macOS.
/// Preparar: qué grabar · cámara · micrófono · guion · Grabar. Grabando: tiempo · Terminar · descartar.
/// Nada empieza solo: solo graba al tocar Grabar. No sale en el video.
@MainActor
final class EstadoBarra: ObservableObject {
    enum Fase { case preparando, cuenta, grabando }
    @Published var fase = Fase.preparando
    @Published var cuenta = 0
    @Published var segundos = 0
}

@MainActor
final class Barra {
    static let shared = Barra()
    let estado = EstadoBarra()
    let p = Preparacion()
    private var panel: PanelFlotante?
    private var anfitrion: NSView?
    private var acciones: (grabar: () -> Void, terminar: () -> Void, cancelar: () -> Void)?

    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }

    func mostrar(grabar: @escaping (Preparacion) -> Void, terminar: @escaping () -> Void, cancelar: @escaping () -> Void) {
        p.pantalla = Grabadora.pantallaActiva()
        p.area = nil
        p.ventanaElegida = nil
        if p.modo != "pantalla" { p.modo = "pantalla" }  // ventana y área se eligen cada vez
        p.teleprompter = Config.bool("teleprompter")  // puede venir activado desde "Preparar un guion"
        estado.fase = .preparando
        estado.cuenta = 0
        estado.segundos = 0
        acciones = (grabar: { [weak self] in guard let self else { return }; grabar(self.p) }, terminar: terminar, cancelar: cancelar)
        let vista = VistaBarra(p: p, e: estado,
                               grabar: { [weak self] in self?.acciones?.grabar() },
                               terminar: { [weak self] in self?.acciones?.terminar() },
                               cancelar: { [weak self] in self?.acciones?.cancelar() },
                               elegirArea: { [weak self] in self?.elegirArea() })
        let host = HostPrimerClic(rootView: vista)
        let panel = PanelFlotante(tamano: host.fittingSize)
        panel.puedeSerClave = true
        panel.contentView = host
        noGrabar(panel)
        self.panel = panel
        anfitrion = host
        ajustar()
        panel.orderFrontRegardless()
        p.aplicar()
        Task { await p.cargarVentanas() }
    }

    /// La barra cambia de ancho según la fase: se re-centra abajo en la pantalla elegida.
    func ajustar() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let panel = self.panel, let host = self.anfitrion else { return }
            let tam = host.fittingSize
            let f = self.p.pantalla.visibleFrame
            panel.setFrame(NSRect(x: f.midX - tam.width / 2, y: f.minY + 22, width: tam.width, height: tam.height), display: true)
        }
    }

    func elegirArea() {
        panel?.orderOut(nil)
        Burbuja.shared.ocultar()
        Teleprompter.shared.ocultar()
        MarcoArea.shared.ocultar()
        SelectorArea.shared.elegir(en: p.pantalla) { [weak self] r in
            guard let self else { return }
            if let r {
                self.p.area = r
                self.p.modo = "area"
                MarcoArea.shared.mostrar(r)
            } else if self.p.area == nil {
                self.p.modo = "pantalla"
            }
            self.panel?.orderFrontRegardless()
            self.p.aplicar()
            self.ajustar()
        }
    }

    /// Trae la barra adelante (cuando se vuelve a ella desde la ventana).
    func alFrente() { panel?.orderFrontRegardless() }

    func cuenta(_ n: Int) {
        estado.fase = .cuenta
        estado.cuenta = n
        Cuenta.shared.mostrar(n, en: p.pantalla)
        ajustar()
    }

    func grabando() {
        Cuenta.shared.ocultar()
        estado.fase = .grabando
        ajustar()
    }

    func ocultar() {
        Cuenta.shared.ocultar()
        p.guardar()
        panel?.orderOut(nil)
        panel = nil
        anfitrion = nil
    }
}

private struct VistaBarra: View {
    @ObservedObject var p: Preparacion
    @ObservedObject var e: EstadoBarra
    let grabar: () -> Void
    let terminar: () -> Void
    let cancelar: () -> Void
    let elegirArea: () -> Void

    private let rojo = Color(red: 0.84, green: 0.21, blue: 0.23)  // #d6363b, el mismo de la ventana (texto blanco legible)

    var body: some View {
        HStack(spacing: 4) {
            switch e.fase {
            case .preparando: preparando
            case .cuenta:
                Text(Idioma.f("Empieza en {n}…", e.cuenta)).font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.85))
                    .padding(.horizontal, 12)
                botonCerrar
            case .grabando:
                Circle().fill(rojo).frame(width: 9, height: 9).padding(.leading, 10)
                Text(reloj(e.segundos)).font(.system(size: 13, weight: .medium).monospacedDigit()).foregroundStyle(.white)
                    .frame(minWidth: 46, alignment: .leading)
                Button(action: terminar) {
                    Label(Idioma.t("Terminar"), systemImage: "stop.fill").font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 14).frame(height: 32)
                        .background(Capsule().fill(rojo)).foregroundStyle(.white)
                }.buttonStyle(.plain).help(Idioma.t("Terminar y guardar"))
                botonCerrar
            }
        }
        .padding(6)
        .fixedSize()
        .background(Capsule().fill(Color(white: 0.11).opacity(0.96)))
        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))
        .environment(\.colorScheme, .dark)
    }

    @ViewBuilder private var preparando: some View {
        // Volver a las grabaciones (cierra la barra sin grabar)
        icono("rectangle.stack", "Mis grabaciones", activo: false) { Estado.cancelar(); Ventana.shared.mostrar() }
        separador
        // Qué grabar
        icono("display", "Toda la pantalla", activo: p.modo == "pantalla") { p.modo = "pantalla"; p.area = nil; MarcoArea.shared.ocultar(); p.guardar(); Barra.shared.ajustar() }
        Menu {
            if p.ventanas.isEmpty { Text(Idioma.t("No encontré ventanas abiertas.")) }
            ForEach(p.ventanas) { v in
                Button(v.titulo.isEmpty ? v.app : "\(v.app) — \(v.titulo.prefix(50))") {
                    p.ventanaElegida = v.id; p.modo = "ventana"; p.area = nil; MarcoArea.shared.ocultar(); p.guardar(); Barra.shared.ajustar()
                }
            }
        } label: {
            Image(systemName: "macwindow").font(.system(size: 15)).frame(width: 34, height: 32)
                .foregroundStyle(p.modo == "ventana" ? Color.white : Color.white.opacity(0.6))
                .background(RoundedRectangle(cornerRadius: 8).fill(p.modo == "ventana" ? Color.white.opacity(0.14) : .clear))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help(Idioma.t("Una ventana"))
        .simultaneousGesture(TapGesture().onEnded { Task { await p.cargarVentanas() } })
        icono("rectangle.dashed", "Un área", activo: p.modo == "area") { elegirArea() }
        if let nombre = detalle {
            Text(nombre).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                .frame(maxWidth: 150).padding(.horizontal, 6)
        }
        separador
        // Cámara (forma y tamaño en su menú), micrófono y guion
        Menu {
            Button(p.camara ? Idioma.t("Ocultar la cámara") : Idioma.t("Mostrar la cámara")) { p.camara.toggle(); p.aplicar() }
            Divider()
            let camaras = Preparacion.dispositivos(.video)
            if camaras.count > 1 {
                Picker(Idioma.t("Cámara"), selection: Binding(get: { camaras.contains { $0.id == p.camaraID } ? p.camaraID : camaras[0].id },
                                                          set: { p.camaraID = $0; p.camara = true; p.aplicar() })) {
                    ForEach(camaras, id: \.id) { Text($0.nombre).tag($0.id) }
                }.pickerStyle(.inline)
            }
            Picker(Idioma.t("Forma"), selection: Binding(get: { p.forma }, set: { p.forma = $0; p.camara = true; p.aplicar() })) {
                Label(Idioma.t("Círculo"), systemImage: "circle").tag(Burbuja.Forma.circulo)
                Label(Idioma.t("Cuadrado"), systemImage: "square").tag(Burbuja.Forma.cuadrado)
                Label(Idioma.t("Horizontal"), systemImage: "rectangle").tag(Burbuja.Forma.horizontal)
                Label(Idioma.t("Vertical"), systemImage: "rectangle.portrait").tag(Burbuja.Forma.vertical)
            }.pickerStyle(.inline)
            Picker(Idioma.t("Tamaño"), selection: Binding(get: { p.tamano }, set: { p.tamano = $0; p.camara = true; p.aplicar() })) {
                Text(Idioma.t("Chica")).tag("s"); Text(Idioma.t("Mediana")).tag("m"); Text(Idioma.t("Grande")).tag("l"); Text(Idioma.t("Muy grande")).tag("xl")
            }.pickerStyle(.inline)
        } label: {
            Image(systemName: p.camara ? "video.fill" : "video.slash").font(.system(size: 14)).frame(width: 34, height: 32)
                .foregroundStyle(p.camara ? Color.white : Color.white.opacity(0.45))
                .background(RoundedRectangle(cornerRadius: 8).fill(p.camara ? Color.white.opacity(0.14) : .clear))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help(Idioma.t("Cámara: cuál, forma y tamaño"))
        Menu {
            Button(p.microfono ? Idioma.t("Apagar el micrófono") : Idioma.t("Encender el micrófono")) { p.microfono.toggle(); p.guardar() }
            let mics = Preparacion.dispositivos(.audio)
            if !mics.isEmpty {
                Divider()
                Picker(Idioma.t("Micrófono"), selection: Binding(get: { mics.contains { $0.id == p.microfonoID } ? p.microfonoID : (AVCaptureDevice.default(for: .audio)?.uniqueID ?? mics[0].id) },
                                                             set: { p.microfonoID = $0; p.microfono = true; p.guardar() })) {
                    ForEach(mics, id: \.id) { Text($0.nombre).tag($0.id) }
                }.pickerStyle(.inline)
            }
        } label: {
            Image(systemName: p.microfono ? "mic.fill" : "mic.slash").font(.system(size: 14)).frame(width: 34, height: 32)
                .foregroundStyle(p.microfono ? Color.white : Color.white.opacity(0.45))
                .background(RoundedRectangle(cornerRadius: 8).fill(p.microfono ? Color.white.opacity(0.14) : .clear))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help(Idioma.t("Micrófono"))
        icono("text.alignleft", p.teleprompter ? "Ocultar el guion" : "Guion (teleprompter): solo tú lo ves", activo: p.teleprompter) {
            p.teleprompter.toggle(); p.aplicar()
        }
        separador
        Button(action: grabar) {
            HStack(spacing: 7) {
                Circle().fill(Color.white).frame(width: 9, height: 9)
                Text(Idioma.t("Grabar")).font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 14).frame(height: 32)
            .background(Capsule().fill(p.listo ? rojo : Color.white.opacity(0.12)))
            .foregroundStyle(p.listo ? Color.white : Color.white.opacity(0.5))
        }
        .buttonStyle(.plain).disabled(!p.listo)
        .help(p.listo ? Idioma.t("Empezar a grabar") : Idioma.t("Elige una ventana primero"))
        botonCerrar
    }

    private var detalle: String? {
        switch p.modo {
        case "ventana": return p.ventanas.first { $0.id == p.ventanaElegida }?.app ?? Idioma.t("Elige una ventana")
        case "area": return p.area.map { "\(Int($0.width)) × \(Int($0.height))" }
        default: return nil
        }
    }

    private var separador: some View { Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1, height: 20).padding(.horizontal, 4) }

    private var botonCerrar: some View {
        Button(action: cancelar) {
            Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.55)).frame(width: 30, height: 32)
        }.buttonStyle(.plain).help(e.fase == .grabando ? Idioma.t("Descartar la grabación") : Idioma.t("Cerrar"))
    }

    private func icono(_ simbolo: String, _ ayuda: String, activo: Bool, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            Image(systemName: simbolo).font(.system(size: 15)).frame(width: 34, height: 32)
                .foregroundStyle(activo ? Color.white : Color.white.opacity(0.45))
                .background(RoundedRectangle(cornerRadius: 8).fill(activo ? Color.white.opacity(0.14) : .clear))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).help(Idioma.t(ayuda))
    }
}

// MARK: - Cuenta regresiva grande en el centro (no sale en el video)

@MainActor
final class Cuenta {
    static let shared = Cuenta()
    private var panel: PanelFlotante?
    private let estado = EstadoBarra()

    func mostrar(_ n: Int, en pantalla: NSScreen) {
        estado.cuenta = n
        guard panel == nil else { return }
        let p = PanelFlotante(tamano: NSSize(width: 150, height: 150))
        p.ignoresMouseEvents = true
        p.hasShadow = false
        p.contentView = NSHostingView(rootView: VistaCuenta(e: estado))
        noGrabar(p)
        let f = pantalla.frame
        p.setFrameOrigin(NSPoint(x: f.midX - 75, y: f.midY - 75))
        p.orderFrontRegardless()
        panel = p
    }

    func ocultar() {
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct VistaCuenta: View {
    @ObservedObject var e: EstadoBarra
    var body: some View {
        Text("\(e.cuenta)").font(.system(size: 72, weight: .semibold, design: .rounded).monospacedDigit()).foregroundStyle(.white)
            .frame(width: 150, height: 150).background(Circle().fill(Color.black.opacity(0.55)))
            .contentTransition(.numericText())
            .animation(.easeOut(duration: 0.25), value: e.cuenta)
    }
}
