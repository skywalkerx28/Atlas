/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	await runProcess(npm, ['run', 'electron']);
}

async function ensureCompiled() {
	const requiredOutputs = [
		'out/main.js',
		'extensions/git/out/main.js'
	];

	if (!(await exists('out')) || !(await Promise.all(requiredOutputs.map(exists))).every(Boolean)) {
		await runProcess(npm, ['run', 'compile']);
	}
}

async function ensureDarwinDirectLaunchBundle() {
	if (process.platform !== 'darwin') {
		return;
	}

	const product = JSON.parse(await fs.readFile(path.join(rootDir, 'product.json'), 'utf8')) as { nameLong: string };
	const resourcesDir = path.join(rootDir, '.build', 'electron', `${product.nameLong}.app`, 'Contents', 'Resources');
	const appPath = path.join(resourcesDir, 'app');
	const repoRelativePath = path.relative(appPath, rootDir) || '.';
	const bootstrapPath = path.join(appPath, 'bootstrap.cjs');
	const packageJsonPath = path.join(appPath, 'package.json');
	const bootstrap = `'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, ${JSON.stringify(repoRelativePath)});
process.chdir(repoRoot);
process.env.NODE_ENV ??= 'development';
process.env.VSCODE_DEV ??= '1';
process.env.VSCODE_CLI ??= '1';
process.env.ELECTRON_ENABLE_STACK_DUMPING ??= '1';
process.env.ELECTRON_ENABLE_LOGGING ??= '1';

if (process.argv.slice(1).every(arg => arg.startsWith('-'))) {
	process.argv.splice(1, 0, '.');
}

void import(pathToFileURL(path.join(repoRoot, 'out', 'main.js')).href);
`;

	await fs.rm(appPath, { recursive: true, force: true });
	await fs.mkdir(appPath, { recursive: true });
	await fs.writeFile(packageJsonPath, JSON.stringify({
		name: 'atlas-dev-launcher',
		private: true,
		main: './bootstrap.cjs'
	}, null, '\t') + '\n');
	await fs.writeFile(bootstrapPath, bootstrap);
}

async function main() {
	await ensureNodeModules();
	await getElectron();
	await ensureCompiled();
	await ensureDarwinDirectLaunchBundle();

	// Can't require this until after dependencies are installed
	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
