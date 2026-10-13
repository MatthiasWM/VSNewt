# Changelog

## 0.3.0

Debug on Einstein and on a MessagePad; build with F7. A Newton needs nothing
from NTK.

- **F7** builds the project into a package (with debug information) and
  jumps to the first error; **F5** builds first when it runs the project's
  package. The project is the setting `vsnewt.main`, else the file in the
  editor.
- **NewtonScript: New App Project**: a small app, the setting, and a
  `launch.json` for newtc, Einstein, and a MessagePad.
- Run and debug on a Newton: `"target": "tcp"` (Einstein) or
  `"serial:<device>[@<bps>]"`: breakpoints, stepping, the stack, variables,
  the Debug Console, exceptions, breakpoints in `InstallScript`s; `attach`
  to what already runs there.
- `newtc` runs in the background from the first such session on and keeps
  the Newton connected; **NewtonScript: Stop the Debug Server** ends it.
- **NewtonScript: Save the newtc App for the Newton...**: `newtc.pkg`, which
  connects the Newton to newtc (instead of NTK's Toolkit app).
- `"reinstall": true` uploads a package even if it is unchanged on the
  Newton.
- `Load("file.ns")` splits a source into several files (looked for next to
  the calling file); breakpoints in loaded files work, and their errors
  show up in them. `global x := value` works.
- Build errors point at the right line: a syntax error at its own line, an
  error at run time at the top-level statement that ran. A package frame
  without `flags` builds (it crashed newtc).
- **NewtonScript: Decompile a Package for Debugging...** (also in the
  Explorer): `app_dec.ns` and its debug map next to the package, the source
  read-only, two launch configurations; F5 in the decompiled source debugs
  the original package. F5 warns when the source was changed after
  decompiling (its lines no longer match) and offers to decompile again.

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
