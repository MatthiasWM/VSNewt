# Changelog

## 0.2.0

Newton apps run in windows: nBattleship 1.4 plays to the end.

- A package's app opens in a window of its own (newtc with FLTK), drawn at
  the Mac's resolution: views with their frames and fills, text in the
  Newton's font families (stood in for by Mac fonts), pictures, icons,
  shapes, `viewDrawScript`s, XOR drawing and hiliting.
- The mouse is the pen: taps, drags, `TrackHilite`, strokes (`GetPoint`,
  `StrokeBounds`, ...), and taps no view takes as tap gestures
  (`viewGestureScript`).
- Buttons, checkboxes, pickers and popup menus (`DoPopup`), modal dialogs,
  alerts.
- Timers: `AddDelayedCall`, `AddDeferredSend` and the others,
  `viewIdleScript`.
- Soups, kept between runs in a store file (`"args": ["-store", "app.store"]`),
  written safely, with a backup.
- The grammar knows newtc's test functions (`TestTap`, `TestSnapshot`, ...).

## 0.1.0

First release, for macOS 13 or later on Apple Silicon.

- Syntax highlighting for NewtonScript (`.ns`, `.newt`, `.newtonscript`).
- Run and debug NewtonScript files with the bundled `newtc`: breakpoints,
  stepping by line, call stack, variables, watch and hover, evaluating in the
  Debug Console, exception breakpoints, pause, bytecode listings and the
  Disassembly view.
- Debug packages in their decompiled source (`.pkg` plus `.nsdbg`).
- Compile to packages and NSOF files.
