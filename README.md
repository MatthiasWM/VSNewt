# NewtonScript for VS Code (VSNewt)

Write, run, and debug [NewtonScript](https://en.wikipedia.org/wiki/NewtonScript),
the language of the Apple Newton, in Visual Studio Code. Everything is done
by `newtc`, a NewtonScript compiler, runtime, and debugger built from the
[newton-framework](https://github.com/MatthiasWM/newton-framework) (a
reimplementation of the Newton OS). It comes with the extension.

**Early release.** It runs on **macOS 13 (Ventura) or later on Apple
Silicon** only. There is no Newton screen yet: programs run without views
(see [Known limitations](#known-limitations)).

## Install

1. Download `vsnewt-darwin-arm64-<version>.vsix` from the
   [Releases](https://github.com/MatthiasWM/VSNewt/releases) page.
2. In VS Code, open the Extensions view, click **…** at its top, and choose
   **Install from VSIX…**, or run
   `code --install-extension vsnewt-darwin-arm64-<version>.vsix` in a terminal.

## Features

- **Syntax highlighting** for `.ns`, `.newt`, and `.newtonscript` files,
  including the 1,350 built-in functions of the Newton ROM.
- **Run** a NewtonScript file: open it and press **F5**. `Print()` output
  appears in the Debug Console.
- **Debug** at the source level:
  - breakpoints (click in the gutter), also while the program runs;
  - step over, into, and out, by line;
  - the call stack, with arguments, locals, `self`, and the values on the
    stack; frames and arrays can be expanded;
  - hover and Watch expressions, and the Debug Console evaluates any
    NewtonScript expression in the selected stack frame;
  - stop when an exception is thrown (**All Exceptions** in the Breakpoints
    view), and **Pause** a running program;
  - bytecode: functions without source show their disassembly, and the
    **Disassembly** view (right click in the editor, **Open Disassembly
    View**) steps one instruction at a time.
- **Debug a package** (`.pkg`) in its decompiled source: see below.
- **Compile** to a package or an NSOF file (commands below).

## Run and debug

Press **F5** in a NewtonScript file and choose **NewtonScript**. Without a
`launch.json`, F5 runs the file in the active editor. A launch configuration:

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Run NewtonScript file",
  "program": "${file}"
}
```

| Attribute | |
| --- | --- |
| `program` | What to run: a NewtonScript file (`.ns`), or a package (`.pkg`), which is loaded and installed (its `InstallScript` runs). |
| `debugMap` | For a package: its debug map (`.nsdbg`). Default: the `.nsdbg` with the same name next to the package. |
| `args` | More `newtc` arguments, run before the program, e.g. `["-pkg", "lib.pkg"]` (the package is then `ref0` for the program). |
| `newtc` | A different `newtc` for this configuration. |
| `log` | Write all Debug Adapter Protocol messages to this file. |

### Debugging a package

Packages have no source, but `newtc` can decompile one and write a debug map
that connects the package's code to the decompiled source:

```sh
newtc -pkg app.pkg -odecompile app.ns     # writes app.ns and app.nsdbg
```

Then set `"program": "${workspaceFolder}/app.pkg"` (snippet **NewtonScript:
Debug a package**) and set breakpoints in `app.ns`. The package's code
itself stays unchanged.

## Commands

In the Command Palette, under **NewtonScript**:

- **Compile with VSNewt**: the current file to a package (`newtc -script <file> -opkg <file>.pkg`).
- **Compile with VSNewt for debugging**: the same with debug information (`-g`).
- **Compile NSOF with VSNewt** (and **for debugging**): to an NSOF file (`-onsof`).
- **Run NSOF with VSNewt**, **Debug NSOF with VSNewt**: `newtc -nsof <file> -run` or `-dbg`.

Compile errors are shown in the **Problems** view and the **VSNewt
Compiler** output.

## Settings

- `vsnewt.newtcPath`: the `newtc` to use, e.g. your own build. Empty: the one
  that comes with the extension.

## Known limitations

- macOS on Apple Silicon only, for now.
- No views: there is no Newton screen yet. A package's `InstallScript` runs,
  but its form isn't opened, and `-run` doesn't run NSOF files yet.
- Many built-in functions of the Newton ROM are not implemented yet. When a
  program calls one, `newtc` says so once in the Debug Console
  (`Fsin is not implemented yet ..., returns nil`).

## Development

- Open this folder in VS Code and start **Run Extension (samples)**: a second
  window opens the `samples` folder; open `hello.ns` there and press F5.
- `newtc` is built in the newton-framework repository:
  `Matt/tools/build_vsnewt_newtc.sh` builds it for release and copies it to
  `bin/darwin-arm64/newtc`.
- The grammar is generated: `scripts/make_grammar.py` (built-in function
  names from `newtc`), its test by `scripts/make_grammar_test.py`.
- Tests: `npm test` (debug sessions in VS Code; `NEWTC=/path/to/newtc npm
  test` uses that `newtc`) and `npm run test:grammar`.
- To debug `newtc` itself while VS Code talks to it: run `newtc -dap-server
  4711` (e.g. in lldb), then start a configuration with `"debugServer": 4711`
  (snippet **NewtonScript: Connect to newtc -dap-server**).
- Package: `npm run package` writes `vsnewt-darwin-arm64-<version>.vsix`.

## License

MIT, see [LICENSE](LICENSE).
