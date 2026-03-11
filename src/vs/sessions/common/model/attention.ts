/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EntityKind } from './selection.js';
import type { IAgentState } from './agent.js';
import type { IReviewGateState } from './review.js';
import type { ISwarmState } from './swarm.js';
import type { ITaskState } from './task.js';

export const enum AttentionLevel {
	Critical = 4,
	NeedsAction = 3,
	Active = 2,
	Idle = 1,
	Completed = 0,
}

export interface IAttentionFlag {
	readonly level: AttentionLevel;
	readonly reason: string;
	readonly entityKind: EntityKind;
	readonly entityId: string;
	readonly since: number;
}

export declare function computeAgentAttention(agent: IAgentState, idleThresholdMs: number): AttentionLevel;
export declare function computeTaskAttention(task: ITaskState, gate: IReviewGateState | undefined): AttentionLevel;
export declare function computeSwarmAttention(
	swarm: ISwarmState,
	children: {
		readonly tasks: readonly ITaskState[];
		readonly agents: readonly IAgentState[];
		readonly gates: readonly IReviewGateState[];
	}
): AttentionLevel;
