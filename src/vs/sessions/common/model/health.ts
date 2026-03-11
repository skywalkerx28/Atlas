/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export const enum PoolMode {
	Normal = 'normal',
	NatsDown = 'nats_down',
	DiskPressure = 'disk_pressure',
	CostCeiling = 'cost_ceiling',
	Paused = 'paused',
}

export interface IHealthState {
	readonly mode: PoolMode;
	readonly diskUsagePct: number;
	readonly memoryUsagePct: number;
	readonly walSizeBytes: number | undefined;
	readonly activeWorkers: number;
	readonly queueDepth: number;
	readonly attentionLevel: AttentionLevel;
	readonly lastHealthCheck: number | undefined;
}
