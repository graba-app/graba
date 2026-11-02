// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import Foundation

/// Pieza «trabajos» (Mac): lee el archivo de progreso de un script (JSONL, lo escribe `trabajos.emitir`) cada 0,5 s y pasa las
/// líneas nuevas, ya leídas como JSON, a `aviso`. Equivale a escritorio/src/progreso.js. Va en su propio target (`PiezaTrabajos`).
///
///     let l = LectorProgreso(prefijo: "ana") { eventos in Ventana.shared.llamar("progreso", ["eventos": eventos]) }
///     env["ANA_PROGRESO"] = l.url.path        // antes de lanzar el script
///     l.empezar()                              // al lanzarlo
///     l.terminar()                             // al terminar: lo último que quedó, y se borra el archivo
///
/// Límites: una línea de más de `maxLinea` bytes se descarta entera (un script roto no llena la memoria) y en cada vuelta se leen
/// hasta `maxVuelta` bytes (lo demás, en la siguiente).
@MainActor
public final class LectorProgreso {
    public let url: URL
    public static let maxLinea = 1024 * 1024
    public static let maxVuelta = 4 * 1024 * 1024
    private let aviso: @MainActor ([[String: Any]]) -> Void
    private var desde: UInt64 = 0
    private var resto = Data()
    private var saltando = false
    private var reloj: Timer?

    public init(prefijo: String, aviso: @escaping @MainActor ([[String: Any]]) -> Void) {
        let p = prefijo.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.lowercased()
        url = FileManager.default.temporaryDirectory.appendingPathComponent("\(p.isEmpty ? "pieza" : p)-progreso-\(UUID().uuidString).jsonl")
        self.aviso = aviso
        FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }

    public func empezar() {
        // El reloj corre en el hilo principal (el de la interfaz): ahí se lee el archivo.
        reloj = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.leer() }
        }
    }

    public func leer() {
        guard let h = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? h.close() }
        guard (try? h.seek(toOffset: desde)) != nil, let d = try? h.read(upToCount: Self.maxVuelta), !d.isEmpty else { return }
        desde += UInt64(d.count)
        resto.append(d)
        var eventos: [[String: Any]] = []
        while let i = resto.firstIndex(of: 0x0A) {
            let linea = resto.subdata(in: resto.startIndex..<i)
            resto = resto.subdata(in: resto.index(after: i)..<resto.endIndex)
            if saltando { saltando = false; continue }  // el final de una línea demasiado larga
            if linea.count <= Self.maxLinea, let j = try? JSONSerialization.jsonObject(with: linea) as? [String: Any] { eventos.append(j) }
        }
        if resto.count > Self.maxLinea { resto = Data(); saltando = true }
        if !eventos.isEmpty { aviso(eventos) }
    }

    /// Al terminar el script: lo último que haya quedado y se borra el archivo.
    public func terminar() {
        reloj?.invalidate()
        reloj = nil
        for _ in 0..<8 {
            leer()
            let tam = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber
            if (tam?.uint64Value ?? 0) <= desde { break }
        }
        try? FileManager.default.removeItem(at: url)
    }
}
