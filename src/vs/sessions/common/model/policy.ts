/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export interface IPolicyState {
	readonly policyId: string;
	readonly roleId: string | undefined;
	readonly writableRoots: readonly string[];
	readonly allowedTools: readonly string[];
	readonly deniedTools: readonly string[];
	readonly grantedCapabilities: readonly string[];
	readonly writesEnabled: boolean;
	readonly costCeilingUsd: number | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly updatedAt: number | undefined;
}
