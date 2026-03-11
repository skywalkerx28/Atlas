/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import cp from 'child_process';

const signCommand = process.env['ATLAS_WIN32_SIGN_COMMAND'];
const targetPath = process.argv[2];

if (!targetPath) {
	console.error('Atlas sign helper expected a file path from Inno Setup.');
	process.exit(1);
}

if (!signCommand) {
	console.error('Atlas removed the upstream Microsoft ESRP signing integration.');
	console.error('Set ATLAS_WIN32_SIGN_COMMAND to a custom signer or run the packaging task without --sign.');
	process.exit(1);
}

const result = cp.spawnSync(signCommand, [targetPath], {
	shell: true,
	stdio: 'inherit'
});

if (typeof result.status === 'number') {
	process.exit(result.status);
}

if (result.error) {
	console.error(result.error);
}

process.exit(1);
