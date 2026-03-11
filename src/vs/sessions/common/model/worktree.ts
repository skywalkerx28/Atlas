/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export interface IWorktreeState {
	readonly worktreePath: string;
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly branch: string | undefined;
	readonly baseRef: string | undefined;
	readonly headSha: string | undefined;
	readonly workingTreeClean: boolean | undefined;
	readonly mergeReady: boolean | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number | undefined;
	readonly updatedAt: number | undefined;
}
