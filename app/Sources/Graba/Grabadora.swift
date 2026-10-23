import AVFoundation
import AppKit
import ScreenCaptureKit

/// Graba la pantalla donde está el mouse (con la burbuja de la cámara, que es una ventana más) y el micrófono en un .mp4.
/// Usa ScreenCaptureKit + AVAssetWriter. No usamos SCRecordingOutput: con micrófono deja archivos que no se pueden reproducir
/// (error conocido de macOS 15), así que escribimos el archivo nosotros, con el audio del micrófono en AAC.
final class Grabadora: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var video: AVAssetWriterInput?
    private var audio: AVAssetWriterInput?
    private var inicio: CMTime?
    private var ultimo: CMTime = .zero
    private let cola = DispatchQueue(label: "app.graba.grabadora")
    /// Se llama si macOS corta la grabación (por ejemplo, si se quita el permiso).
    var alFallar: ((String) -> Void)?

    /// Pantalla bajo el mouse (donde la persona está trabajando).
    @MainActor static func pantallaActiva() -> NSScreen {
        let m = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(m, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
    }

    /// Qué se graba: toda una pantalla, una ventana (con la burbuja encima) o un área dibujada (coordenadas de Cocoa).
    enum Fuente {
        case pantalla(NSScreen)
        case ventana(CGWindowID)
        case area(NSScreen, CGRect)
    }

    @MainActor
    func empezar(en archivo: URL, fuente: Fuente, excluyendo ventanas: [CGWindowID], incluyendo extra: [CGWindowID], microfono: Bool) async throws {
        let contenido = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        func displayDe(_ s: NSScreen) -> SCDisplay? {
            let id = (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
            return contenido.displays.first { $0.displayID == id } ?? contenido.displays.first
        }
        let noEncontre = NSError(domain: "Graba", code: 1, userInfo: [NSLocalizedDescriptionKey: Idioma.t("No encontré lo que querías grabar.")])
        let excluidas = contenido.windows.filter { ventanas.contains($0.windowID) }
        var pantalla = Grabadora.pantallaActiva()
        let display: SCDisplay
        let filtro: SCContentFilter
        var recorte: CGRect?  // en puntos, relativo a la pantalla, origen arriba a la izquierda
        switch fuente {
        case .pantalla(let s):
            pantalla = s
            guard let d = displayDe(s) else { throw noEncontre }
            display = d
            filtro = SCContentFilter(display: d, excludingWindows: excluidas)
        case .area(let s, let r):
            pantalla = s
            guard let d = displayDe(s) else { throw noEncontre }
            display = d
            filtro = SCContentFilter(display: d, excludingWindows: excluidas)
            recorte = CGRect(x: r.minX - s.frame.minX, y: s.frame.maxY - r.maxY, width: r.width, height: r.height)
        case .ventana(let id):
            guard let w = contenido.windows.first(where: { $0.windowID == id }) else { throw noEncontre }
            let centro = CGPoint(x: w.frame.midX, y: w.frame.midY)
            guard let d = contenido.displays.first(where: { $0.frame.contains(centro) }) ?? contenido.displays.first else { throw noEncontre }
            display = d
            pantalla = NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == d.displayID } ?? pantalla
            // Solo esa ventana y la burbuja de la cámara: lo que pase por encima no sale en el video.
            let incluidas = [w] + contenido.windows.filter { extra.contains($0.windowID) }
            filtro = SCContentFilter(display: d, including: incluidas)
            recorte = w.frame.offsetBy(dx: -d.frame.minX, dy: -d.frame.minY).intersection(CGRect(x: 0, y: 0, width: d.frame.width, height: d.frame.height))
        }

        // Hasta 1920 px por lado (como un video de YouTube en 1080p), conservando la proporción y en números pares.
        let escala = pantalla.backingScaleFactor
        let base = recorte?.size ?? CGSize(width: display.width, height: display.height)
        let anchoNativo = Double(base.width) * escala, altoNativo = Double(base.height) * escala
        let factor = min(1, 1920 / anchoNativo, 1920 / altoNativo)
        let ancho = max(2, Int(anchoNativo * factor) / 2 * 2), alto = max(2, Int(altoNativo * factor) / 2 * 2)

        let conf = SCStreamConfiguration()
        conf.width = ancho
        conf.height = alto
        conf.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        conf.pixelFormat = kCVPixelFormatType_32BGRA
        conf.showsCursor = true
        conf.queueDepth = 6
        if let recorte { conf.sourceRect = recorte }
        conf.captureMicrophone = microfono

        let w = try AVAssetWriter(outputURL: archivo, fileType: .mp4)
        let v = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: ancho,
            AVVideoHeightKey: alto,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: ancho * alto * 3,  // ~6 Mbps en 1080p: nítido para texto en pantalla
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: 30,
            ],
        ])
        v.expectsMediaDataInRealTime = true
        w.add(v)
        if microfono {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 128_000,
            ])
            a.expectsMediaDataInRealTime = true
            w.add(a)
            audio = a
        }
        writer = w
        video = v
        inicio = nil
        ultimo = .zero

        let s = SCStream(filter: filtro, configuration: conf, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: cola)
        if microfono { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: cola) }
        stream = s
        try await s.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of tipo: SCStreamOutputType) {
        guard sb.isValid, let writer else { return }
        switch tipo {
        case .screen:
            // Solo cuadros completos: cuando la pantalla no cambia llegan cuadros "idle" sin imagen.
            guard let adjuntos = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let crudo = adjuntos.first?[.status] as? Int, SCFrameStatus(rawValue: crudo) == .complete,
                  let video else { return }
            if inicio == nil {
                guard writer.startWriting() else { return }
                writer.startSession(atSourceTime: sb.presentationTimeStamp)
                inicio = sb.presentationTimeStamp
            }
            if video.isReadyForMoreMediaData, video.append(sb) { ultimo = max(ultimo, sb.presentationTimeStamp) }
        case .microphone:
            guard let inicio, let audio, sb.presentationTimeStamp >= inicio, audio.isReadyForMoreMediaData else { return }
            if audio.append(sb) { ultimo = max(ultimo, sb.presentationTimeStamp) }
        default:
            break
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        alFallar?(error.localizedDescription)
    }

    /// Termina y cierra el archivo. Devuelve la duración en segundos (0 si no alcanzó a grabar nada).
    func detener() async -> Double {
        try? await stream?.stopCapture()
        stream = nil
        return await withCheckedContinuation { (fin: CheckedContinuation<Double, Never>) in
            cola.async { [self] in
                guard let writer, let inicio, writer.status == .writing else { fin.resume(returning: 0); return }
                video?.markAsFinished()
                audio?.markAsFinished()
                // Si la pantalla quedó quieta al final, el video dura hasta el último sonido igual.
                writer.endSession(atSourceTime: max(ultimo, inicio))
                let duracion = CMTimeGetSeconds(CMTimeSubtract(ultimo, inicio))
                writer.finishWriting { fin.resume(returning: writer.status == .completed ? duracion : 0) }
            }
        }
    }

    /// Saca el audio del video a WAV 16 kHz mono (lo que necesita whisper). Devuelve false si el video no tiene audio.
    static func extraerAudio(de video: URL, a destino: URL) async throws -> Bool {
        let asset = AVURLAsset(url: video)
        let pistas = try await asset.loadTracks(withMediaType: .audio)
        guard !pistas.isEmpty else { return false }
        let lector = try AVAssetReader(asset: asset)
        let salida = AVAssetReaderAudioMixOutput(audioTracks: pistas, audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
        ])
        lector.add(salida)
        guard lector.startReading() else { throw lector.error ?? NSError(domain: "Graba", code: 2) }
        var pcm = Data()
        while let sb = salida.copyNextSampleBuffer() {
            guard let bloque = CMSampleBufferGetDataBuffer(sb) else { continue }
            let n = CMBlockBufferGetDataLength(bloque)
            var trozo = Data(count: n)
            trozo.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(bloque, atOffset: 0, dataLength: n, destination: $0.baseAddress!) }
            pcm.append(trozo)
        }
        guard lector.status == .completed else { throw lector.error ?? NSError(domain: "Graba", code: 3) }
        var wav = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 2)) }
        wav.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + pcm.count)); wav.append("WAVE".data(using: .ascii)!)
        wav.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        wav.append("data".data(using: .ascii)!); u32(UInt32(pcm.count)); wav.append(pcm)
        try wav.write(to: destino)
        return true
    }
}
