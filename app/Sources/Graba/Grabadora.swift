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
    /// El sonido del Mac va a un archivo aparte (sistema.m4a) y se mezcla al final: así audio.wav (la voz) queda limpio para whisper.
    private var writerSistema: AVAssetWriter?
    private var audioSistema: AVAssetWriterInput?
    private var inicio: CMTime?
    private var ultimo: CMTime = .zero
    // Pausa: mientras está en pausa no se escribe nada; al reanudar, todo lo que llega se corre hacia atrás lo que duró la pausa
    // (`desfase`), así el video sigue de corrido sin un hueco. Solo se tocan en `cola`.
    private var enPausa = false
    private var resincronizar = false
    private var desfase: CMTime = .zero
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
    func empezar(en archivo: URL, fuente: Fuente, excluyendo ventanas: [CGWindowID], incluyendo extra: [CGWindowID], microfono: Bool,
                 sonidoMac: Bool = false) async throws {
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
        let micElegido = Config.texto("microfono_id")
        if microfono, !micElegido.isEmpty, AVCaptureDevice(uniqueID: micElegido) != nil { conf.microphoneCaptureDeviceID = micElegido }
        if sonidoMac {
            conf.capturesAudio = true
            conf.excludesCurrentProcessAudio = true
            conf.sampleRate = 48000
            conf.channelCount = 2
        }

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
        writerSistema = nil
        audioSistema = nil
        if sonidoMac {
            let destino = archivo.deletingLastPathComponent().appendingPathComponent("sistema.m4a")
            let ws = try AVAssetWriter(outputURL: destino, fileType: .m4a)
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160_000,
            ])
            a.expectsMediaDataInRealTime = true
            ws.add(a)
            writerSistema = ws
            audioSistema = a
        }
        inicio = nil
        ultimo = .zero
        cola.sync { enPausa = false; resincronizar = false; desfase = .zero }

        let s = SCStream(filter: filtro, configuration: conf, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: cola)
        if microfono { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: cola) }
        if sonidoMac { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: cola) }
        stream = s
        try await s.startCapture()
    }

    func pausar() { cola.async { [self] in enPausa = true } }

    func reanudar() { cola.async { [self] in if enPausa { enPausa = false; resincronizar = true } } }

    /// El mismo cuadro o sonido con su tiempo corrido hacia atrás `desfase` (lo que duraron las pausas).
    private func corrido(_ sb: CMSampleBuffer) -> CMSampleBuffer? {
        guard desfase != .zero else { return sb }
        var n: CMItemCount = 0
        CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: 0, arrayToFill: nil, entriesNeededOut: &n)
        var tiempos = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: max(1, n))
        CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: n, arrayToFill: &tiempos, entriesNeededOut: &n)
        for i in 0..<Int(n) {
            tiempos[i].presentationTimeStamp = CMTimeSubtract(tiempos[i].presentationTimeStamp, desfase)
            if tiempos[i].decodeTimeStamp.isValid { tiempos[i].decodeTimeStamp = CMTimeSubtract(tiempos[i].decodeTimeStamp, desfase) }
        }
        var copia: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: n, sampleTimingArray: &tiempos, sampleBufferOut: &copia)
        return copia
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer original: CMSampleBuffer, of tipo: SCStreamOutputType) {
        guard original.isValid, let writer, !enPausa else { return }
        if resincronizar, inicio != nil {
            // Lo primero que llega después de la pausa queda justo un cuadro después de lo último que se escribió.
            desfase = CMTimeSubtract(original.presentationTimeStamp, CMTimeAdd(ultimo, CMTime(value: 1, timescale: 30)))
            resincronizar = false
        }
        guard let sb = corrido(original) else { return }
        switch tipo {
        case .screen:
            // Solo cuadros completos: cuando la pantalla no cambia llegan cuadros "idle" sin imagen.
            guard let adjuntos = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let crudo = adjuntos.first?[.status] as? Int, SCFrameStatus(rawValue: crudo) == .complete,
                  let video else { return }
            if inicio == nil {
                guard writer.startWriting() else { return }
                writer.startSession(atSourceTime: sb.presentationTimeStamp)
                if let ws = writerSistema, ws.startWriting() { ws.startSession(atSourceTime: sb.presentationTimeStamp) }
                inicio = sb.presentationTimeStamp
            }
            if video.isReadyForMoreMediaData, video.append(sb) { ultimo = max(ultimo, sb.presentationTimeStamp) }
        case .microphone:
            guard let inicio, let audio, sb.presentationTimeStamp >= inicio, audio.isReadyForMoreMediaData else { return }
            if audio.append(sb) { ultimo = max(ultimo, sb.presentationTimeStamp) }
        case .audio:
            guard let inicio, let a = audioSistema, writerSistema?.status == .writing, sb.presentationTimeStamp >= inicio,
                  a.isReadyForMoreMediaData else { return }
            a.append(sb)
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
                if let ws = writerSistema, ws.status == .writing {
                    audioSistema?.markAsFinished()
                    ws.endSession(atSourceTime: max(ultimo, inicio))
                    let espera = DispatchSemaphore(value: 0)
                    ws.finishWriting { espera.signal() }
                    espera.wait()
                }
                writerSistema = nil
                audioSistema = nil
                // Si la pantalla quedó quieta al final, el video dura hasta el último sonido igual.
                writer.endSession(atSourceTime: max(ultimo, inicio))
                let duracion = CMTimeGetSeconds(CMTimeSubtract(ultimo, inicio))
                writer.finishWriting { fin.resume(returning: writer.status == .completed ? duracion : 0) }
            }
        }
    }

    /// Mezcla el sonido del Mac (sistema.m4a) con la voz dentro de video.mp4: el video se copia tal cual (sin recomprimir) y el audio
    /// queda en una sola pista AAC estéreo, la que reproducen todos los programas y YouTube. Devuelve true si reemplazó video.mp4.
    static func mezclarSonido(video: URL, sistema: URL) async throws -> Bool {
        let original = AVURLAsset(url: video), sonido = AVURLAsset(url: sistema)
        guard let pistaVideo = try await original.loadTracks(withMediaType: .video).first,
              let pistaSistema = try await sonido.loadTracks(withMediaType: .audio).first else { return false }
        let pistasVoz = try await original.loadTracks(withMediaType: .audio)
        let duracion = try await original.load(.duration)
        let rango = CMTimeRange(start: .zero, duration: duracion)

        let comp = AVMutableComposition()
        guard let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { return false }
        try cv.insertTimeRange(rango, of: pistaVideo, at: .zero)
        var audios: [AVMutableCompositionTrack] = []
        for p in pistasVoz {
            if let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try ca.insertTimeRange(rango, of: p, at: .zero)
                audios.append(ca)
            }
        }
        if let cs = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            let rs = try await pistaSistema.load(.timeRange)
            try cs.insertTimeRange(CMTimeRange(start: .zero, duration: min(rs.duration, duracion)), of: pistaSistema, at: .zero)
            audios.append(cs)
        }
        let formato = try await pistaVideo.load(.formatDescriptions).first

        let lector = try AVAssetReader(asset: comp)
        let lectorVideo = AVAssetReaderTrackOutput(track: cv, outputSettings: nil)  // sin recomprimir
        let lectorAudio = AVAssetReaderAudioMixOutput(audioTracks: audios, audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
        ])
        lector.add(lectorVideo)
        lector.add(lectorAudio)

        let mezcla = video.deletingLastPathComponent().appendingPathComponent(".video-mezcla.mp4")
        try? FileManager.default.removeItem(at: mezcla)
        let escritor = try AVAssetWriter(outputURL: mezcla, fileType: .mp4)
        let escritorVideo = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: formato)
        escritorVideo.transform = try await pistaVideo.load(.preferredTransform)
        let escritorAudio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000,
        ])
        escritor.add(escritorVideo)
        escritor.add(escritorAudio)
        guard lector.startReading(), escritor.startWriting() else { throw lector.error ?? escritor.error ?? NSError(domain: "Graba", code: 4) }
        escritor.startSession(atSourceTime: .zero)

        let grupo = DispatchGroup()
        func copiar(_ salida: AVAssetReaderOutput, a entrada: AVAssetWriterInput, cola: String) {
            grupo.enter()
            entrada.requestMediaDataWhenReady(on: DispatchQueue(label: cola)) {
                while entrada.isReadyForMoreMediaData {
                    if let sb = salida.copyNextSampleBuffer() { entrada.append(sb) } else { entrada.markAsFinished(); grupo.leave(); return }
                }
            }
        }
        copiar(lectorVideo, a: escritorVideo, cola: "app.graba.mezcla.video")
        copiar(lectorAudio, a: escritorAudio, cola: "app.graba.mezcla.audio")
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in grupo.notify(queue: .global()) { c.resume() } }
        guard lector.status == .completed else { escritor.cancelWriting(); try? FileManager.default.removeItem(at: mezcla); return false }
        await escritor.finishWriting()
        guard escritor.status == .completed else { try? FileManager.default.removeItem(at: mezcla); return false }
        _ = try FileManager.default.replaceItemAt(video, withItemAt: mezcla)
        return true
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
