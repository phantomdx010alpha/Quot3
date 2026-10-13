; Phase 64 - uninstall asks before touching the owner's data.
; Bills, backups, themes and logs live in %LOCALAPPDATA%\Quot3 (not in the install folder), so a plain uninstall keeps them.
; An update runs the old uninstaller silently: the data is never asked about or removed then.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Quot3 data (bills, backups, themes, logs)?$\r$\n$\r$\nChoose No to keep it, for example if you plan to reinstall.$\r$\n$\r$\nFolder: $LOCALAPPDATA\Quot3" /SD IDNO IDNO quot3KeepData
      RMDir /r "$LOCALAPPDATA\Quot3"
    quot3KeepData:
  ${endIf}
!macroend
