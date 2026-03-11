/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export const enum SwarmPhase {
	Planning = 'planning',
	Executing = 'executing',
	Reviewing = 'reviewing',
	Merging = 'merging',
	Completed = 'completed',
	Failed = 'failed',
}

export const enum SwarmLaneKind {
	Tasks = 'tasks',
	Agents = 'agents',
	Memory = 'memory',
	Worktrees = 'worktrees',
	Reviews = 'reviews',
	Artifacts = 'artifacts',
}

export interface ISwarmLane {
	readonly kind: SwarmLaneKind;
	readonly itemIds: readonly string[];
}

export interface ISwarmState {
	readonly swarmId: string;
	readonly rootTaskId: string;
	readonly objectiveId: string | undefined;
	readonly phase: SwarmPhase;
	readonly taskIds: readonly string[];
	readonly agentDispatchIds: readonly string[];
	readonly worktreePaths: readonly string[];
	readonly reviewDispatchIds: readonly string[];
	readonly memoryRecordCount: number;
	readonly costSpent: number;
	readonly costCeiling: number | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface ISwarmBoard {
	readonly swarmId: string;
	readonly phase: SwarmPhase;
	readonly lanes: readonly ISwarmLane[];
}
