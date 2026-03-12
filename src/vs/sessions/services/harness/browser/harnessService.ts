/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { constObservable, IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { HarnessConnectionState, IHarnessConnectionInfo, IHarnessService } from '../common/harnessService.js';
import type { IHarnessTaskTree } from '../common/harnessTypes.js';

const WEB_UNAVAILABLE_ERROR = 'Harness daemon is unavailable in web sessions.';
const EMPTY_OBJECTIVES = constObservable(Object.freeze([]) as readonly AtlasModel.IObjectiveState[]);
const EMPTY_SWARMS = constObservable(Object.freeze([]) as readonly AtlasModel.ISwarmState[]);
const EMPTY_TASKS = constObservable(Object.freeze([]) as readonly AtlasModel.ITaskState[]);
const EMPTY_FLEET = constObservable(Object.freeze({
	agents: Object.freeze([]) as readonly AtlasModel.IAgentState[],
	activeCount: 0,
	idleCount: 0,
	blockedCount: 0,
	failedCount: 0,
	totalCostSpent: 0,
	attentionLevel: 1 as AtlasModel.IFleetState['attentionLevel'],
}) satisfies AtlasModel.IFleetState);
const EMPTY_HEALTH = constObservable(Object.freeze({
	mode: 'normal' as AtlasModel.IHealthState['mode'],
	diskUsagePct: 0,
	memoryUsagePct: 0,
	walSizeBytes: undefined,
	activeWorkers: 0,
	queueDepth: 0,
	attentionLevel: 1 as AtlasModel.IHealthState['attentionLevel'],
	lastHealthCheck: undefined,
}) satisfies AtlasModel.IHealthState);
const EMPTY_COST = constObservable(Object.freeze({
	totalSpentUsd: 0,
	budgetCeilingUsd: undefined,
	utilization: undefined,
	burnRateUsdPerHour: undefined,
	breakdowns: Object.freeze([]) as AtlasModel.ICostState['breakdowns'],
	attentionLevel: 1 as AtlasModel.ICostState['attentionLevel'],
	updatedAt: undefined,
}) satisfies AtlasModel.ICostState);
const EMPTY_REVIEWS = constObservable(Object.freeze([]) as readonly AtlasModel.IAdvisoryReviewEntry[]);
const EMPTY_GATES = constObservable(Object.freeze([]) as readonly AtlasModel.IReviewGateState[]);
const EMPTY_MERGES = constObservable(Object.freeze([]) as readonly AtlasModel.IMergeEntry[]);
const EMPTY_TRANSCRIPTS = constObservable(Object.freeze([]) as readonly AtlasModel.ITranscriptEntry[]);
const DISCONNECTED_STATE = constObservable<IHarnessConnectionInfo>({
	state: HarnessConnectionState.Disconnected,
	mode: 'none',
	writesEnabled: false,
	supportedWriteMethods: Object.freeze([]),
	daemonVersion: undefined,
	schemaVersion: undefined,
	grantedCapabilities: Object.freeze([]),
	errorMessage: WEB_UNAVAILABLE_ERROR,
});

export class HarnessService implements IHarnessService {
	declare readonly _serviceBrand: undefined;

	readonly connectionState = DISCONNECTED_STATE;
	readonly onDidDisconnect = Event.None;

	readonly objectives = EMPTY_OBJECTIVES;
	readonly swarms = EMPTY_SWARMS;
	readonly tasks = EMPTY_TASKS;
	readonly fleet = EMPTY_FLEET;
	readonly health = EMPTY_HEALTH;
	readonly cost = EMPTY_COST;
	readonly advisoryReviewQueue = EMPTY_REVIEWS;
	readonly reviewGates = EMPTY_GATES;
	readonly mergeQueue = EMPTY_MERGES;

	async connect(_workspaceRoot: URI): Promise<void> {
		return;
	}

	async disconnect(): Promise<void> {
		return;
	}

	async getObjective(_objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined> {
		return undefined;
	}

	async getSwarm(_swarmId: string): Promise<AtlasModel.ISwarmState | undefined> {
		return undefined;
	}

	async getTask(_taskId: string): Promise<AtlasModel.ITaskState | undefined> {
		return undefined;
	}

	async getTaskTree(_rootTaskId: string): Promise<IHarnessTaskTree | undefined> {
		return undefined;
	}

	async getAgent(_dispatchId: string): Promise<AtlasModel.IAgentState | undefined> {
		return undefined;
	}

	async getReviewGate(_dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined> {
		return undefined;
	}

	async getMergeEntry(_dispatchId: string): Promise<AtlasModel.IMergeEntry | undefined> {
		return undefined;
	}

	async getTaskPacket(_taskId: string): Promise<AtlasModel.IWireTaskPacket | undefined> {
		return undefined;
	}

	async getResultPacket(_dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> {
		return undefined;
	}

	async getTranscript(_dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> {
		return Object.freeze([]);
	}

	async getMemoryRecords(_swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
		return Object.freeze([]);
	}

	async getWorktreeState(_dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> {
		return undefined;
	}

	async pauseAgent(_dispatchId: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async resumeAgent(_dispatchId: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async cancelAgent(_dispatchId: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async steerAgent(_dispatchId: string, _message: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async pauseAll(): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async resumeAll(): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async submitObjective(_problemStatement: string, _options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async submitDispatch(_command: AtlasModel.IWireDispatchCommand): Promise<string> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async recordGateVerdict(_dispatchId: string, _decision: AtlasModel.ReviewDecision, _reviewedByRole: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async authorizePromotion(_dispatchId: string, _authorizedByRole: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	async enqueueForMerge(_dispatchId: string): Promise<void> {
		throw new Error(WEB_UNAVAILABLE_ERROR);
	}

	subscribeAgentActivity(_dispatchId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]> {
		return EMPTY_TRANSCRIPTS;
	}

	subscribeSwarmActivity(_swarmId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]> {
		return EMPTY_TRANSCRIPTS;
	}
}

registerSingleton(IHarnessService, HarnessService, InstantiationType.Delayed);
