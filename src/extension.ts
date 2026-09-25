// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// The newtc to run: the setting vsnewt.newtcPath (e.g. a development build),
// else the one that comes with the extension.
function compilerPath(extensionPath: string): string {
	const configured = vscode.workspace.getConfiguration('vsnewt').get<string>('newtcPath', '').trim();
	if (configured) {
		if (!fs.existsSync(configured)) {
			throw new Error(`newtc not found: ${configured} (setting vsnewt.newtcPath)`);
		}
		return configured;
	}

	const platform = process.platform;
	if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') {
		throw new Error(`Unsupported platform: ${platform}`);
	}

	const binaryName = platform === 'win32' ? 'newtc.exe' : 'newtc';
	const binaryPath = path.join(extensionPath, 'bin', `${platform}-${process.arch}`, binaryName);
	if (!fs.existsSync(binaryPath)) {
		throw new Error(`Compiler 'newtc' binary not found: ${binaryPath}`);
	}

	return binaryPath;
}

const sourceExtensions = new Set(['.ns', '.newt', '.newtonscript']);
const outputExtensions = new Set(['.pkg', '.newtonpkg']);
const nsofExtensions = new Set(['.nsof']);
const compilerErrorPattern = /^\s*File "([^"]+)"; Line (\d+) !!! Exception:\s*([^,]+),\s*(.+)$/;

export interface CompilerError {
	filePath: string;
	line: number;
	code: string;
	message: string;
}

export function parseCompilerError(line: string): CompilerError | undefined {
	const match = compilerErrorPattern.exec(line);
	if (!match) {
		return undefined;
	}

	return {
		filePath: match[1],
		line: Number(match[2]),
		code: match[3].trim(),
		message: match[4].trim(),
	};
}

function filePath(value: string | vscode.Uri): string {
	return value instanceof vscode.Uri ? value.fsPath : value;
}

function validateSourcePath(source: string | vscode.Uri): { path: string; extension: string } {
	const sourcePath = filePath(source);
	const sourceExtension = path.extname(sourcePath).toLowerCase();
	if (!sourceExtensions.has(sourceExtension)) {
		throw new Error('Source file must have a .ns, .newt, or .newtonscript extension.');
	}
	if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
		throw new Error(`Source file not found: ${sourcePath}`);
	}
	return { path: sourcePath, extension: sourceExtension };
}

export function compilerArguments(source: string | vscode.Uri, output?: string | vscode.Uri, generate = false): string[] {
	const validatedSource = validateSourcePath(source);

	const outputPath = output ? filePath(output) : `${validatedSource.path.slice(0, -validatedSource.extension.length)}.pkg`;
	if (!outputExtensions.has(path.extname(outputPath).toLowerCase())) {
		throw new Error('Output file must have a .pkg or .newtonpkg extension.');
	}

	return [ ...(generate ? ['-g'] : []), '-script', validatedSource.path, '-opkg', outputPath];
}

export function nsofCompilerArguments(source: string | vscode.Uri, output?: string | vscode.Uri, generate = false): string[] {
	const validatedSource = validateSourcePath(source);
	const outputPath = output ? filePath(output) : `${validatedSource.path.slice(0, -validatedSource.extension.length)}.nsof`;
	if (!nsofExtensions.has(path.extname(outputPath).toLowerCase())) {
		throw new Error('NSOF output file must have a .nsof extension.');
	}
	return [ ...(generate ? ['-g'] : []), '-script', validatedSource.path, '-onsof', outputPath];
}

export function nsofExecutionArguments(nsofFile: string | vscode.Uri, debug = false): string[] {
	const nsofPath = filePath(nsofFile);
	if (!nsofExtensions.has(path.extname(nsofPath).toLowerCase())) {
		throw new Error('NSOF input file must have a .nsof extension.');
	}
	if (!fs.existsSync(nsofPath) || !fs.statSync(nsofPath).isFile()) {
		throw new Error(`NSOF file not found: ${nsofPath}`);
	}
	return ['-nsof', nsofPath, debug ? '-dbg' : '-run'];
}

function runCompiler(extensionPath: string, args: string[], outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection): void {

	let binaryPath: string;
	try {
		binaryPath = compilerPath(extensionPath);
	} catch (error) {
		vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
		return;
	}

	outputChannel.clear();
	outputChannel.show(true);
	diagnostics.clear();
	let pendingOutput = '';
	const appendCompilerOutput = (data: Buffer): void => {
		const text = data.toString();
		outputChannel.append(text);
		pendingOutput += text;
		const lines = pendingOutput.split(/\r?\n/);
		pendingOutput = lines.pop() ?? '';
		for (const line of lines) {
			const error = parseCompilerError(line);
			if (!error) {
				continue;
			}

			const fileUri = vscode.Uri.file(error.filePath);
			const fileDiagnostics = [...(diagnostics.get(fileUri) ?? [])];
			const lineIndex = Math.max(error.line - 1, 0);
			fileDiagnostics.push(new vscode.Diagnostic(
				new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER),
				`${error.message} (${error.code})`,
				vscode.DiagnosticSeverity.Error,
			));
			diagnostics.set(fileUri, fileDiagnostics);
		}
	};
	const compiler = spawn(binaryPath, args, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
	compiler.stdout.on('data', appendCompilerOutput);
	compiler.stderr.on('data', appendCompilerOutput);
	compiler.on('error', (error) => outputChannel.appendLine(`Failed to start compiler: ${error.message}`));
	compiler.on('close', (code) => {
		if (pendingOutput) {
			appendCompilerOutput(Buffer.from(`${pendingOutput}\n`));
		}
		outputChannel.appendLine(`Compiler exited with code ${code ?? 'unknown'}.`);
	});
}

// Debugging: VS Code talks the Debug Adapter Protocol with `newtc -dap`.
// All debugger logic is in newtc; this only tells VS Code how to start it.
class NewtcDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	constructor(private readonly extensionPath: string) {}

	createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		// "debugServer": connect to a newtc started as `newtc -dap-server <port>`
		// (e.g. in lldb, to debug newtc itself)
		if (session.configuration.debugServer) {
			return new vscode.DebugAdapterServer(Number(session.configuration.debugServer));
		}
		const newtc = session.configuration.newtc || compilerPath(this.extensionPath);
		// "log": newtc writes all DAP messages to this file
		const log: string[] = session.configuration.log ? ['-dap-log', session.configuration.log] : [];
		return new vscode.DebugAdapterExecutable(newtc, [...log, '-dap']);
	}
}

// F5 without a launch.json: run the NewtonScript file in the active editor.
class NewtonScriptConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'newtonscript') {
				config.type = 'newtonscript';
				config.request = 'launch';
				config.name = 'Run NewtonScript file';
				config.program = '${file}';
			}
		}
		if (!config.program) {
			return vscode.window.showErrorMessage('Open a NewtonScript file to run, or set "program" in launch.json.').then(() => undefined);
		}
		return config;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(
		'newtonscript', new NewtcDebugAdapterFactory(context.extensionPath)));
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(
		'newtonscript', new NewtonScriptConfigurationProvider()));

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vsnewt" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vsnewt.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from VSNewt!');
	});

	context.subscriptions.push(disposable);

	const output = vscode.window.createOutputChannel('VSNewt Compiler');
	context.subscriptions.push(output);
	const diagnostics = vscode.languages.createDiagnosticCollection('vsnewt');
	context.subscriptions.push(diagnostics);
	const activeSource = (source?: string | vscode.Uri): string | vscode.Uri | undefined => source ?? vscode.window.activeTextEditor?.document.uri;
	const showCommandError = (error: unknown): void => {
		vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
	};
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.compile', (source?: string | vscode.Uri, outputPath?: string | vscode.Uri) => {
		const sourcePath = activeSource(source);
		if (!sourcePath) {
			vscode.window.showErrorMessage('Open a .ns, .newt, or .newtonscript source file, or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, compilerArguments(sourcePath, outputPath), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.compileGenerated', (source?: string | vscode.Uri, outputPath?: string | vscode.Uri) => {
		const sourcePath = activeSource(source);
		if (!sourcePath) {
			vscode.window.showErrorMessage('Open a .ns, .newt, or .newtonscript source file, or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, compilerArguments(sourcePath, outputPath, true), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.compileNsof', (source?: string | vscode.Uri, outputPath?: string | vscode.Uri) => {
		const sourcePath = activeSource(source);
		if (!sourcePath) {
			vscode.window.showErrorMessage('Open a .ns, .newt, or .newtonscript source file, or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, nsofCompilerArguments(sourcePath, outputPath), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.compileNsofGenerated', (source?: string | vscode.Uri, outputPath?: string | vscode.Uri) => {
		const sourcePath = activeSource(source);
		if (!sourcePath) {
			vscode.window.showErrorMessage('Open a .ns, .newt, or .newtonscript source file, or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, nsofCompilerArguments(sourcePath, outputPath, true), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.runNsof', (nsofFile?: string | vscode.Uri) => {
		const file = nsofFile ?? vscode.window.activeTextEditor?.document.uri;
		if (!file) {
			vscode.window.showErrorMessage('Open a .nsof file or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, nsofExecutionArguments(file), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.debugNsof', (nsofFile?: string | vscode.Uri) => {
		const file = nsofFile ?? vscode.window.activeTextEditor?.document.uri;
		if (!file) {
			vscode.window.showErrorMessage('Open a .nsof file or provide its path.');
			return;
		}
		try {
			runCompiler(context.extensionPath, nsofExecutionArguments(file, true), output, diagnostics);
		} catch (error) {
			showCommandError(error);
		}
	}));
}

// This method is called when your extension is deactivated
export function deactivate() {}
