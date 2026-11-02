import AVFoundation
import AppKit
import CoreGraphics
import PiezaHost

// Lo propio de Graba sobre la pieza «host-mac» (PiezaHost): la ventana, el puente, config, idioma, el Procesador con límite, el
// Llavero (Secretos) y las actualizaciones ya los trae el host. Aquí queda lo de Graba: dónde viven las grabaciones, los valores
// por defecto de su config, permisos, la lista de IA instaladas, la descarga de modelos (pendiente #4 de Pieza: modelos en el
// host), la fila de procesamiento y YouTube.

// MARK: - Rutas de Graba (la carpeta de datos es Host.datos = ~/Graba/.graba, por "datos": "visible" de app.json)

@MainActor
enum Rutas {
    /// Las grabaciones: una carpeta por grabación. Fuera de la app, así actualizar no borra nada.
    static var base: URL { Host.datos.deletingLastPathComponent() }
    static var interno: URL { Host.datos }
    static var modelos: URL { interno.appendingPathComponent("modelos") }
    /// graba-transcribir (y whisper.framework al lado): junto al ejecutable de la app.
    static var herramientas: URL { Bundle.main.executableURL!.deletingLastPathComponent() }

    /// Solo carpetas dentro de ~/Graba (igual que dentroDeBase en escritorio/src/servicios.js).
    static func dentro(_ ruta: String) -> URL? {
        guard !ruta.isEmpty, !ruta.contains("\u{0}") else { return nil }
        // Con los enlaces simbólicos resueltos: un enlace dentro de ~/Graba que apunta afuera no cuenta como de adentro.
        let u = URL(fileURLWithPath: ruta).standardizedFileURL.resolvingSymlinksInPath()
        return u.path.hasPrefix(base.standardizedFileURL.resolvingSymlinksInPath().path + "/") ? u : nil
    }

    /// El video para la interfaz: graba://video/<versión>/<ruta dentro de ~/Graba> (lo sirve el host con rangos; la versión cambia
    /// cuando cambia el video, así la ventana nunca muestra el de antes de un recorte).
    static func urlVideo(_ video: URL, version: Int) -> String? {
        let b = base.standardizedFileURL.path + "/", p = video.standardizedFileURL.path
        guard p.hasPrefix(b), let rel = String(p.dropFirst(b.count)).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return "graba://video/\(version)/\(rel)"
    }

    /// Quien ya usaba Graba con todo listo y nunca eligió idioma sigue sin que se le pregunte: queda la bienvenida como hecha
    /// (`bienvenida: true`, la clave de la pieza «bienvenida»), así el host revisa las actualizaciones y arma los menús como antes.
    static func migrar() {
        let c = Config.leer()
        guard (c["idioma_ui"] as? String ?? "").isEmpty, c["bienvenida"] == nil, !GrabaApp.faltaAlgo else { return }
        Config.deLaApp(["bienvenida": true])
    }

    /// Lo contrario, para el resolvedor de medios: solo un .mp4 dentro de ~/Graba.
    static func videoDe(_ ruta: String) -> URL? {
        let partes = ruta.split(separator: "/", maxSplits: 1).map(String.init)
        guard partes.count == 2, Int(partes[0]) != nil, !partes[1].split(separator: "/").contains(".."),
              let u = dentro(base.appendingPathComponent(partes[1]).path), u.pathExtension.lowercased() == "mp4" else { return nil }
        return u
    }
}

// MARK: - Config de Graba (la de app.json, con los valores por defecto de siempre)

extension Config {
    static let porDefecto: [String: Any] = ["ia": "", "modelo": "", "idioma_audio": "auto", "idioma_ui": "", "camara": true, "microfono": true]

    /// Lo que va a la interfaz: los valores por defecto + lo guardado (validado por app.json).
    static var conDefectos: [String: Any] { porDefecto.merging(leer()) { _, guardado in guardado } }
    static func bool(_ clave: String) -> Bool { (leer()[clave] as? Bool) ?? (porDefecto[clave] as? Bool ?? false) }
    /// Lo que escribe la app (incluye las claves "interfaz": false de app.json: modo, cámara, micrófono elegido, canal…).
    static func deLaApp(_ cambios: [String: Any]) { guardar(cambios, desdeInterfaz: false) }
}

extension Idioma {
    static func f(_ plantilla: String, _ n: Int) -> String { f(plantilla, ["n": String(n)]) }
}

// MARK: - Permisos

@MainActor
enum Permisos {
    static var paraJS: [String: Bool] {
        ["pantalla": CGPreflightScreenCaptureAccess(),
         "camara": AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
         "microfono": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized]
    }

    static func pedir(_ tipo: String, _ fin: @escaping @MainActor () -> Void) {
        switch tipo {
        case "pantalla":
            // La primera vez macOS muestra su diálogo; después solo se puede activar en Ajustes del Sistema.
            if !CGRequestScreenCaptureAccess() {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
            }
            fin()
        case "camara", "microfono":
            let medio: AVMediaType = tipo == "camara" ? .video : .audio
            if AVCaptureDevice.authorizationStatus(for: medio) == .denied {
                let ancla = tipo == "camara" ? "Privacy_Camera" : "Privacy_Microphone"
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(ancla)")!)
                fin()
            } else {
                AVCaptureDevice.requestAccess(for: medio) { _ in Task { @MainActor in fin() } }
            }
        default:
            fin()
        }
    }
}

// MARK: - IA del usuario (se detecta y se prueba, no se configura a mano)

@MainActor
enum IA {
    static let conocidas: [(id: String, nombre: String, comandos: [String])] = [
        ("claude", "Claude", ["claude"]),
        ("codex", "ChatGPT (Codex)", ["codex"]),
        ("gemini", "Gemini", ["agy", "gemini"]),
    ]

    static func dirs() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var d = ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "\(home)/.claude/local", "\(home)/.codex/bin",
                 "\(home)/.npm-global/bin", "\(home)/.volta/bin", "\(home)/.bun/bin", "/usr/bin"]
        let nvm = "\(home)/.nvm/versions/node"
        let versiones = ((try? FileManager.default.contentsOfDirectory(atPath: nvm)) ?? []).sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        d += versiones.map { "\(nvm)/\($0)/bin" }
        return d
    }

    static func buscar(_ comandos: [String]) -> String? {
        for c in comandos {
            if let r = dirs().map({ "\($0)/\(c)" }).first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return r }
        }
        return nil
    }

    static var paraJS: [[String: Any]] {
        conocidas.map { ["id": $0.id, "nombre": $0.nombre, "instalada": buscar($0.comandos) != nil] }
    }
}

// MARK: - Modelos de transcripción (whisper.cpp), descargados y verificados por huella

struct ModeloWhisper {
    let id: String, nombre: String, archivo: String, bytes: Int64, sha256: String, detalle: String
}

@MainActor
enum Modelos {
    static let lista: [ModeloWhisper] = [
        .init(id: "turbo", nombre: "Preciso", archivo: "ggml-large-v3-turbo-q5_0.bin", bytes: 574_041_195,
              sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", detalle: "El mejor resultado; recomendado con 8 GB de RAM o más."),
        .init(id: "small", nombre: "Liviano", archivo: "ggml-small-q5_1.bin", bytes: 190_085_487,
              sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", detalle: "Más rápido y pequeño; para Macs con poca memoria."),
    ]

    static func existe(_ m: ModeloWhisper) -> Bool {
        let a = (try? FileManager.default.attributesOfItem(atPath: Rutas.modelos.appendingPathComponent(m.archivo).path))?[.size] as? Int64
        return a == m.bytes
    }

    static var recomendado: String { ProcessInfo.processInfo.physicalMemory >= 8 << 30 ? "turbo" : "small" }

    static var paraJS: [String: Any] {
        ["recomendado": recomendado,
         "lista": lista.map { ["id": $0.id, "nombre": $0.nombre, "mb": Int($0.bytes / 1_000_000), "detalle": $0.detalle, "listo": existe($0)] }]
    }

    private static var descarga: Descarga?

    static func descargar(_ id: String, progreso: @escaping @MainActor (Double) -> Void, fin: @escaping @MainActor (Bool, String?) -> Void) {
        guard let m = lista.first(where: { $0.id == id }) else { fin(false, "?"); return }
        if existe(m) { fin(true, nil); return }
        try? FileManager.default.createDirectory(at: Rutas.modelos, withIntermediateDirectories: true)
        let url = URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/\(m.archivo)")!
        let d = Descarga(desde: url, sha256: m.sha256, destino: Rutas.modelos.appendingPathComponent(m.archivo),
                         progreso: { progreso(Double($0) / Double(m.bytes)) }, fin: { ok, error in descarga = nil; fin(ok, error) })
        descarga = d
        d.empezar()
    }
}

/// Descarga a un archivo temporal; solo lo deja en su lugar si la huella SHA-256 coincide.
final class Descarga: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let desde: URL, sha256: String, destino: URL
    let progreso: @MainActor (Int64) -> Void, fin: @MainActor (Bool, String?) -> Void

    init(desde: URL, sha256: String, destino: URL, progreso: @escaping @MainActor (Int64) -> Void, fin: @escaping @MainActor (Bool, String?) -> Void) {
        self.desde = desde; self.sha256 = sha256; self.destino = destino; self.progreso = progreso; self.fin = fin
    }

    func empezar() {
        URLSession(configuration: .default, delegate: self, delegateQueue: nil).downloadTask(with: desde).resume()
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten t: Int64, totalBytesExpectedToWrite _: Int64) {
        Task { @MainActor in self.progreso(t) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo ubicacion: URL) {
        let temporal = destino.appendingPathExtension("descarga")
        try? FileManager.default.removeItem(at: temporal)
        guard (try? FileManager.default.moveItem(at: ubicacion, to: temporal)) != nil else {
            Task { @MainActor in self.fin(false, Idioma.t("No pude guardar la descarga.")) }; return
        }
        let p = Process(), salida = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
        p.arguments = ["-a", "256", temporal.path]
        p.standardOutput = salida
        try? p.run(); p.waitUntilExit()
        let huella = String(data: salida.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.split(separator: " ").first.map(String.init) ?? ""
        guard huella == sha256 else {
            try? FileManager.default.removeItem(at: temporal)
            Task { @MainActor in self.fin(false, Idioma.t("La descarga llegó dañada. Intenta de nuevo.")) }; return
        }
        try? FileManager.default.removeItem(at: destino)
        let ok = (try? FileManager.default.moveItem(at: temporal, to: destino)) != nil
        Task { @MainActor in self.fin(ok, ok ? nil : Idioma.t("No pude guardar la descarga.")) }
        s.finishTasksAndInvalidate()
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        Task { @MainActor in self.fin(false, error.localizedDescription) }
        s.finishTasksAndInvalidate()
    }
}


// MARK: - Procesamiento (bin/procesar.py, de a una grabación, con el Procesador del host)

@MainActor
enum Procesamiento {
    private(set) static var enCurso: String?
    private static var cola: [(String, Bool)] = []

    static func encolar(_ carpeta: String, soloIA: Bool = false, alTerminar: @escaping @MainActor () -> Void) {
        cola.append((carpeta, soloIA))
        siguiente(alTerminar)
    }

    /// Sin tope de tiempo mientras procesar.py lata (pieza «trabajos»: `mantener_vivo()`): una grabación larga transcribe por mucho
    /// rato, pero si el proceso se cuelga (45 s sin latido) el host lo corta. Al salir de la app se corta y queda como error
    /// recuperable («Se interrumpió. Puedes volver a procesarla.»).
    private static func siguiente(_ alTerminar: @escaping @MainActor () -> Void) {
        guard enCurso == nil, !cola.isEmpty else { return }
        let (carpeta, soloIA) = cola.removeFirst()
        enCurso = carpeta
        Procesador.correr("procesar.py", [carpeta] + (soloIA ? ["--solo-ia"] : []), latido: true) { resultado in
            let r = resultado.respuesta
            if r["ok"] as? Bool != true, (Grabaciones.leerJSON(URL(fileURLWithPath: carpeta).appendingPathComponent("estado.json"))["estado"] as? String) == "procesando" {
                // El script no alcanzó a dejar su error (lo cortó el host o no arrancó): queda como error recuperable.
                Grabaciones.escribirEstado(carpeta, ["estado": "error", "error": Idioma.t("No pude terminar. Intenta de nuevo.")])
            }
            if r["ok"] as? Bool == true, !soloIA, Config.bool("youtube_auto"), let c = r["carpeta"] as? String { YouTube.subir(c) }
            enCurso = nil
            alTerminar()
            siguiente(alTerminar)
        }
    }

    /// Otro script de bin/ (corregir.py, guion.py; `GRABA_HERRAMIENTAS` lo pone el host con `Procesador.entornoApp`). La IA de la
    /// persona puede tardar: 15 minutos como mucho.
    static func correrJSON(_ script: String, _ args: [String], limite: Int = 900, fin: @escaping @MainActor ([String: Any]) -> Void) {
        Procesador.correr(script, args, limite: limite) { fin($0.respuesta) }
    }
}

// MARK: - YouTube (bin/youtube.py; el permiso queda en el Llavero con los Secretos del host)

@MainActor
enum YouTube {
    /// El mismo servicio y la misma cuenta del Llavero de siempre («Graba» / «youtube»): quien ya conectó su canal no lo pierde.
    static let llavero = Secretos(servicio: "Graba")
    private(set) static var subiendo: Set<String> = []
    static var conectado: Bool { llavero.leer("youtube") != nil }
    /// ¿Hay un cliente OAuth para conectar? (el del proyecto o el propio de la persona, en Ajustes).
    static var disponible: Bool {
        let archivo = Grabaciones.leerJSON(Host.recursos.appendingPathComponent("bin/youtube_cliente.json"))
        return !((archivo["id"] as? String) ?? "").isEmpty || !Config.texto("youtube_client_id").isEmpty
    }

    /// Conectar espera a que la persona dé permiso en su navegador: hasta 10 minutos.
    static func conectar(_ fin: @escaping @MainActor ([String: Any]) -> Void) {
        Procesamiento.correrJSON("youtube.py", ["conectar"], limite: 600) { r in
            var r = r
            if r["ok"] as? Bool == true, let token = r["refresh_token"] as? String {
                if llavero.guardar(token, cuenta: "youtube") {
                    Config.deLaApp(["youtube_canal": r["canal"] as? String ?? ""])
                } else {
                    r = ["ok": false, "error": Idioma.t("No pude guardar el permiso de YouTube en el llavero del sistema.")]
                }
            }
            r.removeValue(forKey: "refresh_token")  // a la interfaz nunca llega el token
            fin(r)
        }
    }

    static func desconectar() {
        llavero.borrar("youtube")
        Config.deLaApp(["youtube_canal": "", "youtube_auto": false])
    }

    /// bin/youtube.py lee el token de GRABA_YT_TOKEN (no se toca en esta migración: pendiente #5 de Pieza, la pieza «youtube», que
    /// lo pasará por la entrada estándar). Subir un video largo tarda: hasta una hora, el tope del host.
    static func subir(_ carpeta: String, fin: (@MainActor ([String: Any]) -> Void)? = nil) {
        guard let token = llavero.leer("youtube"), !subiendo.contains(carpeta) else { return }
        subiendo.insert(carpeta)
        Grabaciones.escribirJSON(URL(fileURLWithPath: carpeta).appendingPathComponent("youtube.json"), ["estado": "subiendo", "pct": 0])
        Procesador.correr("youtube.py", ["subir", carpeta], limite: 3600, entorno: [Host.prefijo + "YT_TOKEN": token]) { resultado in
            subiendo.remove(carpeta)
            fin?(resultado.respuesta)
            Ventana.shared.llamar("youtubeSubido", resultado.respuesta)
            Ventana.shared.enviarEstado()
        }
    }
}
