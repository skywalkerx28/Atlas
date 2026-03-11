/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IHarnessService = createDecorator<IHarnessService>('harnessService');

export const enum HarnessConnectionState {
	Disconnected = 'disconnected',
	Connecting = 'connecting',
	Connected = 'connected',
	Reconnecting = 'reconnecting',
	Error = 'error',
}

export type HarnessConnectionMode = 'daemon' | 'polling' | 'none';

export interface IHarnessConnectionInfo {
	readonly state: HarnessConnectionState;
	readonly mode: HarnessConnectionMode;
	readonly writesEnabled: boolean;
	readonly daemonVersion: string | undefined;
	readonly schemaVersion: string | undefined;
	readonly grantedCapabilities: readonly string[];
	readonly errorMessage: string | undefined;
}

export interface IHarnessService {
	readonly _serviceBrand: undefined;

	readonly connectionState: IObservable<IHarnessConnectionInfo>;
	connect(workspaceRoot: URI): Promise<void>;
	disconnect(): Promise<void>;
	readonly onDidDisconnect: Event<void>;

	readonly objectives: IObservable<readonly AtlasModel.IObjectiveState[]>;
	readonly swarms: IObservable<readonly AtlasModel.ISwarmState[]>;
	readonly tasks: IObservable<readonly AtlasModel.ITaskState[]>;
	readonly fleet: IObservable<AtlasModel.IFleetState>;
	readonly health: IObservable<AtlasModel.IHealthState>;
	readonly cost: IObservable<AtlasModel.ICostState>;

	readonly advisoryReviewQueue: IObservable<readonly AtlasModel.IAdvisoryReviewEntry[]>;
	readonly reviewGates: IObservable<readonly AtlasModel.IReviewGateState[]>;
	readonly mergeQueue: IObservable<readonly AtlasModel.IMergeEntry[]>;

	getObjective(objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined>;
	getSwarm(swarmId: string): Promise<AtlasModel.ISwarmState | undefined>;
	getTask(taskId: string): Promise<AtlasModel.ITaskState | undefined>;
	getAgent(dispatchId: string): Promise<AtlasModel.IAgentState | undefined>;
	getReviewGate(dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined>;
	getTaskPacket(taskId: string): Promise<AtlasModel.IWireTaskPacket | undefined>;
	getResultPacket(dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined>;
	getTranscript(dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]>;
	getMemoryRecords(swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]>;
	getWorktreeState(dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined>;

	pauseAgent(dispatchId: string): Promise<void>;
	resumeAgent(dispatchId: string): Promise<void>;
	cancelAgent(dispatchId: string): Promise<void>;
	steerAgent(dispatchId: string, message: string): Promise<void>;
	pauseAll(): Promise<void>;
	resumeAll(): Promise<void>;

	submitObjective(problemStatement: string, options?: AtlasModel.IObjectiveSubmitOptions): Promise<string>;
	submitDispatch(command: AtlasModel.IWireDispatchCommand): Promise<string>;

	recordGateVerdict(dispatchId: string, decision: AtlasModel.ReviewDecision, reviewedByRole: string): Promise<void>;
	authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void>;
	enqueueForMerge(dispatchId: string): Promise<void>;

	subscribeAgentActivity(dispatchId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]>;
	subscribeSwarmActivity(swarmId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]>;
}
