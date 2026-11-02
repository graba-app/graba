// swift-tools-version:5.10
import PackageDescription

// Graba para Mac: la app nativa genérica de Pieza (host-mac) con la interfaz de ui/, los scripts de bin/ (Python portátil adentro)
// y lo propio de Graba (grabar con ScreenCaptureKit, flotantes, barra de menú, atajos, recorte).
let package = Package(
    name: "Graba",
    platforms: [.macOS("15.0")],
    targets: [
        .executableTarget(
            name: "Graba",
            dependencies: ["PiezaHost", "PiezaActualizaciones"],
            path: "Sources/Graba"
        ),
        // Pieza «host-mac» (de Pieza: no se edita a mano): la ventana, el puente con sus guardas, config e idioma desde app.json,
        // menús, apariencia, el Llavero, los scripts de bin/ con límite de tiempo y las acciones declaradas en acciones.json.
        // Graba le registra lo suyo en GrabaApp.swift y Acciones.swift.
        .target(name: "PiezaHost", path: "Sources/PiezaHost"),
        // Pieza «actualizaciones» (de Pieza): solo los Releases de graba-app/graba, con su .sha256.
        .target(name: "PiezaActualizaciones", path: "Sources/PiezaActualizaciones"),
        // Pieza «trabajos»: en Graba solo se usa su latido en Python (procesar.py); el lector de progreso queda para después.
        .target(name: "PiezaTrabajos", path: "Sources/PiezaTrabajos"),
        // whisper.cpp oficial (framework para Apple, usa Metal).
        .binaryTarget(
            name: "whisper",
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-v1.8.3-xcframework.zip",
            checksum: "a970006f256c8e689bc79e73f7fa7ddb8c1ed2703ad43ee48eb545b5bb6de6af"
        ),
        .executableTarget(
            name: "graba-transcribir",
            dependencies: ["whisper"],
            path: "Sources/Transcribir",
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
                                           "-Xlinker", "-rpath", "-Xlinker", "@executable_path"])]
        ),
    ]
)
