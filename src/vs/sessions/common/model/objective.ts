/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';
import { WireDispatchPriority } from './wire.js';

export const enum ObjectiveStatus {
	Open = 'open',
	Planning = 'planning',
	Executing = 'executing',
	Reviewing = 'reviewing',
	Completed = 'completed',
	Failed = 'failed',
}

export interface IObjectiveSubmitOptions {
	readonly desiredOutcomes?: readonly string[];
	readonly constraints?: readonly string[];
	readonly contextPaths?: readonly string[];
	readonly successCriteria?: readonly string[];
	readonly playbookIds?: readonly string[];
	readonly priority?: WireDispatchPriority;
	readonly budgetCeilingUsd?: number;
	readonly maxParallelWorkers?: number;
	readonly operatorNotes?: readonly string[];
}

export interface IObjectiveState {
	readonly objectiveId: string;
	readonly problemStatement: string;
	readonly playbookIds: readonly string[];
	readonly desiredOutcomes: readonly string[];
	readonly constraints: readonly string[];
	readonly contextPaths: readonly string[];
	readonly successCriteria: readonly string[];
	readonly operatorNotes: readonly string[];
	readonly priority: WireDispatchPriority;
	readonly status: ObjectiveStatus;
	readonly rootTaskId: string | undefined;
	readonly resumeCount: number;
	readonly maxResumeCycles: number;
	readonly maxParallelWorkers: number | undefined;
	// Derived from child swarms; this is not a persisted objectives column.
	readonly costSpent: number;
	// Derived from ObjectiveSpec.budget_ceiling_usd in spec_json; not a top-level objectives column.
	readonly costCeiling: number | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly completedAt: number | undefined;
}

export interface IObjectiveBoard {
	readonly objectiveId: string;
	readonly swarmIds: readonly string[];
	readonly taskIds: readonly string[];
	readonly reviewDispatchIds: readonly string[];
	readonly mergeDispatchIds: readonly string[];
}
