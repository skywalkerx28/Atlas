/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const ATLAS_BRAND_NAME = 'Atlas';
export const ATLAS_COPYRIGHT_HOLDER = 'Atlas Contributors';
export const ATLAS_COPYRIGHT_NOTICE = 'Copyright (C) 2026 Atlas Contributors';

export const ATLAS_REMOVED_EXTENSIONS = new Set([
	'github',
	'github-authentication',
	'microsoft-authentication',
	'grunt',
	'gulp',
	'jake',
	'simple-browser',
	'tunnel-forwarding',
	'vscode-api-tests',
	'vscode-colorize-perf-tests',
	'vscode-colorize-tests',
	'vscode-test-resolver',
]);

export function isAtlasRemovedExtensionName(name: string): boolean {
	return ATLAS_REMOVED_EXTENSIONS.has(name);
}

export function isAtlasRemovedExtensionPath(value: string): boolean {
	const normalized = value.replace(/\\/g, '/');

	if (normalized === 'remote' || normalized.startsWith('remote/')) {
		return true;
	}

	for (const extension of ATLAS_REMOVED_EXTENSIONS) {
		if (normalized === `extensions/${extension}` || normalized.startsWith(`extensions/${extension}/`)) {
			return true;
		}
	}

	return false;
}
