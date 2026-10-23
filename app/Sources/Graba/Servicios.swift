import AVFoundation
import AppKit
import CoreGraphics

// MARK: - Rutas y configuración (compartida con bin/ia.py)

enum Rutas {
    /// Datos del usuario: una carpeta por grabación. Fuera de la app, así actualizar no borra nada.
    static var base: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Graba") }
    static var interno: URL { base.appendingPathComponent(".graba") }
    static var config: URL { interno.appendingPathComponent("config.json") }
    static var modelos: URL { interno.appendingPathComponent("modelos") }
    /// Código (bin/, ui/): dentro de Graba.app.
    static var recursos: URL { Bundle.main.resourceURL!.appendingPathComponent("graba") }
    static var python: URL { Bundle.main.resourceURL!.appendingPathComponent("python/bin/python3") }
    static var herramientas: URL { Bundle.main.executableURL!.deletingLastPathComponent() }
}

enum Config {
    static let porDefecto: [String: Any] = ["ia": "", "modelo": "", "idioma_audio": "auto", "idioma_ui": "", "camara": true, "microfono": true]

    static func leer() -> [String: Any] {
        var d = porDefecto
        if let data = try? Data(contentsOf: Rutas.config), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            d.merge(j) { _, nuevo in nuevo }
        }
        return d
    }

    static func guardar(_ cambios: [String: Any]) {
        var d = leer()
        d.merge(cambios) { _, nuevo in nuevo }
        try? FileManager.default.createDirectory(at: Rutas.interno, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: Rutas.config) }
    }

    static func bool(_ clave: String) -> Bool { (leer()[clave] as? Bool) ?? (porDefecto[clave] as? Bool ?? false) }
    static func texto(_ clave: String) -> String { (leer()[clave] as? String) ?? "" }
}

// MARK: - Idioma (las claves son el texto en español, igual que en ui/idiomas)

enum Idioma {
    nonisolated(unsafe) private static var cache: (codigo: String, textos: [String: String])?

    static var codigo: String {
        let elegido = Config.texto("idioma_ui")
        if !elegido.isEmpty { return elegido }
        return Locale.preferredLanguages.first?.hasPrefix("es") == true ? "es" : "en"
    }

    static func t(_ texto: String) -> String {
        let c = codigo
        guard c != "es" else { return texto }
        if cache?.codigo != c {
            var textos: [String: String] = [:]
            let url = Rutas.recursos.appendingPathComponent("ui/idiomas/\(c).json")
            if let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                textos = j["textos"] as? [String: String] ?? [:]
            }
            cache = (c, textos)
        }
        return cache?.textos[texto] ?? texto
    }

    static func f(_ plantilla: String, _ n: Int) -> String { t(plantilla).replacingOccurrences(of: "{n}", with: String(n)) }
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

    /// Prueba real: le pide una palabra. Así sabemos que está instalada y con la sesión iniciada.
    static func probar(_ id: String, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        guard let ia = conocidas.first(where: { $0.id == id }), let ruta = buscar(ia.comandos) else { fin(false, Idioma.t("No está instalada.")); return }
        let pedido = "Responde solo con la palabra: listo"
        let esAgy = (ruta as NSString).lastPathComponent == "agy"
        let args: [String]
        switch id {
        case "codex": args = ["exec", "--skip-git-repo-check", "-s", "read-only", "-"]
        case "gemini" where esAgy: args = ["--output-format", "text", "--sandbox", "-p", pedido]
        case "gemini": args = ["-p", "Responde a las instrucciones de arriba.", "-o", "text"]
        default: args = ["-p", "--output-format", "text"]
        }
        let p = Process(), salida = Pipe(), error = Pipe(), entrada = Pipe()
        p.executableURL = URL(fileURLWithPath: ruta)
        p.arguments = args
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = (dirs() + ["/bin"]).joined(separator: ":")
        p.environment = env
        p.currentDirectoryURL = FileManager.default.temporaryDirectory
        p.standardInput = entrada; p.standardOutput = salida; p.standardError = error
        p.terminationHandler = { pr in
            let texto = String(data: salida.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let err = String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            Task { @MainActor in
                let ok = pr.terminationStatus == 0 && !texto.isEmpty
                fin(ok, ok ? texto.trimmingCharacters(in: .whitespacesAndNewlines) : String(err.suffix(300)))
            }
        }
        do { try p.run() } catch { fin(false, error.localizedDescription); return }
        entrada.fileHandleForWriting.write(pedido.data(using: .utf8)!)
        try? entrada.fileHandleForWriting.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if p.isRunning { p.terminate() } }
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

// MARK: - Procesamiento (bin/procesar.py con el Python que viene dentro de la app)

@MainActor
enum Procesador {
    private(set) static var enCurso: String?
    private static var cola: [(String, Bool)] = []

    /// Corre otro script de bin/ (el último argumento es el JSON de salida) y devuelve lo que escribió.
    static func correrJSON(_ script: String, _ args: [String], entorno: [String: String] = [:], fin: @escaping @MainActor ([String: Any]) -> Void) {
        let salida = FileManager.default.temporaryDirectory.appendingPathComponent("graba-\(UUID().uuidString).json")
        let p = Process()
        p.executableURL = Rutas.python
        p.arguments = [Rutas.recursos.appendingPathComponent("bin/\(script)").path] + args + [salida.path]
        var env = ProcessInfo.processInfo.environment
        env["GRABA_RECURSOS"] = Rutas.recursos.path
        env["GRABA_HERRAMIENTAS"] = Rutas.herramientas.path
        env["PYTHONIOENCODING"] = "utf-8"
        env.merge(entorno) { _, nuevo in nuevo }
        p.environment = env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { _ in
            Task { @MainActor in
                let r = Grabaciones.leerJSON(salida)
                try? FileManager.default.removeItem(at: salida)
                fin(r.isEmpty ? ["ok": false, "error": Idioma.t("No pude terminar. Intenta de nuevo.")] : r)
            }
        }
        do { try p.run() } catch { fin(["ok": false, "error": error.localizedDescription]) }
    }

    static func encolar(_ carpeta: String, soloIA: Bool = false, alTerminar: @escaping @MainActor () -> Void) {
        cola.append((carpeta, soloIA))
        siguiente(alTerminar)
    }

    private static func siguiente(_ alTerminar: @escaping @MainActor () -> Void) {
        guard enCurso == nil, !cola.isEmpty else { return }
        let (carpeta, soloIA) = cola.removeFirst()
        enCurso = carpeta
        let salida = FileManager.default.temporaryDirectory.appendingPathComponent("graba-\(UUID().uuidString).json")
        let p = Process()
        p.executableURL = Rutas.python
        p.arguments = [Rutas.recursos.appendingPathComponent("bin/procesar.py").path, carpeta, salida.path] + (soloIA ? ["--solo-ia"] : [])
        var env = ProcessInfo.processInfo.environment
        env["GRABA_RECURSOS"] = Rutas.recursos.path
        env["GRABA_HERRAMIENTAS"] = Rutas.herramientas.path
        env["PYTHONIOENCODING"] = "utf-8"
        p.environment = env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { _ in
            Task { @MainActor in
                let r = Grabaciones.leerJSON(salida)
                try? FileManager.default.removeItem(at: salida)
                if r["ok"] as? Bool == true, !soloIA, Config.bool("youtube_auto"), let c = r["carpeta"] as? String { YouTube.subir(c) }
                enCurso = nil
                alTerminar()
                siguiente(alTerminar)
            }
        }
        do { try p.run() } catch {
            Grabaciones.escribirEstado(carpeta, ["estado": "error", "error": Idioma.t("No pude iniciar el procesamiento.") + " " + error.localizedDescription])
            enCurso = nil
            alTerminar()
        }
    }
}

// MARK: - Llavero (tokens: nunca en archivos)

enum Llavero {
    private static let servicio = "Graba"

    static func guardar(_ valor: String, cuenta: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio, kSecAttrAccount as String: cuenta]
        SecItemDelete(base as CFDictionary)
        var nuevo = base
        nuevo[kSecValueData as String] = Data(valor.utf8)
        SecItemAdd(nuevo as CFDictionary, nil)
    }

    static func leer(_ cuenta: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio,
                                kSecAttrAccount as String: cuenta, kSecReturnData as String: true]
        var r: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &r) == errSecSuccess, let d = r as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func borrar(_ cuenta: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio, kSecAttrAccount as String: cuenta] as CFDictionary)
    }
}

// MARK: - YouTube (bin/youtube.py; el permiso queda en el Llavero)

@MainActor
enum YouTube {
    private(set) static var subiendo: Set<String> = []
    static var conectado: Bool { Llavero.leer("youtube") != nil }
    /// ¿Hay un cliente OAuth para conectar? (el del proyecto o el propio de la persona, en Ajustes).
    static var disponible: Bool {
        let archivo = Grabaciones.leerJSON(Rutas.recursos.appendingPathComponent("bin/youtube_cliente.json"))
        return !((archivo["id"] as? String) ?? "").isEmpty || !Config.texto("youtube_client_id").isEmpty
    }

    static func conectar(_ fin: @escaping @MainActor ([String: Any]) -> Void) {
        Procesador.correrJSON("youtube.py", ["conectar"]) { r in
            var r = r
            if r["ok"] as? Bool == true, let token = r["refresh_token"] as? String {
                Llavero.guardar(token, cuenta: "youtube")
                Config.guardar(["youtube_canal": r["canal"] as? String ?? ""])
            }
            r.removeValue(forKey: "refresh_token")  // a la interfaz nunca llega el token
            fin(r)
        }
    }

    static func desconectar() {
        Llavero.borrar("youtube")
        Config.guardar(["youtube_canal": "", "youtube_auto": false])
    }

    static func subir(_ carpeta: String, fin: (@MainActor ([String: Any]) -> Void)? = nil) {
        guard let token = Llavero.leer("youtube"), !subiendo.contains(carpeta) else { return }
        subiendo.insert(carpeta)
        Grabaciones.escribirJSON(URL(fileURLWithPath: carpeta).appendingPathComponent("youtube.json"), ["estado": "subiendo", "pct": 0])
        Procesador.correrJSON("youtube.py", ["subir", carpeta], entorno: ["GRABA_YT_TOKEN": token]) { r in
            subiendo.remove(carpeta)
            fin?(r)
            Ventana.shared.llamar("youtubeSubido", r)
            Ventana.shared.enviarEstado()
        }
    }
}
