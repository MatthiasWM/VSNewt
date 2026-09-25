# VSNewt

VSNewt is a VS Code extension that handles NewtonScript compilation. It
provides a command to compile the current file with 'newtc'.

## Requirements

A compiler binary must be installed in the platform directory described below before the extension is packaged.

## Add compiler binaries

Place the executable supplied by your compiler project at the matching path:

| Platform | Path |
| --- | --- |
| Windows x64 | `bin/win32-x64/newtc.exe` |
| Linux x64 | `bin/linux-x64/newtc` |
| macOS Apple Silicon | `bin/darwin-arm64/newtc` |
| macOS Intel | `bin/darwin-x64/newtc` |

The extension selects the path using Node's `process.platform` and `process.arch`. Linux and macOS binaries must be executable:

```sh
chmod +x bin/linux-x64/newtc bin/darwin-arm64/newtc bin/darwin-x64/newtc
```

The package command runs `newtc -script <source> -opkg <output>`. The source argument may be a path or a VS Code URI. If no source is supplied, the active editor is used. If no output is supplied, a `.pkg` file is created beside the source. For example, another extension or an integration test can invoke it with `vscode.commands.executeCommand('vsnewt.compile', inputPath, outputPath)`.

To create an NSOF binary, use `VSNewt: Compile NSOF with VSNewt`. It runs `newtc -script <source> -onsof <output>` and defaults the output to a `.nsof` file beside the source. The resulting `.nsof` file can be started with `VSNewt: Run NSOF with VSNewt`, which runs `newtc -nsof <file> -run`, or with `VSNewt: Debug NSOF with VSNewt`, which runs `newtc -nsof <file> -dbg`.

## Run and debug NewtonScript

Press **F5** in a NewtonScript file (`.ns`, `.newt`, `.newtonscript`) and
pick **NewtonScript**: VS Code starts `newtc -dap` and runs the file. Its
output appears in the **Debug Console**. All debugger logic is in `newtc`
(Debug Adapter Protocol); the extension only tells VS Code how to start it.
Without a `launch.json`, F5 runs the file in the active editor. A launch
configuration looks like this:

```json
{
  "type": "newtonscript",
  "request": "launch",
  "name": "Run NewtonScript file",
  "program": "${file}"
}
```

Optional: `"newtc": "/path/to/newtc"` for this configuration only.

Stepping, breakpoints, and variables come step by step with `newtc`
(bytecode level first, then source level).

## Using a development build of newtc

Set **VSNewt: Newtc Path** (`vsnewt.newtcPath`) in the user settings to the
`newtc` you build, e.g. `/path/to/newton-framework/build/VSCode/newtc`. It is
used for debugging and the compile commands. Empty: the bundled binary.

To work on the extension: open this folder in VS Code and start **Run
Extension (samples)**. A second VS Code window (Extension Development Host)
opens the `samples` folder; open `hello.ns` there and press F5.

Tests: `npm test` also starts a debug session. `NEWTC=/path/to/newtc npm test`
uses that newtc.

## Build and package

Install dependencies, add the binaries, and create the VSIX:

```sh
npm install
npm run package
```

The generated `vsnewt-0.0.1.vsix` file can be installed in VS Code with **Extensions: Install from VSIX...**. The native binaries under `bin/` are included automatically.

## Commands

* **VSNewt: Hello World** displays a test message.
* **VSNewt: Compile with VSNewt** creates a package with `-opkg`.
* **VSNewt: Compile with VSNewt for debugging** creates a package with `-g -opkg`.
* **VSNewt: Compile NSOF with VSNewt** creates an executable NSOF binary with `-onsof`.
* **VSNewt: Compile NSOF with VSNewt for debugging** creates an executable NSOF binary with `-g -onsof`.
* **VSNewt: Run NSOF with VSNewt** executes an NSOF binary with `-run`.
* **VSNewt: Debug NSOF with VSNewt** executes an NSOF binary with `-dbg`.
