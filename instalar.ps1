# Instala (o actualiza) Graba en Windows con un solo comando (PowerShell):
#   irm https://raw.githubusercontent.com/graba-app/graba/main/instalar.ps1 | iex
# Baja la última versión publicada en GitHub, verifica su huella SHA-256 y la instala solo para tu usuario
# (sin permisos de administrador). Tus grabaciones quedan en tu carpeta Graba y nunca se tocan.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'graba-app/graba'
function Falla($m) { Write-Host "x $m" -ForegroundColor Red; exit 1 }

if (-not [Environment]::Is64BitOperatingSystem) { Falla 'Graba necesita Windows de 64 bits.' }
Write-Host 'Buscando la última versión de Graba…'
try { $rel = Invoke-RestMethod -Headers @{ Accept = 'application/vnd.github+json' } "https://api.github.com/repos/$repo/releases/latest" } catch { Falla 'No pude consultar GitHub.' }
$tag = $rel.tag_name
if (-not $tag) { Falla 'No encontré una versión publicada.' }
$base = "https://github.com/$repo/releases/download/$tag"
$tmp = Join-Path $env:TEMP 'graba-instalar'
New-Item -ItemType Directory -Force $tmp | Out-Null
$exe = Join-Path $tmp 'Graba-Windows.exe'
Write-Host "Descargando Graba $tag…"
try {
  Invoke-WebRequest "$base/Graba-Windows.exe" -OutFile $exe -UseBasicParsing
  Invoke-WebRequest "$base/Graba-Windows.exe.sha256" -OutFile "$exe.sha256" -UseBasicParsing
} catch { Falla 'Esta versión aún no tiene descarga para Windows.' }
$esperado = ((Get-Content "$exe.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
$real = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($real -ne $esperado) { Remove-Item $exe -Force; Falla 'La descarga no coincide con su huella. No instalé nada.' }
Write-Host 'v Descarga verificada' -ForegroundColor Green

# Instalador silencioso (por usuario); al terminar abre Graba.
Start-Process -FilePath $exe -ArgumentList '/S', '--force-run' -Wait
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "v Graba $tag instalada. Se abrió el asistente: te ayuda a elegir tu IA y descargar el transcriptor." -ForegroundColor Green
