# NewtonScript for VS Code (VSNewt)

Write, build, run, and debug [NewtonScript](https://en.wikipedia.org/wiki/NewtonScript),
the language of the Apple Newton, in Visual Studio Code: on your Mac, in the
[Einstein](https://github.com/pguyot/Einstein) emulator, or on a MessagePad.
Everything is done by `newtc`, a NewtonScript compiler, runtime, and debugger
built from the [newton-framework](https://github.com/MatthiasWM/newton-framework)
(a reimplementation of the Newton OS). It comes with the extension: you need
nothing else, not even NTK.

Two uses:
- **Develop apps**: build packages from NewtonScript source and debug them.
- **Look inside existing packages**: decompile one and debug the original
  package in its decompiled source.

**Early release** for **macOS 13 (Ventura) or later on Apple Silicon**. See
[Known limitations](#known-limitations).

## Quick start

1. **Install:** download `vsnewt-darwin-arm64-<version>.vsix` from the
   [Releases](https://github.com/MatthiasWM/VSNewt/releases) page. In VS
   Code's Extensions view, click **…** and choose **Install from VSIX…**.
2. **A script:** make a file `hello.ns` with `Print("Hello, Newton");` and
   press **F5**. The output is in the Debug Console.
3. **An app:** open an empty folder and run **NewtonScript: New App
   Project** (Cmd+Shift+P). Press **F7** to build it and **F5** to run it.
   It opens in a window on your Mac.

4. **An existing package:** right click a `.pkg` in the Explorer, choose
   **NewtonScript: Decompile a Package for Debugging...**, set a
   breakpoint, and press **F5**.

To run on Einstein or a MessagePad, see [On a Newton](#on-a-newton).

## Build: F7

**F7** saves your files and compiles the project into a package next to its
source (`MyApp.ns` → `MyApp.pkg`), with debug information. The project is the
file in the setting `vsnewt.main` (New App Project sets it), else the
NewtonScript file you are editing. A source that sets `newtAppName` is built
with `newtc -build` (see [Writing an app](#writing-an-app)); any other
source must return the package frame (`newtc -script`).

When something is wrong, F7 stops at the first error and shows it in the
editor. It is also in the **Problems** view (Cmd+Shift+M), and the
compiler's output is in the **VSNewt Compiler** output. A syntax error
points at its line. `newtc` runs the source while it builds, so an error at
run time can happen too. It points at the top-level statement that was
running, e.g. the call of the function that failed.

**F5** builds first, too, when it runs the project's package: no need to
press F7 before every run. If the build fails, nothing runs.

## Run and debug: F5

F5 runs the configuration selected in the **Run and Debug** view. Without a
`launch.json` it runs the project's package (`vsnewt.main`), or else the
NewtonScript file you are editing.

Debugging works the same everywhere:
- breakpoints (click in the gutter), also while the program runs;
- step over, into, and out, by line;
- the call stack, with arguments, locals, and `self`; frames and arrays
  can be expanded;
- hover, Watch expressions, and the Debug Console, which evaluates
  NewtonScript in the selected stack frame;
- stop when an exception is thrown (**All Exceptions** in the Breakpoints
  view).

### In newtc, on your Mac

Without a `"target"`, the program runs in `newtc` itself. A `.ns` file is
compiled and run. A package is installed (its `InstallScript` runs), and its
app opens in a window (see [Newton apps](#newton-apps)). Only in newtc, for now:
**Pause**, and the **Disassembly** view (right click in the editor, **Open
Disassembly View**), which steps one bytecode instruction at a time.

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Run in newtc",
  "program": "${workspaceFolder}/MyApp.pkg"
}
```

### On a Newton

With `"target"`, the program runs on Einstein or on a MessagePad, and you
debug it there.

**Once, on the Newton:** install the newtc app. Run **NewtonScript: Save the
newtc App for the Newton...** to get `newtc.pkg`, then install it:
- **Einstein:** drag it onto the Newton screen, or choose **Platform ›
  Install Package...**.
- **MessagePad:** use any package installer.

It shows up in Extras as **newtc**.

**Each time:**
1. Press **F5**. The Debug Console says `Waiting for a Newton on ...`.
2. On the Newton, open **newtc** in Extras and tap **Connect**.

`newtc` installs what it needs for debugging, then compiles and runs your
`.ns` file, or uploads and installs your package. The Debug Console shows
the upload's progress.

`newtc` keeps running in the background after the first session, and keeps
the Newton connected. The next F5 starts right away: no second tap on
Connect. Text the Newton prints between sessions appears in the **NewtonScript
Debug Server** output. **NewtonScript: Stop the Debug Server** ends it and
disconnects the Newton; so does quitting VS Code.

**Einstein.** Einstein's serial port connects to `newtc` over TCP. Its
default (Serial Port Driver: TCP client, 127.0.0.1, port 3679) is what
`"target": "tcp"` expects:

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Run on Einstein",
  "program": "${workspaceFolder}/MyApp.pkg",
  "target": "tcp"
}
```

**A MessagePad on a serial port.** Connect the Newton's serial cable (with a
USB serial adapter), and find its device with `ls /dev/cu.*`:

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Run on a MessagePad",
  "program": "${workspaceFolder}/MyApp.pkg",
  "target": "serial:/dev/cu.usbserial-0001@38400"
}
```

New App Project puts all three configurations into `.vscode/launch.json`.
In an existing `launch.json`, **Add Configuration...** offers them as
snippets (**NewtonScript: Run on Einstein**, **NewtonScript: Run on a
MessagePad**, ...).

**A package that hasn't changed** since its last upload isn't uploaded
again, so its `InstallScript` doesn't run again. `"reinstall": true` uploads
it anyway (some apps reset their state in the `InstallScript`). To stop at
the start of an `InstallScript`, check **Break in InstallScript** in the
Breakpoints view, or set a breakpoint in it.

**Attach** debugs what already runs on the Newton. Nothing is installed or
run (snippet **NewtonScript: Attach to Einstein**):

```json
{
  "type": "newtonscript",
  "request": "attach",
  "name": "Attach to Einstein",
  "target": "tcp",
  "program": "${workspaceFolder}/MyApp.pkg"
}
```

`program` is optional: the package installed there, built with debug
information (F7) or with a debug map (`debugMap`), for its source lines and
breakpoints. Without it you still get the Debug Console, exceptions, and
stops at `BreakLoop()`. Disconnecting removes the breakpoints, and the
Newton goes on.

### Launch settings

| Setting | |
| --- | --- |
| `program` | What to run: a NewtonScript file (`.ns`), or a package (`.pkg`). A package the project builds is built first. |
| `target` | Run on a Newton: `"tcp"` (Einstein), `"tcp:<port>"`, or `"serial:<device>[@<bps>]"` (38400 bps unless given). Without it: in newtc. |
| `reinstall` | With `target`: upload the package even if it is unchanged on the Newton. |
| `debugMap` | For a decompiled package: its debug map (`app_dec.nsdbg`). Default: the `.nsdbg` with the package's name next to it (`app.nsdbg`). |
| `args` | More `newtc` arguments, e.g. `["-store", "${workspaceFolder}/MyApp.store"]` (see [Newton apps](#newton-apps)). |
| `newtc` | A different `newtc` for this configuration. |
| `log` | Write all Debug Adapter Protocol messages to this file. |

## Writing an app

An app's source says only what differs from a sane default, in NTK's style,
and `newtc -build` makes the package from it. New App Project writes a
small app to start from:

```
newtAppName := "MyApp:SIG";            // the package's name (required)
newtAppLabel := "MyApp";               // its name in Extras
newtAppIcon := MakeIconFromPNG({file: "icon.png", depth: 4});

newt.theForm := {_proto: protoFloatNGo,
                 viewBounds: {left: 0, top: 50, right: 200, bottom: 130}};

greeting := {_proto: protoStaticText, text: "Hello",
             viewBounds: {left: 10, top: 10, right: 190, bottom: 30}};
AddStepForm(newt.theForm, greeting);              // a child of the app's view
StepDeclare(newt.theForm, greeting, 'greeting);   // its scripts find it as greeting
```

What you can set (all but the name have defaults):

| Global | Default | |
|---|---|---|
| `newtAppName` | (required) | The package's name, `"Name:Signature"` |
| `newtAppSymbol` | the name, as a symbol | The app's symbol |
| `newtAppLabel` | the name up to `:` | Its name in Extras |
| `newtAppIcon` | none | `MakeIconFromPNG(...)` |
| `newtAppHighlightedIcon` | none | The icon when it is highlighted (selected) |
| `newtAppVersion` | `1` | |
| `newtAppCopyright` | `""` | |
| `newt.theForm` | a protoFloatNGo | The app's base view |
| `newt.InstallScript`, `newt.RemoveScript` | none | As in NTK |

Things to know:
- NTK's names for protos and constants work (`protoFloatNGo`,
  `vjParentCenterH`, `vfPen(2)`, ...): `newtc` has the NewtonOS 2.1 platform
  built in. With NTK's platform file in the setting `vsnewt.platform`, that
  file is used instead (it also has protos the built-in one leaves out, like
  the mail protos). Once `newtAppName` is set, `kAppSymbol`, `kAppName` (the label),
  `kAppString`, and `kPackageName` are there too, as in NTK.
- `newtc` runs the file one statement at a time, so a `local` doesn't reach
  the next statement. Use globals (`greeting := ...`) or `constant`.
- Icons and pictures come from PNG files: `MakeIconFromPNG("icon.png")`,
  `MakeBitmapFromPNG("picture.png")`, or with options:
  `{file: "icon.png", depth: 4, dither: true, mask: 'calculate}`. Depth 1
  is black and white (every Newton), 4 adds 16 grays. The mask comes from
  the PNG's transparency (`'picture`), from the edges to the first black
  pixel (`'calculate`), or is left out (`'none`), as NTK's choices.
- A source without `newtAppName` is built the older way: it **returns the
  package**, a frame with the package's name and its parts
  (`return {signature: 'package0, name: "MyApp:SIG", part: [...]};`).

### More than one file

`Load("file.ns")` runs another source file, statement by statement, as if
it were part of the calling one. Its constants, globals, and global
functions are there for the statements after the `Load`. A relative name is
looked for next to the file that calls `Load`. That way you can keep views
or scripts in files of their own:

```
// buttons.ns
helloButton := {
  _proto: protoTextButton, text: "Say Hello",
  viewBounds: {left: 50, top: 40, right: 150, bottom: 60},
  buttonClickScript: func() Print("Hello")
};
AddStepForm(newt.theForm, helloButton);

// MyApp.ns, the project's main file (vsnewt.main)
newtAppName := "MyApp:SIG";
Load("buttons.ns");
```

F7 builds the package from all of them. An error in a loaded file shows up
in that file and stops the build, and breakpoints in a loaded file work
like in the main file. `Load` is for building on the Mac: a `.ns` program
that runs on a Newton (`"target"`) can't load files, so build a package
instead.

## Debugging an existing package

The second use: look inside a package you have no source for. `newtc`
decompiles it into a readable source file, and the debugger runs the
**original, unchanged package** against that source. Set breakpoints in it,
step through it, and look at locals, values, and the stack.

1. Right click the package in the Explorer and choose **NewtonScript:
   Decompile a Package for Debugging...** (or run it from the Command
   Palette and pick the package).
2. Set breakpoints in the decompiled source that opens.
3. Press **F5**.

Decompiling `app.pkg` writes two files next to it:
- `app_dec.ns`, the decompiled source;
- `app_dec.nsdbg`, the debug map: where each of the package's functions is
  in `app_dec.ns`.

`app.pkg` itself is never changed.

**Don't edit the decompiled source.** The debug map points at its lines, so
an edit moves everything below it, and breakpoints and the stack would show
the wrong lines. VS Code opens it read-only (the setting
`files.readonlyInclude` gets `**/*_dec.ns`). If it was changed anyway, F5
says so and offers to decompile again. To change the app instead, copy the
source and build your own package from it (see [Writing an
app](#writing-an-app)).

In a folder, the command also adds two configurations to `launch.json`:
**Debug app** (in newtc) and **Debug app on Einstein**. Pick one in the **Run
and Debug** view; F5 then runs it. Without a `launch.json`, F5 with
`app_dec.ns` in the editor debugs `app.pkg` in newtc. For a MessagePad, add
a `"target"` as in [On a Newton](#on-a-newton):

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Debug app on Einstein",
  "program": "${workspaceFolder}/app.pkg",
  "debugMap": "${workspaceFolder}/app_dec.nsdbg",
  "target": "tcp"
}
```

On a Newton, **attach** works with a decompiled package too: give the
installed package as `program` and its `debugMap`.

## Newton apps

In `newtc`, a package's app opens in a desktop window, drawn at the Mac's
resolution. The mouse is the pen.

- Views with their frames and fills, text in the Newton's fonts, pictures
  and icons, shapes and `viewDrawScript`s.
- Taps, drags, hiliting, buttons, checkboxes, pickers and popup menus; a tap
  that no view takes is recognized as a tap gesture (`viewGestureScript`).
- Timers (`AddDelayedCall` and friends, `viewIdleScript`) and modal dialogs.
- Soups. They are kept between runs if you give `newtc` a store file:
  `"args": ["-store", "${workspaceFolder}/app.store"]`. Without one, every run
  starts with an empty store.
- **Cmd-=** and **Cmd--** scale the window.

nBattleship 1.4 plays to the end. The Newton's fonts are stood in for by
Mac fonts (Espy Sans by Geneva and Verdana); the handwriting font Casual
needs **Apple Casual** installed on the Mac, else another font is used.

## NewtPlay: packages without VS Code

NewtPlay is a Mac app that runs Newton packages: the same `newtc`, for
anyone, without VS Code. Download `NewtPlay-<version>-macOS.zip` from the
[Releases](https://github.com/MatthiasWM/VSNewt/releases) page, unzip it,
and move `NewtPlay.app` to Applications. It is signed and notarized, for
macOS 13 or later on Apple Silicon and Intel Macs.

- Double-click a package (`.nspkg`, `.newtonpkg`), drop one on NewtPlay or
  its Dock icon, or choose one in its window (**Run a Package...**, or
  **Recent** for the last ten).
- `.pkg` files open too (Open With, a drop, or **Run a Package...**), but
  macOS takes a downloaded `.pkg` for an installer and checks it first;
  renamed to `.nspkg` it opens with a double click.
- Each package keeps its data in
  `~/Library/Application Support/NewtPlay/<package name>/`, one store for
  each version of the package.
- **Make a Shortcut...** puts a small app next to the package that runs it
  with NewtPlay; **Make an App...** one with NewtPlay inside, which runs
  without it. Both are made (and signed) on your Mac, with the package's
  own icon; the **File** menu makes them for the package that runs.
- If a package stops while it starts (often data from another version of
  it), NewtPlay says why and can start it again with new data; the old
  data is kept.

## Commands

In the Command Palette, under **NewtonScript**:

- **New App Project**: an app, its settings, and a `launch.json` in the open
  folder (or one you pick). Existing files are kept.
- **Build the Package** (**F7**): see [Build](#build-f7).
- **Decompile a Package for Debugging...**: see [Debugging an existing
  package](#debugging-an-existing-package). Also in the Explorer's context
  menu of a package.
- **Save the newtc App for the Newton...**: `newtc.pkg`, to install on the
  Newton once.
- **Stop the Debug Server**: ends the `newtc` that keeps the Newton
  connected.
- **Compile with VSNewt** (and **for debugging**): the current file to a
  package (`newtc -build <file> -opkg <file>.pkg`, or `-script` for a
  source that returns the package frame; with `-g`).
- **Compile NSOF with VSNewt** (and **for debugging**): to an NSOF file
  (`-onsof`).
- **Run NSOF with VSNewt**, **Debug NSOF with VSNewt**: `newtc -nsof <file>
  -run` or `-dbg`.

## Settings

- `vsnewt.main`: the project's main source, relative to the workspace folder
  (e.g. `MyApp.ns`). F7 builds it, and F5 without a `launch.json` runs its
  package.
- `vsnewt.newtcPath`: the `newtc` to use, e.g. your own build. Empty: the one
  that comes with the extension.
- `vsnewt.platform`: an NTK platform file (e.g. NTK's `Platforms/Newton 2.1`)
  for builds and debug sessions instead of `newtc`'s built-in NewtonOS 2.1
  platform (`newtc -platform`). Only needed for what only NTK's file has,
  like the mail protos. A relative path is from the workspace folder.

## Known limitations

- macOS on Apple Silicon only, for now.
- A MessagePad on a serial port works like Einstein, but hasn't been tried
  on real hardware yet; 38400 bps for now.
- On a Newton, the Debug Console evaluates only while the program is
  stopped (at a breakpoint, an exception, or `BreakLoop()`), and **Pause**
  doesn't work there yet.
- NTK's platform functions that read its Mac resources (sounds, PICTs,
  `MakeExtrasIcons`) and units (`DefineUnit`, ...) aren't there; use
  `MakeIconFromPNG` and `MakeBitmapFromPNG` for pictures.
- In newtc: no Newton screen around the apps (one app runs, in its own
  window, without the Extras drawer, the notepad, or the built-in apps), no
  handwriting or shape recognition, no keyboard input yet; taps are the only
  gesture.
- `-run` doesn't run NSOF files yet.
- Many built-in functions of the Newton ROM are not implemented in newtc
  yet. When a program calls one, `newtc` says so once in the Debug Console
  (`Fsin is not implemented yet ..., returns nil`). On a Newton, they all
  work.

## Development

- Open this folder in VS Code and start **Run Extension (samples)**: a second
  window opens the `samples` folder; open `hello.ns` there and press F5.
- `newtc` is built in the newton-framework repository:
  `Matt/tools/build_vsnewt_newtc.sh` builds it for release and copies it to
  `bin/darwin-arm64/newtc`.
- The grammar is generated: `scripts/make_grammar.py` (built-in function
  names from `newtc`), its test by `scripts/make_grammar_test.py`.
- Tests: `npm test` (debug sessions in VS Code; `NEWTC=/path/to/newtc npm
  test` uses that `newtc`, and runs the tests that need a current one) and
  `npm run test:grammar`.
- To debug `newtc` itself while VS Code talks to it: run `newtc -dap-server
  4711` (e.g. in lldb), then start a configuration with `"debugServer": 4711`
  (snippet **NewtonScript: Connect to newtc -dap-server**).
- Package: `npm run package` writes `vsnewt-darwin-arm64-<version>.vsix`.

## License

MIT, see [LICENSE](LICENSE).
