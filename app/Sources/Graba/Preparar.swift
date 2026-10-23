import AVFoundation
import AppKit
import ScreenCaptureKit
import SwiftUI

/// Panel antes de grabar: qué grabar (pantalla, ventana o área), la cámara (forma y tamaño), micrófono y teleprompter.
/// Todo lo que se ve aquí se ajusta en vivo (la burbuja cambia mientras eliges) y nada de esto sale en el video.
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
                        "microfono": microfono, "teleprompter": teleprompter])
    }

    /// Aplica en vivo la cámara y el teleprompter según lo elegido.
    func aplicar() {
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

@MainActor
final class Preparar {
    static let shared = Preparar()
    let p = Preparacion()
    private var panel: PanelFlotante?

    var ventana: CGWindowID? { panel.map { CGWindowID($0.windowNumber) } }

    func mostrar(empezar: @escaping (Preparacion) -> Void, cancelar: @escaping () -> Void) {
        p.pantalla = Grabadora.pantallaActiva()
        p.area = nil
        p.ventanaElegida = nil
        if p.modo == "area" { p.modo = "pantalla" }  // el área se dibuja cada vez
        let vista = VistaPreparar(p: p,
                                  empezar: { [weak self] in self?.cerrar(); empezar(self!.p) },
                                  cancelar: { [weak self] in self?.cerrar(); Burbuja.shared.ocultar(); Teleprompter.shared.ocultar(); MarcoArea.shared.ocultar(); cancelar() },
                                  elegirArea: { [weak self] in self?.elegirArea() })
        let panel = PanelFlotante(tamano: NSSize(width: 380, height: 520))
        panel.puedeSerClave = true
        panel.contentView = HostPrimerClic(rootView: vista)
        noGrabar(panel)
        let f = p.pantalla.visibleFrame
        panel.setFrameOrigin(NSPoint(x: f.maxX - 404, y: f.maxY - 544))
        panel.orderFrontRegardless()
        panel.makeKey()
        self.panel = panel
        p.aplicar()
        Task { await p.cargarVentanas() }
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
        }
    }

    private func cerrar() {
        p.guardar()
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct VistaPreparar: View {
    @ObservedObject var p: Preparacion
    let empezar: () -> Void
    let cancelar: () -> Void
    let elegirArea: () -> Void

    private let acento = Color(red: 0.43, green: 0.36, blue: 0.99)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(Idioma.t("¿Qué quieres grabar?")).font(.system(size: 17, weight: .bold))
            HStack(spacing: 6) {
                opcionModo("pantalla", "display", "Pantalla")
                opcionModo("ventana", "macwindow", "Ventana")
                opcionModo("area", "rectangle.dashed", "Área")
            }
            Group {
                if p.modo == "ventana" {
                    ScrollView {
                        VStack(spacing: 2) {
                            ForEach(p.ventanas) { v in
                                Button { p.ventanaElegida = v.id } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(v.app).font(.system(size: 13, weight: .semibold))
                                            if !v.titulo.isEmpty { Text(v.titulo).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1) }
                                        }
                                        Spacer()
                                        if p.ventanaElegida == v.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(acento) }
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(RoundedRectangle(cornerRadius: 8).fill(p.ventanaElegida == v.id ? acento.opacity(0.18) : Color.white.opacity(0.04)))
                                    .contentShape(Rectangle())
                                }.buttonStyle(.plain)
                            }
                            if p.ventanas.isEmpty { Text(Idioma.t("No encontré ventanas abiertas.")).foregroundStyle(.secondary).padding(8) }
                        }
                    }.frame(height: 150)
                } else if p.modo == "area" {
                    HStack {
                        Text(p.area.map { "\(Int($0.width)) × \(Int($0.height))" } ?? "").font(.system(size: 13, weight: .semibold).monospacedDigit())
                        Spacer()
                        Button(Idioma.t("Elegir otra área"), action: elegirArea)
                    }
                } else {
                    Text(Idioma.t("Se graba la pantalla donde está el mouse.")).font(.system(size: 12.5)).foregroundStyle(.secondary)
                }
            }

            Divider().opacity(0.4)
            Toggle(isOn: $p.camara) { Label(Idioma.t("Cámara"), systemImage: "video.fill") }.onChange(of: p.camara) { p.aplicar() }
            if p.camara {
                HStack(spacing: 6) {
                    opcionForma(.circulo, "circle", "Círculo")
                    opcionForma(.cuadrado, "square", "Cuadrado")
                    opcionForma(.horizontal, "rectangle", "Horizontal")
                    opcionForma(.vertical, "rectangle.portrait", "Vertical")
                }
                Picker(Idioma.t("Tamaño"), selection: $p.tamano) {
                    Text(Idioma.t("Chica")).tag("s"); Text(Idioma.t("Mediana")).tag("m"); Text(Idioma.t("Grande")).tag("l"); Text(Idioma.t("Muy grande")).tag("xl")
                }.pickerStyle(.segmented).onChange(of: p.tamano) { p.aplicar() }
                Text(Idioma.t("Arrástrala para moverla y estírala desde el borde.")).font(.system(size: 11.5)).foregroundStyle(.secondary)
            }
            Toggle(isOn: $p.microfono) { Label(Idioma.t("Micrófono"), systemImage: "mic.fill") }.onChange(of: p.microfono) { p.guardar() }
            Toggle(isOn: $p.teleprompter) { Label(Idioma.t("Teleprompter"), systemImage: "text.alignleft") }.onChange(of: p.teleprompter) { p.aplicar() }
            if p.teleprompter { Text(Idioma.t("Solo tú lo ves: no sale en el video.")).font(.system(size: 11.5)).foregroundStyle(.secondary) }

            Spacer(minLength: 0)
            HStack {
                Button(Idioma.t("Cancelar"), action: cancelar).keyboardShortcut(.cancelAction)
                Spacer()
                Button(action: empezar) {
                    Label(Idioma.t("Empezar a grabar"), systemImage: "record.circle").font(.system(size: 13.5, weight: .semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill(p.listo ? Color.red : Color.gray.opacity(0.4))).foregroundStyle(.white)
                }.buttonStyle(.plain).disabled(!p.listo).keyboardShortcut(.defaultAction)
            }
        }
        .toggleStyle(.switch)
        .padding(18)
        .frame(width: 380, height: 520, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(red: 0.09, green: 0.09, blue: 0.11).opacity(0.97)))
        .environment(\.colorScheme, .dark)
    }

    private func opcionModo(_ id: String, _ icono: String, _ nombre: String) -> some View {
        Button {
            if id == "area" { elegirArea() } else {
                p.modo = id
                if id == "ventana" { Task { await p.cargarVentanas() } }
                MarcoArea.shared.ocultar()
                p.area = nil
                p.guardar()
            }
        } label: {
            VStack(spacing: 5) { Image(systemName: icono).font(.system(size: 18)); Text(Idioma.t(nombre)).font(.system(size: 12, weight: .semibold)) }
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 10).fill(p.modo == id ? acento.opacity(0.22) : Color.white.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(p.modo == id ? acento : Color.clear, lineWidth: 1.5))
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func opcionForma(_ f: Burbuja.Forma, _ icono: String, _ nombre: String) -> some View {
        Button { p.forma = f; p.aplicar() } label: {
            Image(systemName: icono).font(.system(size: 15))
                .frame(maxWidth: .infinity).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(p.forma == f ? acento.opacity(0.22) : Color.white.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(p.forma == f ? acento : Color.clear, lineWidth: 1.5))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).help(Idioma.t(nombre))
    }
}
