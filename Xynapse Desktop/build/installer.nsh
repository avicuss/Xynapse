; Extra steps for the Xynapse installer (picked up by electron-builder from build/installer.nsh).
; The installer ships two apps: Xynapse Desktop (the Electron app) and Xynapse Code (terminal app, copied to
; resources\xynapse-code by "extraResources" in package.json).
;
; The "Xynapse" desktop + Start menu shortcuts are made by electron-builder itself (nsis.createDesktopShortcut).

!macro customInstall
  ; Xynapse Code: desktop + Start menu shortcuts. They start in the user's home folder.
  SetOutPath "$PROFILE"
  CreateShortCut "$DESKTOP\Xynapse Code.lnk" "$INSTDIR\resources\xynapse-code\xynapse-code.cmd" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateShortCut "$SMPROGRAMS\Xynapse Code.lnk" "$INSTDIR\resources\xynapse-code\xynapse-code.cmd" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  SetOutPath "$INSTDIR"

  ; Xynapse Desktop starts with Windows, hidden in the tray (main.js understands --hidden).
  ; Same value name that main.js uses for app.setLoginItemSettings, so the Settings switch controls this entry.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Xynapse" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Xynapse Code.lnk"
  Delete "$SMPROGRAMS\Xynapse Code.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Xynapse"
!macroend
