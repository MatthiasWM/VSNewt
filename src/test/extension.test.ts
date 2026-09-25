import * as assert from 'assert';
import { spawn } from 'child_process';
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
