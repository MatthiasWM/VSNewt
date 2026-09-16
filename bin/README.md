# Compiler binaries

Put the native compiler executable for each supported platform in the matching directory:

| Platform | Binary path |
| --- | --- |
| Windows x64 | `bin/win32-x64/newtc.exe` |
| Linux x64 | `bin/linux-x64/newtc` |
| macOS Apple Silicon | `bin/darwin-arm64/newtc` |
| macOS Intel | `bin/darwin-x64/newtc` |

The extension selects the directory using Node's `process.platform` and `process.arch` values. The executable is called as `newtc -script <source> -opkg <output>` and should write diagnostics to stdout or stderr.

On Linux and macOS, make the file executable before packaging:

```sh
chmod +x bin/linux-x64/newtc bin/darwin-arm64/newtc bin/darwin-x64/newtc
```

The binary files are included in the VSIX by `npm run package`. Add the real executables to this directory before running that command. The repository's `.gitignore` does not ignore `bin/`, so they can be checked in, or supplied by your release/build pipeline.