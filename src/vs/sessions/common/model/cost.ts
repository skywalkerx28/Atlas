/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export const enum CostScopeKind {
	Fleet = 'fleet',
	Objective = 'objective',
	Swarm = 'swarm',
	Task = 'task',
	Agent = 'agent',
}

export interface ICostBreakdown {
	readonly scopeKind: CostScopeKind;
	readonly scopeId: string;
	readonly spentUsd: number;
	readonly budgetUsd: number | undefined;
	readonly utilization: number | undefined;
}

export interface ICostState {
	readonly totalSpentUsd: number;
	readonly budgetCeilingUsd: number | undefined;
	readonly utilization: number | undefined;
	readonly burnRateUsdPerHour: number | undefined;
	readonly breakdowns: readonly ICostBreakdown[];
	readonly attentionLevel: AttentionLevel;
	readonly updatedAt: number | undefined;
}
