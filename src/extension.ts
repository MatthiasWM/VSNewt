// VSNewt: NewtonScript in VS Code. All the work is done by newtc (compiler,
// debugger); this file only starts it: the compile commands, and the
// debug adapter (newtc -dap).
import * as vscode from 'vscode';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
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

// What a run of newtc left: its exit code, the errors with a file and line
// (also shown in the Problems view), and its other error lines
// ("newtc: ERROR: ...").
export interface CompileResult {
	code: number | null;
	errors: { uri: vscode.Uri; line: number; message: string }[];
	messages: string[];
}

const newtcErrorPattern = /^newtc: ERROR: (.*)$/;

function runCompiler(extensionPath: string, args: string[], outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection, cwd?: string): Promise<CompileResult> {
	const result: CompileResult = { code: null, errors: [], messages: [] };

	let binaryPath: string;
	try {
		binaryPath = compilerPath(extensionPath);
	} catch (error) {
		vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
		return Promise.resolve(result);
	}

	cwd ??= vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
			const failure = newtcErrorPattern.exec(line);
			if (failure) {
				result.messages.push(failure[1]);
			}
			const error = parseCompilerError(line);
			if (!error) {
				continue;
			}

			// newtc names the file as it was given: relative to its cwd
			const fileUri = vscode.Uri.file(path.resolve(cwd ?? '', error.filePath));
			const fileDiagnostics = [...(diagnostics.get(fileUri) ?? [])];
			const lineIndex = Math.max(error.line - 1, 0);
			const message = `${error.message} (${error.code})`;
			fileDiagnostics.push(new vscode.Diagnostic(
				new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER),
				message,
				vscode.DiagnosticSeverity.Error,
			));
			diagnostics.set(fileUri, fileDiagnostics);
			result.errors.push({ uri: fileUri, line: lineIndex, message });
		}
	};
	return new Promise((resolve) => {
		const compiler = spawn(binaryPath, args, { cwd });
		compiler.stdout.on('data', appendCompilerOutput);
		compiler.stderr.on('data', appendCompilerOutput);
		compiler.on('error', (error) => outputChannel.appendLine(`Failed to start compiler: ${error.message}`));
		compiler.on('close', (code) => {
			if (pendingOutput) {
				appendCompilerOutput(Buffer.from(`${pendingOutput}\n`));
			}
			outputChannel.appendLine(`Compiler exited with code ${code ?? 'unknown'}.`);
			result.code = code;
			resolve(result);
		});
	});
}

// The project's main source: the setting vsnewt.main (relative to the
// workspace folder), else the NewtonScript file in the active editor.
function projectSource(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const main = vscode.workspace.getConfiguration('vsnewt', folder).get<string>('main', '').trim();
	if (main) {
		return path.resolve(folder?.uri.fsPath ?? '', main);
	}
	const document = vscode.window.activeTextEditor?.document;
	if (document && document.languageId === 'newtonscript' && document.uri.scheme === 'file') {
		return document.uri.fsPath;
	}
	return undefined;
}

// The package a source builds: next to it, with the same name.
export function packagePath(source: string): string {
	return `${source.slice(0, -path.extname(source).length)}.pkg`;
}

// F7: save, compile the project with debug information (-g) into its
// package. On errors, show the first one in the editor (F8 goes to the
// next). Resolves to whether the package was built.
async function buildProject(extensionPath: string, outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection): Promise<boolean> {
	const source = projectSource();
	if (!source) {
		vscode.window.showErrorMessage('Nothing to build: open a NewtonScript file, or set "vsnewt.main" (the project\'s main file) in the workspace settings.');
		return false;
	}
	// a decompiled package's source: F5 debugs the original package
	const decompiled = decompiledPackage(source);
	if (decompiled) {
		const replaces = sameFile(decompiled.pkg, packagePath(source));
		const choice = await vscode.window.showWarningMessage(
			`${path.basename(source)} is the decompiled source of ${path.basename(decompiled.pkg)}: F5 debugs the original package, there is nothing to build. `
			+ (replaces ? `Building replaces ${path.basename(decompiled.pkg)}.` : `Build ${path.basename(packagePath(source))} from it anyway?`),
			{ modal: true }, 'Build');
		if (choice !== 'Build') {
			return false;
		}
	}
	await vscode.workspace.saveAll(false);
	let args: string[];
	try {
		args = compilerArguments(source, packagePath(source), true);
	} catch (error) {
		vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
		return false;
	}
	const result = await runCompiler(extensionPath, args, outputChannel, diagnostics, path.dirname(source));
	if (result.errors.length > 0) {
		const first = result.errors[0];
		const editor = await vscode.window.showTextDocument(first.uri);
		const position = new vscode.Position(first.line, 0);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		vscode.window.setStatusBarMessage(`$(error) ${path.basename(source)}: ${first.message}`, 10000);
		return false;
	}
	if (result.code !== 0) {
		const notPackage = result.messages.some((message) => message.includes('Not a package'));
		vscode.window.showErrorMessage(notPackage
			? `${path.basename(source)} ran, but didn't return a package (a frame with the package's parts). Run a script with F5; F7 builds packages.`
			: `Building ${path.basename(source)} failed: ${result.messages.join(' ') || 'see the VSNewt Compiler output'}`);
		return false;
	}
	vscode.window.setStatusBarMessage(`$(check) Built ${path.basename(packagePath(source))}`, 5000);
	return true;
}

// Decompiled packages: `newtc -pkg X.pkg -odecompile X_dec.ns` writes the
// source and its debug map X_dec.nsdbg (the functions' lines in it). The
// debugger runs the original X.pkg with the map, so the source must not be
// edited: its lines would no longer match. It is read-only in VS Code.
const decompiledGlob = '**/*_dec.ns';

export function decompiledNames(pkg: string): { source: string; map: string } {
	const base = pkg.slice(0, -path.extname(pkg).length);
	return { source: `${base}_dec.ns`, map: `${base}_dec.nsdbg` };
}

// The same file? newtc writes real paths (macOS: /private/var for /var).
function sameFile(a: string, b: string): boolean {
	const real = (file: string): string => {
		try {
			return fs.realpathSync(file);
		} catch {
			return path.resolve(file);
		}
	};
	return real(a) === real(b);
}

// The source a debug map was written with (its "source"), if it can be read.
function mapSource(map: string): string | undefined {
	try {
		const source = JSON.parse(fs.readFileSync(map, 'utf8')).source;
		return typeof source === 'string' ? source : undefined;
	} catch {
		return undefined;
	}
}

// The package and map of a decompiled source: X_dec.ns (or X.ns, written in a
// terminal) whose map next to it names it, and X.pkg.
export function decompiledPackage(source: string): { pkg: string; map: string } | undefined {
	const base = source.slice(0, -path.extname(source).length);
	const map = `${base}.nsdbg`;
	const named = fs.existsSync(map) ? mapSource(map) : undefined;
	if (!named || !sameFile(named, source)) {
		return undefined;
	}
	for (const pkg of [`${base.replace(/_dec$/, '')}.pkg`, `${base}.pkg`]) {
		if (fs.existsSync(pkg)) {
			return { pkg, map };
		}
	}
	return undefined;
}

// A map's source changed after decompiling (saved, or edited in VS Code)?
// Then it is returned: the map's lines no longer match it.
export function editedSource(map: string): string | undefined {
	const source = mapSource(map);
	if (!source || !fs.existsSync(source) || !fs.existsSync(map)) {
		return undefined;
	}
	const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && sameFile(document.uri.fsPath, source));
	return open?.isDirty || fs.statSync(source).mtimeMs > fs.statSync(map).mtimeMs ? source : undefined;
}

// newtc -pkg <pkg> -odecompile <source>: the source and its map next to it,
// again if they exist (an open, edited source is reverted first).
async function runDecompiler(extensionPath: string, pkg: string, source: string, outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection): Promise<boolean> {
	const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && sameFile(document.uri.fsPath, source));
	if (open?.isDirty) {
		await vscode.window.showTextDocument(open);
		await vscode.commands.executeCommand('workbench.action.files.revert');
	}
	const result = await runCompiler(extensionPath, ['-pkg', pkg, '-odecompile', source], outputChannel, diagnostics, path.dirname(pkg));
	if (result.code !== 0) {
		vscode.window.showErrorMessage(`Can't decompile ${path.basename(pkg)}: ${result.messages.join(' ') || 'see the VSNewt Compiler output'}`);
		return false;
	}
	return true;
}

// The command: decompile a package (picked, or from the Explorer), make the
// source read-only, add launch configurations, open the source.
async function decompilePackage(extensionPath: string, outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection, uri?: vscode.Uri): Promise<void> {
	if (!uri) {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
			filters: { 'Newton package': ['pkg', 'newtonpkg', 'nspkg'] },
			openLabel: 'Decompile',
			title: 'NewtonScript: Decompile a Package for Debugging',
		});
		if (!picked) {
			return;
		}
		uri = picked[0];
	}
	const pkg = uri.fsPath;
	const { source, map } = decompiledNames(pkg);
	if (!await runDecompiler(extensionPath, pkg, source, outputChannel, diagnostics)) {
		return;
	}
	const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(source));
	if (folder) {
		// read-only: files.readonlyInclude
		const files = vscode.workspace.getConfiguration('files', folder);
		const readonly = { ...(files.inspect<Record<string, boolean>>('readonlyInclude')?.workspaceValue ?? {}) };
		if (!readonly[decompiledGlob]) {
			readonly[decompiledGlob] = true;
			await files.update('readonlyInclude', readonly, vscode.ConfigurationTarget.Workspace);
		}
		// launch configurations, in newtc and on Einstein
		const name = path.basename(pkg, path.extname(pkg));
		const relative = (file: string): string => `\${workspaceFolder}/${path.relative(folder.uri.fsPath, file).split(path.sep).join('/')}`;
		const launch = vscode.workspace.getConfiguration('launch', folder);
		const configurations = [...(launch.get<vscode.DebugConfiguration[]>('configurations') ?? [])];
		const added = [
			{ type: 'newtonscript', request: 'launch', name: `Debug ${name}`, program: relative(pkg), debugMap: relative(map) },
			{ type: 'newtonscript', request: 'launch', name: `Debug ${name} on Einstein`, program: relative(pkg), debugMap: relative(map), target: 'tcp' },
		].filter((config) => !configurations.some((existing) => existing.name === config.name));
		if (added.length > 0) {
			await launch.update('configurations', [...configurations, ...added], vscode.ConfigurationTarget.WorkspaceFolder);
		}
	}
	await vscode.window.showTextDocument(vscode.Uri.file(source));
	if (!folder) {
		await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
	}
	vscode.window.showInformationMessage(`${path.basename(source)} is ${path.basename(pkg)} decompiled, read-only: edits would move its lines. Set breakpoints and press F5; the debugger runs the original ${path.basename(pkg)}.`);
}

// newtc's Newton app ("newtc", newtc -connect-package): installed once on
// the Newton, its Connect button connects it to newtc for debugging.
async function saveConnectPackage(extensionPath: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
	const target = await vscode.window.showSaveDialog({
		defaultUri: folder ? vscode.Uri.joinPath(folder, 'newtc.pkg') : undefined,
		filters: { 'Newton package': ['pkg'] },
		saveLabel: 'Save newtc.pkg',
	});
	if (!target) {
		return;
	}
	let newtc: string;
	try {
		newtc = compilerPath(extensionPath);
	} catch (error) {
		vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
		return;
	}
	const run = spawnSync(newtc, ['-connect-package', target.fsPath], { encoding: 'utf8' });
	if (run.status !== 0) {
		vscode.window.showErrorMessage(`Can't write the newtc app: ${(run.stderr || run.stdout || '').trim()}`);
		return;
	}
	vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}. Install it on the Newton once (Einstein: drag it onto the Newton screen, or Platform > Install Package; a MessagePad: any package installer). It shows up in Extras as "newtc".`);
}

// Debugging on a Newton ("target"): newtc runs in the background as
// `newtc -dap-server <port>` and serves one debug session after the other,
// so the Newton stays connected between them. Started with the first such
// session, ended with VS Code (or the command Stop the Debug Server).
class NewtcServer {
	private process: ChildProcess | undefined;
	private key = '';
	private port = 0;

	constructor(private readonly output: vscode.OutputChannel) {}

	// The port of a server started with these arguments, started if needed.
	async ensure(newtc: string, args: string[]): Promise<number> {
		const key = JSON.stringify([newtc, args]);
		if (this.process && this.key === key) {
			return this.port;
		}
		this.stop();
		const port = await freePort();
		this.output.appendLine(`> ${newtc} ${[...args, '-dap-server', String(port)].join(' ')}`);
		const child = spawn(newtc, [...args, '-dap-server', String(port)]);
		this.process = child;
		this.key = key;
		this.port = port;
		child.on('exit', (code) => {
			this.output.appendLine(`newtc ended (${code ?? 'killed'}).`);
			if (this.process === child) {
				this.process = undefined;
			}
		});
		// ready when it says so on stderr
		await new Promise<void>((resolve, reject) => {
			let text = '';
			const timer = setTimeout(() => reject(new Error('newtc -dap-server did not start (see the output "NewtonScript Debug Server").')), 10000);
			const onData = (data: Buffer): void => {
				this.output.append(data.toString());
				text += data.toString();
				if (/waiting for a DAP client/.test(text)) {
					clearTimeout(timer);
					resolve();
				}
			};
			child.stdout?.on('data', (data: Buffer) => this.output.append(data.toString()));
			child.stderr?.on('data', onData);
			child.on('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.on('exit', () => {
				clearTimeout(timer);
				reject(new Error('newtc -dap-server ended right away (see the output "NewtonScript Debug Server").'));
			});
		});
		return port;
	}

	get running(): boolean {
		return this.process !== undefined;
	}

	stop(): void {
		this.process?.kill();
		this.process = undefined;
	}
}

// A TCP port no one listens on, for newtc -dap-server.
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

// Debugging: VS Code talks the Debug Adapter Protocol with `newtc -dap`.
// All debugger logic is in newtc; this only tells VS Code how to start it.
class NewtcDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	constructor(private readonly extensionPath: string, private readonly server: NewtcServer) {}

	async createDebugAdapterDescriptor(session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor> {
		// "debugServer": connect to a newtc started as `newtc -dap-server <port>`
		// (e.g. in lldb, to debug newtc itself)
		if (session.configuration.debugServer) {
			return new vscode.DebugAdapterServer(Number(session.configuration.debugServer));
		}
		const newtc = session.configuration.newtc || compilerPath(this.extensionPath);
		// "log": newtc writes all DAP messages to this file
		const log: string[] = session.configuration.log ? ['-dap-log', session.configuration.log] : [];
		// "args": more newtc arguments, before -dap
		const args: string[] = Array.isArray(session.configuration.args) ? session.configuration.args.map(String) : [];
		// "target": a Newton, through the background server
		if (session.configuration.target) {
			const starting = !this.server.running;
			const port = await this.server.ensure(newtc, [...log, ...args]);
			if (starting) {
				vscode.window.showInformationMessage(
					'newtc now runs in the background and keeps the Newton connected between debug sessions. On the Newton, tap "Connect" in the newtc app (in Extras).',
					'Get the newtc App').then((choice) => {
					if (choice) {
						vscode.commands.executeCommand('vsnewt.saveConnectPackage');
					}
				});
			}
			return new vscode.DebugAdapterServer(port);
		}
		return new vscode.DebugAdapterExecutable(newtc, [...log, ...args, '-dap']);
	}
}

// F5 without a launch.json: debug the package of a decompiled source in the
// active editor, else run the project's package (vsnewt.main), else the
// NewtonScript file in the active editor. A package that the project
// builds is built first (F7), and not run if that fails.
class NewtonScriptConfigurationProvider implements vscode.DebugConfigurationProvider {
	constructor(private readonly build: () => Promise<boolean>, private readonly decompile: (pkg: string, source: string) => Promise<boolean>) {}

	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const main = vscode.workspace.getConfiguration('vsnewt', folder).get<string>('main', '').trim();
			const editor = vscode.window.activeTextEditor;
			const decompiled = editor?.document.languageId === 'newtonscript' && editor.document.uri.scheme === 'file'
				? decompiledPackage(editor.document.uri.fsPath) : undefined;
			if (decompiled) {
				config.type = 'newtonscript';
				config.request = 'launch';
				config.name = `Debug ${path.basename(decompiled.pkg)}`;
				config.program = decompiled.pkg;
				config.debugMap = decompiled.map;
			} else if (main) {
				config.type = 'newtonscript';
				config.request = 'launch';
				config.name = 'Run the project';
				config.program = packagePath(path.resolve(folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', main));
			} else if (editor && editor.document.languageId === 'newtonscript') {
				config.type = 'newtonscript';
				config.request = 'launch';
				config.name = 'Run NewtonScript file';
				config.program = '${file}';
			}
		}
		// "attach" (to a Newton, "target") works without a program
		if (!config.program && config.request !== 'attach') {
			return vscode.window.showErrorMessage('Open a NewtonScript file to run, or set "program" (a .ns file or a .pkg) in launch.json.').then(() => undefined);
		}
		return config;
	}

	async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
		// a decompiled package: its source must be as decompiled
		if (typeof config.program === 'string' && path.extname(config.program).toLowerCase() !== '.ns') {
			const program = path.resolve(folder?.uri.fsPath ?? '', config.program);
			const map = typeof config.debugMap === 'string' ? path.resolve(folder?.uri.fsPath ?? '', config.debugMap) : `${program.slice(0, -path.extname(program).length)}.nsdbg`;
			const edited = editedSource(map);
			if (edited) {
				// decompiling again writes the map next to the source: this one?
				const again = sameFile(`${edited.slice(0, -path.extname(edited).length)}.nsdbg`, map);
				const choice = await vscode.window.showWarningMessage(
					`${path.basename(edited)} was changed after it was decompiled, so its lines no longer match ${path.basename(program)}: breakpoints and the stack would show the wrong lines.`,
					{ modal: true }, ...(again ? ['Decompile Again'] : []), 'Debug Anyway');
				if (!choice) {
					return undefined;
				}
				if (choice === 'Decompile Again' && !await this.decompile(program, edited)) {
					return undefined;
				}
			}
		}
		if (config.request === 'launch' && typeof config.program === 'string' && path.extname(config.program).toLowerCase() === '.pkg') {
			const source = projectSource();
			const program = path.resolve(folder?.uri.fsPath ?? '', config.program);
			// not a decompiled package (debugMap, or its .nsdbg next to it)
			const decompiled = config.debugMap || fs.existsSync(`${program.slice(0, -4)}.nsdbg`);
			if (source && !decompiled && path.resolve(packagePath(source)) === program) {
				if (!await this.build()) {
					return undefined;
				}
			}
		}
		return config;
	}
}

// A new app project in a folder: <Name>.ns from templates/app.ns, the
// setting vsnewt.main (F7 builds it, F5 runs it), and a launch.json for
// newtc, Einstein, and a MessagePad. Existing files are kept.
export function projectName(folder: string): string {
	const name = path.basename(folder).replace(/[^A-Za-z0-9]/g, '');
	return /^[A-Za-z]/.test(name) ? name : `App${name}`;
}

export function launchConfigurations(name: string): string {
	return `{
	// F5 runs the first one; pick another in the Run and Debug view.
	"version": "0.2.0",
	"configurations": [
		{
			// in newtc: the app in a window on the Mac
			"type": "newtonscript",
			"request": "launch",
			"name": "Run in newtc",
			"program": "\${workspaceFolder}/${name}.pkg"
		},
		{
			// on Einstein: its serial port connects to newtc over TCP (port 3679)
			"type": "newtonscript",
			"request": "launch",
			"name": "Run on Einstein",
			"program": "\${workspaceFolder}/${name}.pkg",
			"target": "tcp"
		},
		{
			// on a MessagePad: its serial cable (ls /dev/cu.* lists the ports)
			"type": "newtonscript",
			"request": "launch",
			"name": "Run on a MessagePad",
			"program": "\${workspaceFolder}/${name}.pkg",
			"target": "serial:/dev/cu.usbserial-0001@38400"
		}
	]
}
`;
}

async function newProject(extensionPath: string): Promise<void> {
	let folder = vscode.workspace.workspaceFolders?.[0]?.uri;
	const openAfterwards = !folder;
	if (!folder) {
		const picked = await vscode.window.showOpenDialog({
			canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
			openLabel: 'Create the Project Here',
			title: 'NewtonScript: New App Project (pick or make an empty folder)',
		});
		if (!picked) {
			return;
		}
		folder = picked[0];
	}
	const name = projectName(folder.fsPath);
	const source = path.join(folder.fsPath, `${name}.ns`);
	const launch = path.join(folder.fsPath, '.vscode', 'launch.json');
	const settings = path.join(folder.fsPath, '.vscode', 'settings.json');
	if (!fs.existsSync(source)) {
		const template = fs.readFileSync(path.join(extensionPath, 'templates', 'app.ns'), 'utf8');
		fs.writeFileSync(source, template.replace(/\$\{name\}/g, name).replace(/\$\{year\}/g, String(new Date().getFullYear())));
	}
	fs.mkdirSync(path.dirname(launch), { recursive: true });
	if (!fs.existsSync(launch)) {
		fs.writeFileSync(launch, launchConfigurations(name));
	}
	if (openAfterwards) {
		if (!fs.existsSync(settings)) {
			fs.writeFileSync(settings, `{\n\t"vsnewt.main": "${name}.ns"\n}\n`);
		}
		await vscode.commands.executeCommand('vscode.openFolder', folder);
		return;
	}
	await vscode.workspace.getConfiguration('vsnewt', folder).update('main', `${name}.ns`, vscode.ConfigurationTarget.WorkspaceFolder);
	await vscode.window.showTextDocument(vscode.Uri.file(source));
	vscode.window.showInformationMessage(`${name}.ns is your app. F7 builds ${name}.pkg, F5 runs it in newtc (Run and Debug: on Einstein or a MessagePad).`);
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {

	const output = vscode.window.createOutputChannel('VSNewt Compiler');
	context.subscriptions.push(output);
	const diagnostics = vscode.languages.createDiagnosticCollection('vsnewt');
	context.subscriptions.push(diagnostics);
	const serverOutput = vscode.window.createOutputChannel('NewtonScript Debug Server');
	context.subscriptions.push(serverOutput);
	const server = new NewtcServer(serverOutput);
	context.subscriptions.push({ dispose: () => server.stop() });
	const build = (): Promise<boolean> => buildProject(context.extensionPath, output, diagnostics);

	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(
		'newtonscript', new NewtcDebugAdapterFactory(context.extensionPath, server)));
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(
		'newtonscript', new NewtonScriptConfigurationProvider(build, (pkg, source) => runDecompiler(context.extensionPath, pkg, source, output, diagnostics))));

	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.build', build));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.saveConnectPackage', () => saveConnectPackage(context.extensionPath)));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.decompile', (uri?: vscode.Uri) => decompilePackage(context.extensionPath, output, diagnostics, uri)));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.newProject', () => newProject(context.extensionPath)));
	context.subscriptions.push(vscode.commands.registerCommand('vsnewt.stopDebugServer', () => {
		server.stop();
		vscode.window.setStatusBarMessage('newtc debug server stopped', 5000);
	}));
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
