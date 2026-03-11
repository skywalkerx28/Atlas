/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';
import { HandoffType } from './wire.js';

export const enum TaskStatus {
	Queued = 'queued',
	Executing = 'executing',
	Blocked = 'blocked',
	Reviewing = 'reviewing',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

export type TaskHandoffType = HandoffType;
export type TaskPriority = number;

export interface ITaskState {
	readonly taskId: string;
	readonly dispatchId: string | undefined;
	readonly parentTaskId: string | undefined;
	readonly objectiveId: string | undefined;
	readonly roleId: string;
	readonly fromRole: string | undefined;
	readonly toRole: string | undefined;
	readonly summary: string;
	readonly handoffType: TaskHandoffType | undefined;
	readonly status: TaskStatus;
	readonly priority: TaskPriority;
	readonly acceptance: readonly string[];
	readonly constraints: readonly string[];
	readonly artifacts: readonly string[];
	readonly memoryKeywords: readonly string[];
	readonly contextPaths: readonly string[];
	readonly dependsOn: readonly string[];
	// Derived from worker_registry/dispatch_queue joins; not a persisted task_hierarchy column.
	readonly assignedAgentId: string | undefined;
	// Derived from metrics/resource snapshots; not a dispatch_queue column.
	readonly costSpent: number;
	readonly attentionLevel: AttentionLevel;
	readonly enqueuedAt: number;
	readonly startedAt: number | undefined;
	readonly completedAt: number | undefined;
}

export interface ITaskQueue {
	readonly queuedTaskIds: readonly string[];
	readonly executingTaskIds: readonly string[];
	readonly reviewTaskIds: readonly string[];
	readonly blockedTaskIds: readonly string[];
	readonly completedTaskIds: readonly string[];
}
