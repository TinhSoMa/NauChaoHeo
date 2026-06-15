!macro customInstall
  DetailPrint "Detecting NVIDIA driver and downloading compatible FFmpeg..."
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-detect-ffmpeg.ps1" -InstallDir "$INSTDIR"'
!macroend
