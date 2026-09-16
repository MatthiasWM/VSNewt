# VSNewt

VSNewt is a VS Code extension that runs a bundled native compiler.

## Requirements

VS Code 1.137.0 or newer. A compiler binary must be installed in the platform directory described below before the extension is packaged.

## Add compiler binaries

Place the executable supplied by your compiler project at the matching path:

| Platform | Path |
| --- | --- |
| Windows x64 | `bin/win32-x64/compiler.exe` |
| Linux x64 | `bin/linux-x64/compiler` |
| macOS Apple Silicon | `bin/darwin-arm64/compiler` |
| macOS Intel | `bin/darwin-x64/compiler` |

The extension selects the path using Node's `process.platform` and `process.arch`. Linux and macOS binaries must be executable:

```sh
chmod +x bin/linux-x64/compiler bin/darwin-arm64/compiler bin/darwin-x64/compiler
```

The package command runs `newtc -script <source> -opkg <output>`. The source argument may be a path or a VS Code URI. If no source is supplied, the active editor is used. If no output is supplied, a `.pkg` file is created beside the source. For example, another extension or an integration test can invoke it with `vscode.commands.executeCommand('vsnewt.compile', inputPath, outputPath)`.

The generate package command runs `newtc -g -script <source> -opkg <output>` and is available as `VSNewt: Compile with VSNewt (Generate)`.

To create an executable NSOF binary, use `VSNewt: Compile NSOF with VSNewt`. It runs `newtc -script <source> -onsof <output>` and defaults the output to a `.nsof` file beside the source. The resulting `.nsof` file can be started with `VSNewt: Run NSOF with VSNewt`, which runs `newtc -nsof <file> -run`, or with `VSNewt: Debug NSOF with VSNewt`, which runs `newtc -nsof <file> -dbg`.

The generate NSOF command runs `newtc -g -script <source> -onsof <output>` and is available as `VSNewt: Compile NSOF with VSNewt (Generate)`.

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
* **VSNewt: Compile with VSNewt (Generate)** creates a package with `-g -opkg`.
* **VSNewt: Compile NSOF with VSNewt** creates an executable NSOF binary with `-onsof`.
* **VSNewt: Compile NSOF with VSNewt (Generate)** creates an executable NSOF binary with `-g -onsof`.
* **VSNewt: Run NSOF with VSNewt** executes an NSOF binary with `-run`.
* **VSNewt: Debug NSOF with VSNewt** executes an NSOF binary with `-dbg`.
