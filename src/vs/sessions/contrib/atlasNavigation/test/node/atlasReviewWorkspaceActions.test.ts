/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side Phase 6 tests intentionally exercise the sessions review workspace controller directly. */

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AttentionLevel } from '../../../../common/model/attention.js';
import { PoolMode } from '../../../../common/model/health.js';
import { EntityKind, ReviewTargetKind, type IReviewSelectedEntity } from '../../../../common/model/selection.js';
import { ReviewDecision } from '../../../../common/model/wire.js';
import { HarnessConnectionState, type IHarnessConnectionInfo, type IHarnessService } from '../../../../services/harness/common/harnessService.js';
import type { IHarnessTaskTree } from '../../../../services/harness/common/harnessTypes.js';
import { AtlasReviewWorkspaceActionController, ReviewWorkspaceActionId } from '../../browser/atlasReviewWorkspaceActions.js';

suite('AtlasReviewWorkspaceActions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('records a go verdict with the canonical judge role when supported', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze(['review.gate_verdict']),
			grantedCapabilities: Object.freeze(['read', 'review']),
		})));
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const target = reviewTarget('disp-gate-1', ReviewTargetKind.Gate);

		controller.setSelection(target);
		const result = await controller.runAction(ReviewWorkspaceActionId.RecordGo, target);

		assert.strictEqual(result, true);
		assert.deepStrictEqual(harnessService.recordGateVerdictCalls, [{
			dispatchId: 'disp-gate-1',
			decision: ReviewDecision.Go,
			reviewedByRole: 'axiom-judge',
		}]);
		assert.strictEqual(controller.uiState.get().pendingAction, undefined);
		assert.strictEqual(controller.uiState.get().errorMessage, undefined);
	});

	test('authorizes promotion with the canonical planner role when supported', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze(['review.authorize_promotion']),
			grantedCapabilities: Object.freeze(['read', 'merge']),
		})));
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const target = reviewTarget('disp-review-2', ReviewTargetKind.Gate);

		const result = await controller.runAction(ReviewWorkspaceActionId.AuthorizePromotion, target);

		assert.strictEqual(result, true);
		assert.deepStrictEqual(harnessService.authorizePromotionCalls, [{
			dispatchId: 'disp-review-2',
			authorizedByRole: 'axiom-planner',
		}]);
		assert.strictEqual(controller.uiState.get().errorMessage, undefined);
	});

	test('enqueues merge only when the daemon advertises enqueue support', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze([]),
			grantedCapabilities: Object.freeze(['read', 'merge']),
		})));
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const target = reviewTarget('disp-merge-1', ReviewTargetKind.Merge);

		const unsupported = await controller.runAction(ReviewWorkspaceActionId.EnqueueMerge, target);

		assert.strictEqual(unsupported, false);
		assert.deepStrictEqual(harnessService.enqueueForMergeCalls, []);
		assert.strictEqual(controller.uiState.get().errorMessage, 'Current harness daemon does not expose review.enqueue_merge.');

		harnessService.connectionState.set(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze(['review.enqueue_merge']),
			grantedCapabilities: Object.freeze(['read', 'merge']),
		}), undefined, undefined);

		const supported = await controller.runAction(ReviewWorkspaceActionId.EnqueueMerge, target);

		assert.strictEqual(supported, true);
		assert.deepStrictEqual(harnessService.enqueueForMergeCalls, ['disp-merge-1']);
		assert.strictEqual(controller.uiState.get().errorMessage, undefined);
	});

	test('surfaces deterministic read-only errors without calling the service in polling mode', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			state: HarnessConnectionState.Connected,
			mode: 'polling',
			writesEnabled: false,
			supportedWriteMethods: Object.freeze([]),
			grantedCapabilities: Object.freeze(['read']),
		})));
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const target = reviewTarget('disp-readonly-1', ReviewTargetKind.Gate);

		const result = await controller.runAction(ReviewWorkspaceActionId.RecordNoGo, target);

		assert.strictEqual(result, false);
		assert.deepStrictEqual(harnessService.recordGateVerdictCalls, []);
		assert.strictEqual(controller.uiState.get().errorMessage, 'Harness daemon required; Atlas is in read-only mode.');
	});

	test('keeps daemon failures local to the review workspace state', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze(['review.gate_verdict']),
			grantedCapabilities: Object.freeze(['read', 'review']),
		})));
		harnessService.recordGateVerdictError = new Error('daemon denied verdict');
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const target = reviewTarget('disp-gate-2', ReviewTargetKind.Gate);

		const result = await controller.runAction(ReviewWorkspaceActionId.RecordNoGo, target);

		assert.strictEqual(result, false);
		assert.deepStrictEqual(harnessService.recordGateVerdictCalls, [{
			dispatchId: 'disp-gate-2',
			decision: ReviewDecision.NoGo,
			reviewedByRole: 'axiom-judge',
		}]);
		assert.strictEqual(controller.uiState.get().pendingAction, undefined);
		assert.strictEqual(controller.uiState.get().errorMessage, 'daemon denied verdict');
	});

	test('fails closed when a gate-only action is invoked from a merge target', async () => {
		const harnessService = disposables.add(new TestHarnessService(createConnectionState({
			writesEnabled: true,
			supportedWriteMethods: Object.freeze(['review.gate_verdict', 'review.authorize_promotion']),
			grantedCapabilities: Object.freeze(['read', 'review', 'merge']),
		})));
		const controller = disposables.add(new AtlasReviewWorkspaceActionController(harnessService));
		const mergeTarget = reviewTarget('disp-shared-1', ReviewTargetKind.Merge);

		const verdictResult = await controller.runAction(ReviewWorkspaceActionId.RecordGo, mergeTarget);
		assert.strictEqual(verdictResult, false);
		assert.deepStrictEqual(harnessService.recordGateVerdictCalls, []);
		assert.strictEqual(controller.uiState.get().errorMessage, 'Select a review gate target to record a verdict.');

		const promotionResult = await controller.runAction(ReviewWorkspaceActionId.AuthorizePromotion, mergeTarget);
		assert.strictEqual(promotionResult, false);
		assert.deepStrictEqual(harnessService.authorizePromotionCalls, []);
		assert.strictEqual(controller.uiState.get().errorMessage, 'Select a review gate target to authorize promotion.');
	});
});

class TestHarnessService extends Disposable implements IHarnessService {
	declare readonly _serviceBrand: undefined;

	readonly connectionState;
	readonly onDidDisconnect = Event.None;
	readonly objectives = observableValue<readonly AtlasModel.IObjectiveState[]>('reviewWorkspaceObjectives', Object.freeze([]));
	readonly swarms = observableValue<readonly AtlasModel.ISwarmState[]>('reviewWorkspaceSwarms', Object.freeze([]));
	readonly tasks = observableValue<readonly AtlasModel.ITaskState[]>('reviewWorkspaceTasks', Object.freeze([]));
	readonly fleet = observableValue<AtlasModel.IFleetState>('reviewWorkspaceFleet', {
		agents: Object.freeze([]),
		activeCount: 0,
		idleCount: 0,
		blockedCount: 0,
		failedCount: 0,
		totalCostSpent: 0,
		attentionLevel: AttentionLevel.Idle,
	});
	readonly health = observableValue<AtlasModel.IHealthState>('reviewWorkspaceHealth', {
		mode: PoolMode.Normal,
		diskUsagePct: 0,
		memoryUsagePct: 0,
		walSizeBytes: undefined,
		queueDepth: 0,
		activeWorkers: 0,
		lastHealthCheck: 0,
		attentionLevel: AttentionLevel.Idle,
	});
	readonly cost = observableValue<AtlasModel.ICostState>('reviewWorkspaceCost', {
		totalSpentUsd: 0,
		budgetCeilingUsd: undefined,
		utilization: undefined,
		burnRateUsdPerHour: undefined,
		breakdowns: Object.freeze([]),
		attentionLevel: AttentionLevel.Idle,
		updatedAt: undefined,
	});
	readonly advisoryReviewQueue = observableValue<readonly AtlasModel.IAdvisoryReviewEntry[]>('reviewWorkspaceAdvisory', Object.freeze([]));
	readonly reviewGates = observableValue<readonly AtlasModel.IReviewGateState[]>('reviewWorkspaceReviewGates', Object.freeze([]));
	readonly mergeQueue = observableValue<readonly AtlasModel.IMergeEntry[]>('reviewWorkspaceMergeQueue', Object.freeze([]));

	readonly recordGateVerdictCalls: { dispatchId: string; decision: AtlasModel.ReviewDecision; reviewedByRole: string }[] = [];
	readonly authorizePromotionCalls: { dispatchId: string; authorizedByRole: string }[] = [];
	readonly enqueueForMergeCalls: string[] = [];

	recordGateVerdictError: Error | undefined;
	authorizePromotionError: Error | undefined;
	enqueueForMergeError: Error | undefined;

	constructor(initialConnectionState: IHarnessConnectionInfo) {
		super();
		this.connectionState = observableValue<IHarnessConnectionInfo>('reviewWorkspaceConnection', initialConnectionState);
	}

	async connect(_workspaceRoot: URI): Promise<void> { throw new Error('unused'); }
	async disconnect(): Promise<void> { }
	async getObjective(_objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined> { return undefined; }
	async getSwarm(_swarmId: string): Promise<AtlasModel.ISwarmState | undefined> { return undefined; }
	async getTask(_taskId: string): Promise<AtlasModel.ITaskState | undefined> { return undefined; }
	async getTaskTree(_rootTaskId: string): Promise<IHarnessTaskTree | undefined> { return undefined; }
	async getAgent(_dispatchId: string): Promise<AtlasModel.IAgentState | undefined> { return undefined; }
	async getReviewGate(_dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined> { return undefined; }
	async getMergeEntry(_dispatchId: string): Promise<AtlasModel.IMergeEntry | undefined> { return undefined; }
	async getTaskPacket(_taskId: string): Promise<AtlasModel.IWireTaskPacket | undefined> { return undefined; }
	async getResultPacket(_dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> { return undefined; }
	async getTranscript(_dispatchId: string): Promise<import('../../../../services/harness/common/harnessTypes.js').IHarnessTranscriptSnapshot | undefined> { return undefined; }
	async getMemoryRecords(_swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> { return Object.freeze([]); }
	async getTaskMemoryRecords(_taskId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> { return Object.freeze([]); }
	async getMemoryRecord(_recordId: string): Promise<AtlasModel.IWireMemoryRecord | undefined> { return undefined; }
	async getWorktreeState(_dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> { return undefined; }
	async getWorktreeStates(_rootTaskId: string): Promise<readonly AtlasModel.IWorktreeState[]> { return Object.freeze([]); }
	async getArtifacts(_dispatchId: string): Promise<import('../../../../services/harness/common/harnessTypes.js').IHarnessArtifactInventory | undefined> { return undefined; }
	async getArtifactPreview(_dispatchId: string, _artifactPath: string): Promise<import('../../../../services/harness/common/harnessTypes.js').IHarnessArtifactPreview | undefined> { return undefined; }
	async getAgentActivity(_dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> { return Object.freeze([]); }
	async getReviewProvenance(_dispatchId: string): Promise<readonly import('../../../../services/harness/common/harnessTypes.js').IReviewProvenanceEntry[]> { return Object.freeze([]); }
	async pauseAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
	async resumeAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
	async cancelAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
	async steerAgent(_dispatchId: string, _message: string): Promise<void> { throw new Error('unused'); }
	async pauseAll(): Promise<void> { throw new Error('unused'); }
	async resumeAll(): Promise<void> { throw new Error('unused'); }
	async submitObjective(_problemStatement: string, _options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> { throw new Error('unused'); }
	async submitDispatch(_command: AtlasModel.IWireDispatchCommand): Promise<string> { throw new Error('unused'); }

	async recordGateVerdict(dispatchId: string, decision: AtlasModel.ReviewDecision, reviewedByRole: string): Promise<void> {
		this.recordGateVerdictCalls.push({ dispatchId, decision, reviewedByRole });
		if (this.recordGateVerdictError) {
			throw this.recordGateVerdictError;
		}
	}

	async authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void> {
		this.authorizePromotionCalls.push({ dispatchId, authorizedByRole });
		if (this.authorizePromotionError) {
			throw this.authorizePromotionError;
		}
	}

	async enqueueForMerge(dispatchId: string): Promise<void> {
		this.enqueueForMergeCalls.push(dispatchId);
		if (this.enqueueForMergeError) {
			throw this.enqueueForMergeError;
		}
	}

	subscribeAgentActivity(_dispatchId: string) {
		return observableValue<readonly AtlasModel.ITranscriptEntry[]>('reviewWorkspaceAgentActivity', Object.freeze([]));
	}

	subscribeSwarmActivity(_swarmId: string) {
		return observableValue<readonly AtlasModel.ITranscriptEntry[]>('reviewWorkspaceSwarmActivity', Object.freeze([]));
	}
}

function createConnectionState(overrides: Partial<IHarnessConnectionInfo> = {}): IHarnessConnectionInfo {
	return {
		state: HarnessConnectionState.Connected,
		mode: 'daemon',
		writesEnabled: false,
		supportedWriteMethods: Object.freeze([]),
		fabricIdentity: undefined,
		daemonVersion: '0.1.0-test',
		schemaVersion: '2026-03-01',
		grantedCapabilities: Object.freeze(['read']),
		errorMessage: undefined,
		...overrides,
	};
}

function reviewTarget(id: string, reviewTargetKind: ReviewTargetKind): IReviewSelectedEntity {
	return {
		kind: EntityKind.Review,
		id,
		reviewTargetKind,
	};
}
