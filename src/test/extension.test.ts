import * as assert from 'assert';
import * as fs from 'fs';
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

	// Starts a real debug session: VS Code runs `newtc -dap` through the
	// extension. Uses $NEWTC if set (e.g. a development build), else the
	// setting vsnewt.newtcPath, else the bundled newtc.
	test('Runs a NewtonScript file in the debugger (newtc -dap)', async function () {
		this.timeout(20000);
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsnewt-'));
		const program = path.join(temporaryDirectory, 'hello.ns');
		fs.writeFileSync(program, 'Print("Hello from newtc");\n');

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
			const config: vscode.DebugConfiguration = { type: 'newtonscript', request: 'launch', name: 'Test', program };
			if (process.env.NEWTC) {
				config.newtc = process.env.NEWTC;
			}
			assert.ok(await vscode.debug.startDebugging(undefined, config), 'debug session did not start');
			await ended;
			assert.strictEqual(exitCode, 0, output);
			assert.ok(output.includes('"Hello from newtc"'), output);
		} finally {
			tracker.dispose();
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
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
