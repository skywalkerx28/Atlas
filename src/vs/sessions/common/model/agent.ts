/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export const enum AgentRole {
	Planner = 'planner',
	Worker = 'worker',
	Judge = 'judge',
}

export const enum AgentStatus {
	Spawning = 'spawning',
	Running = 'running',
	Idle = 'idle',
	Blocked = 'blocked',
	Completed = 'completed',
	Failed = 'failed',
	TimedOut = 'timed_out',
}

export interface IAgentState {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly roleId: string;
	// Presentation state derived from raw worker_registry.state plus transcript/task context.
	readonly status: AgentStatus;
	readonly worktreePath: string | undefined;
	readonly pid: number | undefined;
	readonly startedAt: number;
	readonly lastHeartbeat: number;
	// Derived from role_id normalization; not a worker_registry column.
	readonly role: AgentRole;
	// Derived from daemon-side joins over dispatch/resource metrics; not a worker_registry column.
	readonly costSpent: number;
	// Derived from the activity stream JSONL; not a worker_registry column.
	readonly lastActivity: string | undefined;
	// Computed client-side from heartbeat/state transition data.
	readonly timeInState: number;
	readonly attentionLevel: AttentionLevel;
}

export interface IFleetState {
	readonly agents: readonly IAgentState[];
	readonly activeCount: number;
	readonly idleCount: number;
	readonly blockedCount: number;
	readonly failedCount: number;
	readonly totalCostSpent: number;
	readonly attentionLevel: AttentionLevel;
}
