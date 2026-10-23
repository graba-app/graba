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

    @MainActor
    func empezar(en archivo: URL, excluyendo ventanas: [CGWindowID], microfono: Bool) async throws {
        let pantalla = Grabadora.pantallaActiva()
        let id = (pantalla.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
        let contenido = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = contenido.displays.first(where: { $0.displayID == id }) ?? contenido.displays.first else {
            throw NSError(domain: "Graba", code: 1, userInfo: [NSLocalizedDescriptionKey: Idioma.t("No encontré la pantalla para grabar.")])
        }
        let excluidas = contenido.windows.filter { ventanas.contains($0.windowID) }
        let filtro = SCContentFilter(display: display, excludingWindows: excluidas)

        // Hasta 1920 px de ancho (como un video de YouTube en 1080p), conservando la proporción y en números pares.
        let escala = pantalla.backingScaleFactor
        let anchoNativo = Double(display.width) * escala, altoNativo = Double(display.height) * escala
        let factor = min(1, 1920 / anchoNativo)
        let ancho = Int(anchoNativo * factor) / 2 * 2, alto = Int(altoNativo * factor) / 2 * 2

        let conf = SCStreamConfiguration()
        conf.width = ancho
        conf.height = alto
        conf.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        conf.pixelFormat = kCVPixelFormatType_32BGRA
        conf.showsCursor = true
        conf.queueDepth = 6
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
