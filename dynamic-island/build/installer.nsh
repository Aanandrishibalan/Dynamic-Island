; Custom NSIS steps for the installer / uninstaller (electron-builder "nsis.include").
; Close any copy of the island that is still running BEFORE files are replaced. Otherwise the old process keeps the old
; version alive (the new one would only wake it up) and the update seems not to have installed.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 800
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 500
!macroend
