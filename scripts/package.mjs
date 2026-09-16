import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const packageProcess = spawn(command, ['package', '--allow-missing-repository'], {
	stdio: ['pipe', 'pipe', 'pipe'],
});

let answered = false;
const forwardOutput = (stream, output) => {
	stream.on('data', (chunk) => {
		const text = chunk.toString();
		output.write(text);
		if (!answered && text.includes('Do you want to continue?')) {
			answered = true;
			packageProcess.stdin.write('y\n');
		}
	});
};

forwardOutput(packageProcess.stdout, process.stdout);
forwardOutput(packageProcess.stderr, process.stderr);

packageProcess.on('error', (error) => {
	console.error(`Unable to run vsce: ${error.message}`);
	process.exitCode = 1;
});

packageProcess.on('close', (code) => {
	process.exitCode = code ?? 1;
});