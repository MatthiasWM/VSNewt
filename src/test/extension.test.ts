import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { compilerArguments, nsofCompilerArguments, nsofExecutionArguments, parseCompilerError } from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Parses compiler error output', () => {
		assert.deepStrictEqual(
			parseCompilerError('    File "/Users/matt/dev/nstest/test.ns"; Line 10 !!! Exception: -48601, syntax error'),
			{
				filePath: '/Users/matt/dev/nstest/test.ns',
				line: 10,
				code: '-48601',
				message: 'syntax error',
			},
		);
		assert.deepStrictEqual(
			parseCompilerError('File "C:\\project\\test.newt"; Line 3 !!! Exception: E100, unexpected token'),
			{
				filePath: 'C:\\project\\test.newt',
				line: 3,
				code: 'E100',
				message: 'unexpected token',
			},
		);
		assert.strictEqual(parseCompilerError('compiler finished successfully'), undefined);
	});

	// Debug sessions: VS Code runs newtc through the extension. Uses $NEWTC if
	// set (e.g. a development build), else the setting vsnewt.newtcPath, else
	// the bundled newtc. Returns the program's output and exit code.
	async function runSession(program: string, extra: Partial<vscode.DebugConfiguration> = {}): Promise<{ output: string; exitCode?: number }> {
		interface Message { type?: string; event?: string; body?: { output?: string; exitCode?: number } }
		let output = '';
		let exitCode: number | undefined;
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('newtonscript', {
			createDebugAdapterTracker: () => ({
				onDidSendMessage: (message: Message) => {
					if (message.type === 'event' && message.event === 'output') {
						output += message.body?.output ?? '';
					} else if (message.type === 'event' && message.event === 'exited') {
						exitCode = message.body?.exitCode;
					}
				},
			}),
		});
		const ended = new Promise<void>((resolve) => {
			const listener = vscode.debug.onDidTerminateDebugSession(() => {
				listener.dispose();
				resolve();
			});
		});
		try {
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Test', program, ...extra };
			if (process.env.NEWTC && !config.newtc) {
				config.newtc = process.env.NEWTC;
			}
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			await ended;
		} finally {
			tracker.dispose();
		}
		return { output, exitCode };
	}

	function writeProgram(): { directory: string; program: string } {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const program = path.join(directory, 'hello.ns');
		fs.writeFileSync(program, 'Print("Hello from newtc");\n');
		return { directory, program };
	}

	test('Runs a NewtonScript file in the debugger (newtc -dap)', async function () {
		this.timeout(20000);
		const { directory, program } = writeProgram();
		try {
			const { output, exitCode } = await runSession(program);
			assert.strictEqual(exitCode, 0, output);
			assert.ok(output.includes('"Hello from newtc"'), output);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('Writes the DAP messages to a log ("log": newtc -dap-log)', async function () {
		this.timeout(20000);
		const { directory, program } = writeProgram();
		const log = path.join(directory, 'dap.log');
		try {
			const { exitCode } = await runSession(program, { log });
			assert.strictEqual(exitCode, 0);
			const text = fs.readFileSync(log, 'utf8');
			assert.ok(text.startsWith('-> ') && text.includes('"command":"initialize"'), text);
			assert.ok(text.includes('<- ') && text.includes('"event":"terminated"'), text);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// For working on newtc: VS Code connects to `newtc -dap-server <port>`
	// (started here; in real use in a debugger). Needs $NEWTC.
	test('Connects to newtc -dap-server ("debugServer")', async function () {
		const newtc = process.env.NEWTC;
		if (!newtc) {
			this.skip();
		}
		this.timeout(20000);
		const port = await new Promise<number>((resolve) => {
			const server = net.createServer();
			server.listen(0, '127.0.0.1', () => {
				const address = server.address() as net.AddressInfo;
				server.close(() => resolve(address.port));
			});
		});
		const { directory, program } = writeProgram();
		const server = spawn(newtc as string, ['-dap-server', String(port)]);
		try {
			await new Promise<void>((resolve, reject) => {
				server.stderr.on('data', (data: Buffer) => {
					if (data.toString().includes('waiting for a DAP client')) {
						resolve();
					}
				});
				server.on('exit', () => reject(new Error('newtc -dap-server exited')));
			});
			const exited = new Promise<number | null>((resolve) => server.on('exit', (code) => resolve(code)));
			const { output, exitCode } = await runSession(program, { debugServer: port });
			assert.strictEqual(exitCode, 0, output);
			assert.ok(output.includes('"Hello from newtc"'), output);
			assert.strictEqual(await exited, 0);
		} finally {
			server.kill();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// At a stop, a function compiled from the file (newtc -dap compiles with
	// line tables) points at its line in the file; a function without a file
	// (made with Compile) at its bytecode listing, a virtual document in the
	// newtonscript-bytecode language.
	test('Shows the source line, or a bytecode listing', async function () {
		this.timeout(20000);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const program = path.join(directory, 'stop.ns');
		fs.writeFileSync(program, [
			'global Halt(x) begin BreakLoop(); x + 1; end;',
			'DefGlobalFn(\'Halt2, call Compile("func(x) begin BreakLoop(); x + 2; end") with ());',
			'Print(Halt(41));',
			'Print(Halt2(40));',
			''].join('\n'));
		let stops = 0;
		let onStop: (session: vscode.DebugSession) => void = () => {};
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('newtonscript', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: { type?: string; event?: string }) => {
					if (message.type === 'event' && message.event === 'stopped') {
						stops++;
						onStop(session);
					}
				},
			}),
		});
		const nextStop = () => new Promise<vscode.DebugSession>((resolve) => { onStop = resolve; });
		try {
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Listing', program };
			if (process.env.NEWTC) {
				config.newtc = process.env.NEWTC;
			}
			let stopped = nextStop();
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			let session = await stopped;

			// source level: the file itself, line 1
			let trace = await session.customRequest('stackTrace', { threadId: 1 });
			let frame = trace.stackFrames[0];
			assert.strictEqual(frame.name, 'Halt');
			assert.strictEqual(fs.realpathSync(frame.source.path), fs.realpathSync(program));
			assert.strictEqual(frame.line, 1);

			// bytecode level: a listing
			stopped = nextStop();
			await session.customRequest('continue', { threadId: 1 });
			session = await stopped;
			trace = await session.customRequest('stackTrace', { threadId: 1 });
			frame = trace.stackFrames[0];
			assert.strictEqual(frame.name, 'Halt2');
			assert.ok(frame.source.sourceReference > 0, JSON.stringify(frame));
			// VS Code registers its provider for debug: documents when the debug
			// view comes up; a test runs before that, so open it and retry.
			await vscode.commands.executeCommand('workbench.view.debug');
			let document: vscode.TextDocument | undefined;
			for (let attempt = 0; !document && attempt < 40; attempt++) {
				try {
					document = await vscode.workspace.openTextDocument(vscode.debug.asDebugSourceUri(frame.source, session));
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			}
			assert.ok(document, 'could not open the listing');
			assert.strictEqual(document.languageId, 'newtonscript-bytecode');
			assert.ok(document.lineAt(frame.line - 1).text.includes('Pop'), document.getText());
			assert.strictEqual(stops, 2);

			const ended = new Promise<void>((resolve) => {
				const listener = vscode.debug.onDidTerminateDebugSession(() => {
					listener.dispose();
					resolve();
				});
			});
			await session.customRequest('continue', { threadId: 1 });
			await ended;
		} finally {
			tracker.dispose();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// A breakpoint set in the editor (a SourceBreakpoint) reaches newtc before
	// the program is compiled, stays pending, and stops the program at its
	// line once the code exists.
	test('Stops at a breakpoint set in the source file', async function () {
		this.timeout(20000);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const program = path.join(directory, 'lines.ns');
		fs.writeFileSync(program, [
			'global Twice(x)',
			'begin',
			'  local y := x * 2;',
			'  y;',
			'end;',
			'Print(Twice(21));',
			''].join('\n'));
		const breakpoint = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file(program), new vscode.Position(3, 0)));   // line 4
		vscode.debug.addBreakpoints([breakpoint]);
		let onStop: (session: vscode.DebugSession) => void = () => {};
		const stopped = new Promise<vscode.DebugSession>((resolve) => { onStop = resolve; });
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('newtonscript', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: { type?: string; event?: string }) => {
					if (message.type === 'event' && message.event === 'stopped') {
						onStop(session);
					}
				},
			}),
		});
		try {
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Lines', program };
			if (process.env.NEWTC) {
				config.newtc = process.env.NEWTC;
			}
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			const session = await stopped;
			const trace = await session.customRequest('stackTrace', { threadId: 1 });
			assert.strictEqual(trace.stackFrames[0].name, 'Twice');
			assert.strictEqual(trace.stackFrames[0].line, 4);
			const ended = new Promise<void>((resolve) => {
				const listener = vscode.debug.onDidTerminateDebugSession(() => {
					listener.dispose();
					resolve();
				});
			});
			await session.customRequest('continue', { threadId: 1 });
			await ended;
		} finally {
			tracker.dispose();
			vscode.debug.removeBreakpoints([breakpoint]);
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// A package as the program: newtc loads it with the debug map next to it
	// (written by -odecompile) and installs it; a breakpoint in the
	// decompiled source stops in its InstallScript. Needs $NEWTC (to make
	// the package).
	function writePackage(newtc: string): { directory: string; pkg: string; source: string; line: number } {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const pkg = path.join(directory, 'hello.pkg');
		const source = path.join(directory, 'hello.ns');
		spawnSync(newtc, ['-hello', '-opkg', pkg]);
		spawnSync(newtc, ['-pkg', pkg, '-odecompile', source]);
		const line = fs.readFileSync(source, 'utf8').split('\n').findIndex((text) => text.includes('if HasSlot(')) + 1;
		return { directory, pkg, source, line };
	}

	test('Debugs a package in its decompiled source', async function () {
		const newtc = process.env.NEWTC;
		if (!newtc) {
			this.skip();
		}
		this.timeout(20000);
		const { directory, pkg, source, line } = writePackage(newtc as string);
		const breakpoint = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file(source), new vscode.Position(line - 1, 0)));
		vscode.debug.addBreakpoints([breakpoint]);
		let output = '';
		let onStop: (session: vscode.DebugSession) => void = () => {};
		const stopped = new Promise<vscode.DebugSession>((resolve) => { onStop = resolve; });
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('newtonscript', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: { type?: string; event?: string; body?: { output?: string } }) => {
					if (message.type === 'event' && message.event === 'output') {
						output += message.body?.output ?? '';
					} else if (message.type === 'event' && message.event === 'stopped') {
						onStop(session);
					}
				},
			}),
		});
		try {
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Package', program: pkg, newtc };
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			const session = await stopped;
			const trace = await session.customRequest('stackTrace', { threadId: 1 });
			assert.ok(trace.stackFrames[0].name.endsWith('InstallScript'), trace.stackFrames[0].name);
			assert.strictEqual(trace.stackFrames[0].source.name, 'hello.ns');
			assert.strictEqual(trace.stackFrames[0].line, line);
			assert.ok(output.includes('2 of 2 functions found'), output);
			const ended = new Promise<void>((resolve) => {
				const listener = vscode.debug.onDidTerminateDebugSession(() => {
					listener.dispose();
					resolve();
				});
			});
			await session.customRequest('continue', { threadId: 1 });
			await ended;
		} finally {
			tracker.dispose();
			vscode.debug.removeBreakpoints([breakpoint]);
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// "args": newtc arguments before -dap; here they load the package and its
	// map for a program that uses it (ref0).
	test('Passes "args" to newtc', async function () {
		const newtc = process.env.NEWTC;
		if (!newtc) {
			this.skip();
		}
		this.timeout(20000);
		const { directory, pkg } = writePackage(newtc as string);
		const program = path.join(directory, 'call.ns');
		fs.writeFileSync(program, 'Print(ref0.part[0].data.text);\n');
		try {
			const { output, exitCode } = await runSession(program, { args: ['-pkg', pkg] });
			assert.strictEqual(exitCode, 0, output);
			assert.ok(output.includes('"Hello"'), output);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	// The Disassembly view: at a stop, VS Code asks newtc to "disassemble"
	// around the frame's instructionPointerReference.
	test('Opens the Disassembly view', async function () {
		this.timeout(20000);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const program = path.join(directory, 'disasm.ns');
		fs.writeFileSync(program, 'global Halt(x) begin BreakLoop(); x + 1; end;\nPrint(Halt(41));\n');
		interface Message { type?: string; event?: string; command?: string; success?: boolean;
			body?: { instructions?: { address: string; instruction: string; line?: number }[] } }
		const responses: Message[] = [];
		let onStop: (session: vscode.DebugSession) => void = () => {};
		const stopped = new Promise<vscode.DebugSession>((resolve) => { onStop = resolve; });
		let onDisassembled: () => void = () => {};
		const disassembled = new Promise<void>((resolve) => { onDisassembled = resolve; });
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('newtonscript', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: Message) => {
					if (message.type === 'event' && message.event === 'stopped') {
						onStop(session);
					} else if (message.type === 'response' && message.command === 'disassemble') {
						responses.push(message);
						onDisassembled();
					}
				},
			}),
		});
		try {
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Disasm', program };
			if (process.env.NEWTC) {
				config.newtc = process.env.NEWTC;
			}
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			const session = await stopped;
			await vscode.commands.executeCommand('debug.action.openDisassemblyView');
			await Promise.race([disassembled, new Promise((resolve) => setTimeout(resolve, 8000))]);
			// let the view finish (it asks more than once) before the session ends
			await new Promise((resolve) => setTimeout(resolve, 1000));
			assert.ok(responses.length > 0, 'VS Code asked for no disassembly');
			assert.ok(responses.every((response) => response.success), JSON.stringify(responses));
			const instructions = responses.flatMap((response) => response.body?.instructions ?? []);
			assert.ok(instructions.some((i) => i.instruction.startsWith('Call') && i.line === 1), JSON.stringify(instructions));
			const ended = new Promise<void>((resolve) => {
				const listener = vscode.debug.onDidTerminateDebugSession(() => {
					listener.dispose();
					resolve();
				});
			});
			await session.customRequest('continue', { threadId: 1 });
			await ended;
		} finally {
			tracker.dispose();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('Builds NSOF compiler and execution arguments', () => {
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const sourcePath = path.join(temporaryDirectory, 'test.ns');
		const packagePath = path.join(temporaryDirectory, 'test.pkg');
		const nsofPath = path.join(temporaryDirectory, 'test.nsof');
		fs.writeFileSync(sourcePath, '');
		fs.writeFileSync(nsofPath, '');

		try {
			assert.deepStrictEqual(compilerArguments(sourcePath, packagePath), ['-script', sourcePath, '-opkg', packagePath]);
			assert.deepStrictEqual(compilerArguments(sourcePath, packagePath, true), ['-g', '-script', sourcePath, '-opkg', packagePath]);
			assert.deepStrictEqual(nsofCompilerArguments(sourcePath, nsofPath), ['-script', sourcePath, '-onsof', nsofPath]);
			assert.deepStrictEqual(nsofCompilerArguments(sourcePath, nsofPath, true), ['-g', '-script', sourcePath, '-onsof', nsofPath]);
			assert.deepStrictEqual(nsofExecutionArguments(nsofPath), ['-nsof', nsofPath, '-run']);
			assert.deepStrictEqual(nsofExecutionArguments(nsofPath, true), ['-nsof', nsofPath, '-dbg']);
			assert.throws(() => nsofExecutionArguments(path.join(temporaryDirectory, 'missing.nsof')), /NSOF file not found/);
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});
});
