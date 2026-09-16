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
