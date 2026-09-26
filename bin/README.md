# newtc binaries

The extension runs `bin/<platform>-<arch>/newtc` (Node's `process.platform`
and `process.arch`), unless the setting `vsnewt.newtcPath` names another one.

So far there is only `bin/darwin-arm64/newtc` (macOS 13 or later, Apple
Silicon). It is not in git: build it in the newton-framework repository with

```sh
Matt/tools/build_vsnewt_newtc.sh /path/to/VSNewt.git/vsnewt
```

which makes a Release build without sanitizers for macOS 13, checks that it
only uses system libraries, and copies it here. `npm run package` puts it
into the VSIX.
