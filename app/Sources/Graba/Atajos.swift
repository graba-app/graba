import AppKit
import Carbon.HIToolbox

/// Atajos de teclado globales (funcionan aunque Graba no esté adelante):
///   ⌃⌥⌘R  empezar a grabar (con lo último elegido en la barra) o terminar
///   ⌃⌥⌘P  pausar o reanudar
/// Se usa RegisterEventHotKey de Carbon: no necesita el permiso de Accesibilidad (NSEvent.addGlobalMonitorForEvents sí).
@MainActor
enum Atajos {
    static let grabar = "⌃⌥⌘R"
    static let pausar = "⌃⌥⌘P"
    private static var registrados: [EventHotKeyRef?] = []

    static func instalar() {
        var tipo = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, evento, _ in
            var id = EventHotKeyID()
            GetEventParameter(evento, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &id)
            let n = id.id
            DispatchQueue.main.async { MainActor.assumeIsolated { Atajos.pulsado(n) } }
            return noErr
        }, 1, &tipo, nil, nil)
        registrar(tecla: kVK_ANSI_R, id: 1)
        registrar(tecla: kVK_ANSI_P, id: 2)
    }

    private static func registrar(tecla: Int, id: UInt32) {
        var ref: EventHotKeyRef?
        let firma = EventHotKeyID(signature: OSType(0x4752_4241), id: id)  // "GRBA"
        RegisterEventHotKey(UInt32(tecla), UInt32(cmdKey | optionKey | controlKey), firma, GetApplicationEventTarget(), 0, &ref)
        registrados.append(ref)
    }

    private static func pulsado(_ id: UInt32) {
        switch id {
        case 1: Estado.atajoGrabar()
        case 2: Estado.alternarPausa()
        default: break
        }
    }
}
