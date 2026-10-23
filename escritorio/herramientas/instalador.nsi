; Instalador de Graba para Windows (por usuario, sin permisos de administrador).
; Lo arma herramientas/instalador-windows.sh con makensis (corre en Linux/Mac, sin Wine).
; Con /S instala en silencio y abre Graba al terminar (lo usan instalar.ps1 y el actualizador de la app).
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
!include "MUI2.nsh"

Name "Graba"
OutFile "${SALIDA}"
InstallDir "$LOCALAPPDATA\Programs\Graba"
BrandingText "Graba ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "Graba"
VIAddVersionKey /LANG=0 "FileDescription" "Instalador de Graba"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "MIT"

!define MUI_ICON "${ICONO}"
!define MUI_UNICON "${ICONO}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Graba.exe"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "English"

!define DESINSTALAR "Software\Microsoft\Windows\CurrentVersion\Uninstall\Graba"

Section "Graba"
  ; Si está abierta (p. ej. al actualizar) se cierra para poder reemplazar sus archivos.
  nsExec::Exec 'taskkill /IM Graba.exe /F'
  Sleep 1000
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${ORIGEN}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar Graba.exe"
  CreateShortcut "$SMPROGRAMS\Graba.lnk" "$INSTDIR\Graba.exe"
  CreateShortcut "$DESKTOP\Graba.lnk" "$INSTDIR\Graba.exe"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayName" "Graba"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${DESINSTALAR}" "Publisher" "Graba (open source)"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayIcon" "$INSTDIR\Graba.exe"
  WriteRegStr HKCU "${DESINSTALAR}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${DESINSTALAR}" "UninstallString" '"$INSTDIR\Desinstalar Graba.exe"'
  WriteRegStr HKCU "${DESINSTALAR}" "QuietUninstallString" '"$INSTDIR\Desinstalar Graba.exe" /S'
  WriteRegStr HKCU "${DESINSTALAR}" "URLInfoAbout" "https://graba-app.github.io/graba/"
  WriteRegDWORD HKCU "${DESINSTALAR}" "NoModify" 1
  WriteRegDWORD HKCU "${DESINSTALAR}" "NoRepair" 1
  IfSilent 0 +2
    Exec '"$INSTDIR\Graba.exe"'
SectionEnd

; Desinstalar quita la app; tus grabaciones (carpeta Graba) no se tocan.
Section "Uninstall"
  nsExec::Exec 'taskkill /IM Graba.exe /F'
  Sleep 800
  Delete "$SMPROGRAMS\Graba.lnk"
  Delete "$DESKTOP\Graba.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${DESINSTALAR}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.graba.escritorio"
SectionEnd
