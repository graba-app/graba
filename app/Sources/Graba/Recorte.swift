import AVFoundation
import Foundation

/// Recortar el inicio y el final de una grabación (botón «Recortar» de la ventana).
/// El video se corta sin recomprimir (AVAssetExportSession «passthrough»: queda exacto gracias a la lista de edición del MP4)
/// y el original se guarda en <carpeta>/.original/video.mp4. Los textos los ajusta bin/recortar.py.
@MainActor
enum Recorte {
    static func recortar(_ carpeta: URL, inicio: Double, fin: Double, listo: @escaping @MainActor ([String: Any]) -> Void) {
        let error = { (texto: String) in listo(["ok": false, "error": texto]) }
        guard fin - inicio >= 1 else { return error(Idioma.t("El recorte tiene que durar al menos un segundo.")) }
        Procesador.correrJSON("recortar.py", ["preparar", carpeta.path]) { r in
            guard r["ok"] as? Bool == true else { return error(r["error"] as? String ?? Idioma.t("No pude recortar.")) }
            Task { @MainActor in
                do {
                    try await cortarVideo(carpeta, inicio: inicio, fin: fin)
                } catch {
                    return listo(["ok": false, "error": Idioma.t("No pude recortar el video:") + " " + error.localizedDescription])
                }
                Procesador.correrJSON("recortar.py", ["textos", carpeta.path, String(inicio), String(fin)]) { listo($0) }
            }
        }
    }

    private static func cortarVideo(_ carpeta: URL, inicio: Double, fin: Double) async throws {
        let fm = FileManager.default
        let video = carpeta.appendingPathComponent("video.mp4")
        let original = carpeta.appendingPathComponent(".original/video.mp4")
        try fm.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
        // La primera vez el video completo pasa a .original; después se recorta lo ya recortado (los tiempos son los del video actual).
        let fuente: URL
        if fm.fileExists(atPath: original.path) {
            fuente = carpeta.appendingPathComponent(".recortando-fuente.mp4")
            try? fm.removeItem(at: fuente)
            try fm.copyItem(at: video, to: fuente)
        } else {
            try fm.moveItem(at: video, to: original)
            fuente = original
        }
        let destino = carpeta.appendingPathComponent(".recortando.mp4")
        try? fm.removeItem(at: destino)
        defer {
            if fuente != original { try? fm.removeItem(at: fuente) }
            try? fm.removeItem(at: destino)
            // Si algo falló, el video vuelve a su lugar.
            if !fm.fileExists(atPath: video.path), fm.fileExists(atPath: original.path), fuente == original { try? fm.copyItem(at: original, to: video) }
        }
        let asset = AVURLAsset(url: fuente)
        guard let exportar = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            throw NSError(domain: "Graba", code: 10, userInfo: [NSLocalizedDescriptionKey: Idioma.t("No se puede recortar este video.")])
        }
        exportar.timeRange = CMTimeRange(start: CMTime(seconds: inicio, preferredTimescale: 600), end: CMTime(seconds: fin, preferredTimescale: 600))
        exportar.shouldOptimizeForNetworkUse = true
        try await exportar.export(to: destino, as: .mp4)
        if fm.fileExists(atPath: video.path) {
            _ = try fm.replaceItemAt(video, withItemAt: destino)
        } else {
            try fm.moveItem(at: destino, to: video)
        }
    }

    /// Vuelve al video y los textos de antes del primer recorte.
    static func deshacer(_ carpeta: URL, listo: @escaping @MainActor ([String: Any]) -> Void) {
        let fm = FileManager.default
        let video = carpeta.appendingPathComponent("video.mp4")
        let original = carpeta.appendingPathComponent(".original/video.mp4")
        guard fm.fileExists(atPath: original.path) else { return listo(["ok": false, "error": Idioma.t("Esta grabación no tiene un recorte para deshacer.")]) }
        do {
            if fm.fileExists(atPath: video.path) { _ = try fm.replaceItemAt(video, withItemAt: original) } else { try fm.moveItem(at: original, to: video) }
        } catch {
            return listo(["ok": false, "error": error.localizedDescription])
        }
        Procesador.correrJSON("recortar.py", ["deshacer", carpeta.path]) { listo($0) }
    }
}
