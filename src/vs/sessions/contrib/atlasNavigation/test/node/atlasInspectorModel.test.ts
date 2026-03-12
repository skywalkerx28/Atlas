/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side Phase 8 tests intentionally exercise the sessions inspector model directly. */

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentRole, AgentStatus, type IAgentState, type IFleetState } from '../../../../common/model/agent.js';
import { AttentionLevel } from '../../../../common/model/attention.js';
import { PoolMode, type IHealthState } from '../../../../common/model/health.js';
import { ObjectiveStatus, type IObjectiveState } from '../../../../common/model/objective.js';
import { MergeExecutionStatus, type IMergeEntry, type IReviewGateState } from '../../../../common/model/review.js';
import { ActivityEventKind, HandoffType, MemoryAuthority, MemoryLifecycleState, MemoryRecordType, MemoryScope, ResultPacketStatus, ReviewDecision, WireDispatchPriority, WireIntegrationState, WirePromotionState, WireReviewState, type IWireMemoryRecord, type IWireResultPacket } from '../../../../common/model/wire.js';
import { EntityKind, NavigationSection, ReviewTargetKind } from '../../../../common/model/selection.js';
import { SwarmPhase, type ISwarmState } from '../../../../common/model/swarm.js';
import { TaskStatus, type ITaskState } from '../../../../common/model/task.js';
import { HarnessConnectionState, type IHarnessConnectionInfo, type IHarnessService } from '../../../../services/harness/common/harnessService.js';
import type {
	IHarnessArtifactInventory,
	IHarnessArtifactPreview,
	IReviewProvenanceEntry,
	IHarnessTaskTree,
	IHarnessTranscriptSnapshot,
} from '../../../../services/harness/common/harnessTypes.js';
import { buildAtlasInspectorModel } from '../../browser/atlasInspectorModel.js';

suite('AtlasInspectorModel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('builds a sparse rooted inspector for swarm selections without inventing dispatch data', async () => {
		const harnessService = disposables.add(createHarnessService({
			worktreeStates: Object.freeze([
				createWorktreeState({ dispatchId: 'disp-root', taskId: 'TASK-ROOT-1' }),
			]),
			rootMemoryRecords: Object.freeze([
				createMemoryRecord({ header: { record_id: 'mem-root-1', task_id: 'TASK-ROOT-1' } }),
			]),
		}));

		const model = await buildAtlasInspectorModel(
			{ section: NavigationSection.Tasks, entity: { kind: EntityKind.Swarm, id: 'TASK-ROOT-1' } },
			createStateSnapshot({
				swarms: Object.freeze([
					createSwarmState({
						swarmId: 'TASK-ROOT-1',
						rootTaskId: 'TASK-ROOT-1',
						taskIds: Object.freeze(['TASK-ROOT-1']),
					}),
				]),
				tasks: Object.freeze([createTaskState({ taskId: 'TASK-ROOT-1', summary: 'Root planner task' })]),
			}),
			harnessService,
		);

		assert.ok(model);
		assert.strictEqual(model.worktree.state, 'ready');
		assert.strictEqual(model.worktree.entries.length, 1);
		assert.strictEqual(model.memory.state, 'ready');
		assert.strictEqual(model.memory.records.length, 1);
		assert.strictEqual(model.result.state, 'empty');
		assert.strictEqual(model.artifacts.state, 'empty');
		assert.strictEqual(model.activity.state, 'empty');
		assert.strictEqual(model.transcript.state, 'empty');
		assert.strictEqual(model.provenance.state, 'empty');
		assert.deepStrictEqual(harnessService.calls.rootMemoryRoots, ['TASK-ROOT-1']);
		assert.deepStrictEqual(harnessService.calls.taskMemoryTasks, []);
		assert.deepStrictEqual(harnessService.calls.resultDispatches, []);
		assert.deepStrictEqual(harnessService.calls.artifactDispatches, []);
		assert.deepStrictEqual(harnessService.calls.activityDispatches, []);
		assert.deepStrictEqual(harnessService.calls.transcriptDispatches, []);
		assert.deepStrictEqual(harnessService.calls.provenanceDispatches, []);
	});

	test('uses task-scoped memory for task selections and keeps dispatch-only sections sparse when no dispatch exists', async () => {
		const harnessService = disposables.add(createHarnessService({
			taskMemoryRecords: Object.freeze([
				createMemoryRecord({ header: { record_id: 'mem-task-1', task_id: 'TASK-CHILD-1' } }),
			]),
		}));

		const model = await buildAtlasInspectorModel(
			{ section: NavigationSection.Tasks, entity: { kind: EntityKind.Task, id: 'TASK-CHILD-1' } },
			createStateSnapshot({
				swarms: Object.freeze([
					createSwarmState({
						swarmId: 'TASK-ROOT-1',
						rootTaskId: 'TASK-ROOT-1',
						taskIds: Object.freeze(['TASK-ROOT-1', 'TASK-CHILD-1']),
					}),
				]),
				tasks: Object.freeze([
					createTaskState({ taskId: 'TASK-ROOT-1', summary: 'Root planner task' }),
					createTaskState({ taskId: 'TASK-CHILD-1', parentTaskId: 'TASK-ROOT-1', summary: 'Child worker task', dispatchId: undefined }),
				]),
			}),
			harnessService,
		);

		assert.ok(model);
		assert.strictEqual(model.memory.state, 'ready');
		assert.strictEqual(model.memory.records.length, 1);
		assert.strictEqual(model.result.state, 'empty');
		assert.strictEqual(model.artifacts.state, 'empty');
		assert.strictEqual(model.activity.state, 'empty');
		assert.strictEqual(model.transcript.state, 'empty');
		assert.deepStrictEqual(harnessService.calls.taskMemoryTasks, ['TASK-CHILD-1']);
		assert.deepStrictEqual(harnessService.calls.rootMemoryRoots, []);
		assert.deepStrictEqual(harnessService.calls.resultDispatches, []);
	});

	test('loads dispatch-scoped deep inspector sections for agent selections', async () => {
		const harnessService = disposables.add(createHarnessService({
			worktreeState: createWorktreeState({ dispatchId: 'disp-agent-1', taskId: 'TASK-ROOT-1' }),
			resultPacket: createResultPacket({ task_id: 'TASK-ROOT-1', summary: 'Dispatch completed cleanly' }),
			artifactInventory: {
				dispatchId: 'disp-agent-1',
				taskId: 'TASK-ROOT-1',
				objectiveId: 'OBJ-1',
				artifactBundleDir: '/tmp/artifacts/disp-agent-1',
				truncated: false,
				artifacts: Object.freeze([
					{
						artifactPath: 'reports/final.md',
						absolutePath: '/tmp/artifacts/disp-agent-1/reports/final.md',
						kind: 'result_packet',
						sizeBytes: 512,
					},
				]),
			},
			artifactPreview: {
				dispatchId: 'disp-agent-1',
				taskId: 'TASK-ROOT-1',
				objectiveId: 'OBJ-1',
				artifactBundleDir: '/tmp/artifacts/disp-agent-1',
				artifact: {
					artifactPath: 'reports/final.md',
					absolutePath: '/tmp/artifacts/disp-agent-1/reports/final.md',
					kind: 'result_packet',
					sizeBytes: 512,
				},
				textPreview: '# Final report',
				previewTruncated: false,
				isUtf8Text: true,
			},
			agentActivity: Object.freeze([
				createTranscriptEntry({ dispatchId: 'disp-agent-1', taskId: 'TASK-ROOT-1', summary: 'Ran test suite' }),
			]),
			transcript: {
				dispatchId: 'disp-agent-1',
				available: true,
				metadata: { turns: 2 },
				excerptJsonl: '{"type":"assistant","text":"done"}',
			},
		}));

		const model = await buildAtlasInspectorModel(
			{ section: NavigationSection.Agents, entity: { kind: EntityKind.Agent, id: 'disp-agent-1' } },
			createStateSnapshot({
				swarms: Object.freeze([
					createSwarmState({
						swarmId: 'TASK-ROOT-1',
						rootTaskId: 'TASK-ROOT-1',
						objectiveId: 'OBJ-1',
						taskIds: Object.freeze(['TASK-ROOT-1']),
					}),
				]),
				objectives: Object.freeze([
					createObjectiveState({ objectiveId: 'OBJ-1', rootTaskId: 'TASK-ROOT-1', problemStatement: 'Ship the inspector' }),
				]),
				tasks: Object.freeze([
					createTaskState({ taskId: 'TASK-ROOT-1', summary: 'Root planner task', dispatchId: 'disp-agent-1' }),
				]),
				fleet: createFleetState(Object.freeze([
					createAgentState({ dispatchId: 'disp-agent-1', taskId: 'TASK-ROOT-1', worktreePath: '/workspace/disp-agent-1' }),
				])),
			}),
			harnessService,
		);

		assert.ok(model);
		assert.strictEqual(model.worktree.state, 'ready');
		assert.strictEqual(model.result.state, 'ready');
		assert.strictEqual(model.result.packet?.summary, 'Dispatch completed cleanly');
		assert.strictEqual(model.artifacts.state, 'ready');
		assert.strictEqual(model.artifacts.inventory.length, 1);
		assert.strictEqual(model.artifacts.preview?.textPreview, '# Final report');
		assert.strictEqual(model.activity.state, 'ready');
		assert.strictEqual(model.activity.entries.length, 1);
		assert.strictEqual(model.transcript.state, 'ready');
		assert.strictEqual(model.transcript.snapshot?.available, true);
		assert.deepStrictEqual(harnessService.calls.worktreeDispatches, ['disp-agent-1']);
		assert.deepStrictEqual(harnessService.calls.resultDispatches, ['disp-agent-1']);
		assert.deepStrictEqual(harnessService.calls.artifactDispatches, ['disp-agent-1']);
		assert.deepStrictEqual(harnessService.calls.artifactPreviewRequests, [{ dispatchId: 'disp-agent-1', artifactPath: 'reports/final.md' }]);
		assert.deepStrictEqual(harnessService.calls.activityDispatches, ['disp-agent-1']);
		assert.deepStrictEqual(harnessService.calls.transcriptDispatches, ['disp-agent-1']);
	});

	test('keeps gate and merge provenance distinct for the same dispatch', async () => {
		const dispatchId = 'disp-review-1';
		const harnessService = disposables.add(createHarnessService({
			reviewProvenance: Object.freeze([
				createProvenanceEntry({ method: 'review.gate_verdict', outcome: 'go', actor_role: 'axiom-judge' }),
				createProvenanceEntry({ method: 'review.authorize_promotion', outcome: 'authorized', actor_role: 'axiom-planner' }),
				createProvenanceEntry({ method: 'review.enqueue_merge', outcome: 'queued', actor_role: 'axiom-planner' }),
			]),
		}));
		const state = createStateSnapshot({
			swarms: Object.freeze([
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1']),
				}),
			]),
			tasks: Object.freeze([
				createTaskState({ taskId: 'TASK-ROOT-1', summary: 'Root planner task', dispatchId }),
			]),
			reviewGates: Object.freeze([
				createReviewGateState({ dispatchId, taskId: 'TASK-ROOT-1', reviewState: WireReviewState.AwaitingReview }),
			]),
			mergeQueue: Object.freeze([
				createMergeEntry({ dispatchId, taskId: 'TASK-ROOT-1', status: MergeExecutionStatus.Pending }),
			]),
		});

		const gateModel = await buildAtlasInspectorModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Gate } },
			state,
			harnessService,
		);
		const mergeModel = await buildAtlasInspectorModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Merge } },
			state,
			harnessService,
		);

		assert.ok(gateModel);
		assert.ok(mergeModel);
		assert.deepStrictEqual(gateModel.provenance.entries.map(entry => entry.method), ['review.gate_verdict', 'review.authorize_promotion']);
		assert.deepStrictEqual(mergeModel.provenance.entries.map(entry => entry.method), ['review.enqueue_merge']);
		assert.deepStrictEqual(harnessService.calls.provenanceDispatches, [dispatchId, dispatchId]);
	});
});

interface ITestHarnessCalls {
	readonly rootMemoryRoots: string[];
	readonly taskMemoryTasks: string[];
	readonly worktreeDispatches: string[];
	readonly worktreeRoots: string[];
	readonly resultDispatches: string[];
	readonly artifactDispatches: string[];
	readonly artifactPreviewRequests: { dispatchId: string; artifactPath: string }[];
	readonly activityDispatches: string[];
	readonly transcriptDispatches: string[];
	readonly provenanceDispatches: string[];
}

interface ITestHarnessOverrides {
	readonly rootMemoryRecords?: readonly IWireMemoryRecord[];
	readonly taskMemoryRecords?: readonly IWireMemoryRecord[];
	readonly worktreeState?: AtlasModel.IWorktreeState;
	readonly worktreeStates?: readonly AtlasModel.IWorktreeState[];
	readonly resultPacket?: IWireResultPacket;
	readonly artifactInventory?: IHarnessArtifactInventory;
	readonly artifactPreview?: IHarnessArtifactPreview;
	readonly agentActivity?: readonly AtlasModel.ITranscriptEntry[];
	readonly transcript?: IHarnessTranscriptSnapshot;
	readonly reviewProvenance?: readonly IReviewProvenanceEntry[];
}

function createHarnessService(overrides: ITestHarnessOverrides = {}): Disposable & IHarnessService & { readonly calls: ITestHarnessCalls } {
	const calls: ITestHarnessCalls = {
		rootMemoryRoots: [],
		taskMemoryTasks: [],
		worktreeDispatches: [],
		worktreeRoots: [],
		resultDispatches: [],
		artifactDispatches: [],
		artifactPreviewRequests: [],
		activityDispatches: [],
		transcriptDispatches: [],
		provenanceDispatches: [],
	};

	class TestHarnessService extends Disposable implements IHarnessService {
		declare readonly _serviceBrand: undefined;

		readonly calls = calls;
		readonly connectionState = observableValue<IHarnessConnectionInfo>('inspectorConnection', createConnectionState());
		readonly onDidDisconnect = Event.None;
		readonly objectives = observableValue<readonly AtlasModel.IObjectiveState[]>('inspectorObjectives', Object.freeze([]));
		readonly swarms = observableValue<readonly AtlasModel.ISwarmState[]>('inspectorSwarms', Object.freeze([]));
		readonly tasks = observableValue<readonly AtlasModel.ITaskState[]>('inspectorTasks', Object.freeze([]));
		readonly fleet = observableValue<AtlasModel.IFleetState>('inspectorFleet', createFleetState(Object.freeze([])));
		readonly health = observableValue<AtlasModel.IHealthState>('inspectorHealth', createHealthState());
		readonly cost = observableValue<AtlasModel.ICostState>('inspectorCost', {
			totalSpentUsd: 0,
			budgetCeilingUsd: undefined,
			utilization: undefined,
			burnRateUsdPerHour: undefined,
			breakdowns: Object.freeze([]),
			attentionLevel: AttentionLevel.Idle,
			updatedAt: undefined,
		});
		readonly advisoryReviewQueue = observableValue<readonly AtlasModel.IAdvisoryReviewEntry[]>('inspectorAdvisory', Object.freeze([]));
		readonly reviewGates = observableValue<readonly AtlasModel.IReviewGateState[]>('inspectorReviewGates', Object.freeze([]));
		readonly mergeQueue = observableValue<readonly AtlasModel.IMergeEntry[]>('inspectorMergeQueue', Object.freeze([]));

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

		async getResultPacket(dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> {
			calls.resultDispatches.push(dispatchId);
			return overrides.resultPacket;
		}

		async getTranscript(dispatchId: string): Promise<IHarnessTranscriptSnapshot | undefined> {
			calls.transcriptDispatches.push(dispatchId);
			return overrides.transcript;
		}

		async getMemoryRecords(rootTaskId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
			calls.rootMemoryRoots.push(rootTaskId);
			return overrides.rootMemoryRecords ?? Object.freeze([]);
		}

		async getTaskMemoryRecords(taskId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
			calls.taskMemoryTasks.push(taskId);
			return overrides.taskMemoryRecords ?? Object.freeze([]);
		}

		async getMemoryRecord(_recordId: string): Promise<AtlasModel.IWireMemoryRecord | undefined> { return undefined; }

		async getWorktreeState(dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> {
			calls.worktreeDispatches.push(dispatchId);
			return overrides.worktreeState;
		}

		async getWorktreeStates(rootTaskId: string): Promise<readonly AtlasModel.IWorktreeState[]> {
			calls.worktreeRoots.push(rootTaskId);
			return overrides.worktreeStates ?? Object.freeze([]);
		}

		async getArtifacts(dispatchId: string): Promise<IHarnessArtifactInventory | undefined> {
			calls.artifactDispatches.push(dispatchId);
			return overrides.artifactInventory;
		}

		async getArtifactPreview(dispatchId: string, artifactPath: string): Promise<IHarnessArtifactPreview | undefined> {
			calls.artifactPreviewRequests.push({ dispatchId, artifactPath });
			return overrides.artifactPreview;
		}

		async getAgentActivity(dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> {
			calls.activityDispatches.push(dispatchId);
			return overrides.agentActivity ?? Object.freeze([]);
		}

		async getReviewProvenance(dispatchId: string): Promise<readonly IReviewProvenanceEntry[]> {
			calls.provenanceDispatches.push(dispatchId);
			return overrides.reviewProvenance ?? Object.freeze([]);
		}

		async pauseAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
		async resumeAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
		async cancelAgent(_dispatchId: string): Promise<void> { throw new Error('unused'); }
		async steerAgent(_dispatchId: string, _message: string): Promise<void> { throw new Error('unused'); }
		async pauseAll(): Promise<void> { throw new Error('unused'); }
		async resumeAll(): Promise<void> { throw new Error('unused'); }
		async submitObjective(_problemStatement: string, _options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> { throw new Error('unused'); }
		async submitDispatch(_command: AtlasModel.IWireDispatchCommand): Promise<string> { throw new Error('unused'); }
		async recordGateVerdict(_dispatchId: string, _decision: AtlasModel.ReviewDecision, _reviewedByRole: string): Promise<void> { throw new Error('unused'); }
		async authorizePromotion(_dispatchId: string, _authorizedByRole: string): Promise<void> { throw new Error('unused'); }
		async enqueueForMerge(_dispatchId: string): Promise<void> { throw new Error('unused'); }
		subscribeAgentActivity(_dispatchId: string) { return observableValue<readonly AtlasModel.ITranscriptEntry[]>('inspectorAgentActivity', Object.freeze([])); }
		subscribeSwarmActivity(_swarmId: string) { return observableValue<readonly AtlasModel.ITranscriptEntry[]>('inspectorSwarmActivity', Object.freeze([])); }
	}

	return new TestHarnessService();
}

function createStateSnapshot(overrides: Partial<{
	connection: IHarnessConnectionInfo;
	swarms: readonly ISwarmState[];
	tasks: readonly ITaskState[];
	objectives: readonly IObjectiveState[];
	fleet: IFleetState;
	health: IHealthState;
	reviewGates: readonly IReviewGateState[];
	mergeQueue: readonly IMergeEntry[];
}> = {}) {
	return {
		connection: overrides.connection ?? createConnectionState(),
		swarms: overrides.swarms ?? Object.freeze([]),
		tasks: overrides.tasks ?? Object.freeze([]),
		objectives: overrides.objectives ?? Object.freeze([]),
		fleet: overrides.fleet ?? createFleetState(Object.freeze([])),
		health: overrides.health ?? createHealthState(),
		reviewGates: overrides.reviewGates ?? Object.freeze([]),
		mergeQueue: overrides.mergeQueue ?? Object.freeze([]),
	};
}

function createConnectionState(overrides: Partial<IHarnessConnectionInfo> = {}): IHarnessConnectionInfo {
	return {
		state: HarnessConnectionState.Connected,
		mode: 'daemon',
		writesEnabled: false,
		supportedWriteMethods: Object.freeze([]),
		daemonVersion: '1.0.0',
		schemaVersion: '2026-03-01',
		grantedCapabilities: Object.freeze(['read']),
		errorMessage: undefined,
		...overrides,
	};
}

function createSwarmState(overrides: Partial<ISwarmState> = {}): ISwarmState {
	return {
		swarmId: 'TASK-ROOT-1',
		rootTaskId: 'TASK-ROOT-1',
		objectiveId: undefined,
		objectiveStatus: undefined,
		objectiveProblemStatement: undefined,
		rootTaskStatus: TaskStatus.Executing,
		phase: SwarmPhase.Executing,
		taskIds: Object.freeze(['TASK-ROOT-1']),
		agentDispatchIds: Object.freeze([]),
		worktreePaths: Object.freeze([]),
		reviewDispatchIds: Object.freeze([]),
		mergeDispatchIds: Object.freeze([]),
		reviewNeeded: false,
		mergeBlocked: false,
		hasFailures: false,
		hasBlockedTasks: false,
		memoryRecordCount: 0,
		costSpent: 0,
		costCeiling: undefined,
		attentionLevel: AttentionLevel.Active,
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

function createTaskState(overrides: Partial<ITaskState> = {}): ITaskState {
	return {
		taskId: 'TASK-ROOT-1',
		dispatchId: 'disp-root',
		parentTaskId: undefined,
		objectiveId: undefined,
		roleId: 'planner',
		fromRole: undefined,
		toRole: undefined,
		summary: 'Root task',
		handoffType: HandoffType.Planning,
		status: TaskStatus.Executing,
		priority: 0,
		acceptance: Object.freeze([]),
		constraints: Object.freeze([]),
		artifacts: Object.freeze([]),
		memoryKeywords: Object.freeze([]),
		contextPaths: Object.freeze([]),
		dependsOn: Object.freeze([]),
		assignedAgentId: overrides.dispatchId ?? 'disp-root',
		costSpent: 0,
		attentionLevel: AttentionLevel.Active,
		enqueuedAt: 100,
		startedAt: 120,
		completedAt: undefined,
		...overrides,
	};
}

function createObjectiveState(overrides: Partial<IObjectiveState> = {}): IObjectiveState {
	return {
		objectiveId: 'OBJ-1',
		problemStatement: 'Ship the inspector',
		playbookIds: Object.freeze([]),
		desiredOutcomes: Object.freeze([]),
		constraints: Object.freeze([]),
		contextPaths: Object.freeze([]),
		successCriteria: Object.freeze([]),
		operatorNotes: Object.freeze([]),
		priority: WireDispatchPriority.P1,
		status: ObjectiveStatus.Executing,
		rootTaskId: 'TASK-ROOT-1',
		resumeCount: 0,
		maxResumeCycles: 3,
		maxParallelWorkers: undefined,
		costSpent: 0,
		costCeiling: undefined,
		attentionLevel: AttentionLevel.Active,
		createdAt: 100,
		updatedAt: 200,
		completedAt: undefined,
		...overrides,
	};
}

function createAgentState(overrides: Partial<IAgentState> = {}): IAgentState {
	return {
		dispatchId: 'disp-root',
		taskId: 'TASK-ROOT-1',
		roleId: 'planner',
		status: AgentStatus.Running,
		worktreePath: undefined,
		pid: 1234,
		startedAt: 100,
		lastHeartbeat: 190,
		role: AgentRole.Planner,
		costSpent: 0,
		lastActivity: 'Reasoning',
		timeInState: 90,
		attentionLevel: AttentionLevel.Active,
		...overrides,
	};
}

function createFleetState(agents: readonly IAgentState[], overrides: Partial<IFleetState> = {}): IFleetState {
	return {
		agents,
		activeCount: agents.filter(agent => agent.status === AgentStatus.Running).length,
		idleCount: agents.filter(agent => agent.status === AgentStatus.Idle).length,
		blockedCount: agents.filter(agent => agent.status === AgentStatus.Blocked).length,
		failedCount: agents.filter(agent => agent.status === AgentStatus.Failed || agent.status === AgentStatus.TimedOut).length,
		totalCostSpent: agents.reduce((total, agent) => total + agent.costSpent, 0),
		attentionLevel: agents.some(agent => agent.attentionLevel === AttentionLevel.Critical)
			? AttentionLevel.Critical
			: agents.some(agent => agent.attentionLevel === AttentionLevel.NeedsAction)
				? AttentionLevel.NeedsAction
				: AttentionLevel.Idle,
		...overrides,
	};
}

function createHealthState(overrides: Partial<IHealthState> = {}): IHealthState {
	return {
		mode: PoolMode.Normal,
		diskUsagePct: 20,
		memoryUsagePct: 15,
		walSizeBytes: 512,
		activeWorkers: 1,
		queueDepth: 0,
		attentionLevel: AttentionLevel.Idle,
		lastHealthCheck: 200,
		...overrides,
	};
}

function createReviewGateState(overrides: Partial<IReviewGateState> = {}): IReviewGateState {
	return {
		dispatchId: 'disp-review-1',
		taskId: 'TASK-ROOT-1',
		roleId: 'axiom-judge',
		candidateBranch: 'feature/inspector',
		baseRef: 'main',
		baseHeadSha: 'base-head',
		mergeBaseSha: 'merge-base',
		reviewedHeadSha: 'reviewed-head',
		commitShas: Object.freeze(['abc123']),
		workingTreeClean: true,
		reviewState: WireReviewState.AwaitingReview,
		judgeDecision: undefined,
		reviewedByRole: undefined,
		reviewedAt: undefined,
		promotionState: WirePromotionState.NotRequested,
		promotionAuthorizedAt: undefined,
		promotionAuthorizedByRole: undefined,
		integrationState: WireIntegrationState.NotReady,
		mergedSha: undefined,
		mergeExecutorId: undefined,
		stateReason: undefined,
		attentionLevel: AttentionLevel.NeedsAction,
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

function createMergeEntry(overrides: Partial<IMergeEntry> = {}): IMergeEntry {
	return {
		dispatchId: 'disp-review-1',
		taskId: 'TASK-ROOT-1',
		worktreePath: '/workspace/feature/inspector',
		candidateBranch: 'feature/inspector',
		baseRef: 'main',
		baseHeadSha: 'base-head',
		mergeBaseSha: 'merge-base',
		reviewedHeadSha: 'reviewed-head',
		priority: 0,
		status: MergeExecutionStatus.Pending,
		mergeSha: undefined,
		conflictDetails: undefined,
		affectedPaths: undefined,
		judgeDecision: ReviewDecision.Go,
		reviewedByRole: 'axiom-judge',
		reviewedAt: 210,
		promotionAuthorizedAt: 220,
		promotionAuthorizedByRole: 'axiom-planner',
		mergeExecutorId: undefined,
		mergedAt: undefined,
		blockedReason: undefined,
		attentionLevel: AttentionLevel.Active,
		enqueuedAt: 200,
		...overrides,
	};
}

function createMemoryRecord(overrides: { readonly header?: Partial<IWireMemoryRecord['header']>; readonly body?: IWireMemoryRecord['body'] } = {}): IWireMemoryRecord {
	const headerOverrides = overrides.header ?? {};
	return {
		header: {
			record_id: 'mem-1',
			memory_type: MemoryRecordType.Decision,
			scope: MemoryScope.PlannerTree,
			authority: MemoryAuthority.EvidenceAccepted,
			lifecycle: MemoryLifecycleState.Accepted,
			task_id: 'TASK-ROOT-1',
			dispatch_id: 'disp-root',
			source_artifact_path: 'artifacts/result.json',
			source_digest: 'sha256:abc',
			created_by_role: 'axiom-planner',
			created_by_actor: 'planner',
			created_at: '2026-03-12T12:00:00.000Z',
			...headerOverrides,
		},
		body: overrides.body ?? {
			memory_type: MemoryRecordType.Decision,
			body: {
				decision_text: 'Use the inspector side panel',
				scope_paths: Object.freeze(['src/vs/sessions']),
				rationale: 'Truthful deep reads already exist',
			},
		},
	};
}

function createWorktreeState(overrides: Partial<AtlasModel.IWorktreeState> = {}): AtlasModel.IWorktreeState {
	return {
		worktreePath: '/workspace/feature/inspector',
		dispatchId: 'disp-root',
		taskId: 'TASK-ROOT-1',
		objectiveId: undefined,
		branch: 'feature/inspector',
		baseRef: 'main',
		headSha: 'abc123',
		workingTreeClean: false,
		mergeReady: false,
		attentionLevel: AttentionLevel.NeedsAction,
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

function createResultPacket(overrides: Partial<IWireResultPacket> = {}): IWireResultPacket {
	return {
		task_id: 'TASK-ROOT-1',
		created_at: '2026-03-12T12:05:00.000Z',
		from_role: 'worker',
		to_role: 'planner',
		status: ResultPacketStatus.Done,
		summary: 'Finished execution',
		artifacts: Object.freeze(['reports/final.md']),
		commands: Object.freeze(['npm test']),
		risks: Object.freeze([]),
		decision: ReviewDecision.Go,
		acceptance_results: Object.freeze([]),
		next_actions: Object.freeze(['submit review']),
		git_branch: 'feature/inspector',
		git_base: 'main',
		head_sha: 'abc123',
		commit_shas: Object.freeze(['abc123']),
		working_tree_clean: true,
		pushed: false,
		merge_ready: false,
		workspace_events: Object.freeze([]),
		...overrides,
	};
}

function createTranscriptEntry(overrides: Partial<AtlasModel.ITranscriptEntry> = {}): AtlasModel.ITranscriptEntry {
	return {
		timestamp: Date.parse('2026-03-12T12:10:00.000Z'),
		dispatchId: 'disp-root',
		taskId: 'TASK-ROOT-1',
		objectiveId: undefined,
		roleId: 'worker',
		handoffType: HandoffType.Implementation,
		kind: ActivityEventKind.ToolUse,
		summary: 'Opened the worktree',
		tool: 'read_file',
		filePath: 'src/vs/sessions/contrib/atlasNavigation/browser/atlasCenterShellViewPane.ts',
		diffStat: undefined,
		command: undefined,
		exitCode: undefined,
		durationMs: 25,
		raw: undefined,
		payload: undefined,
		...overrides,
	};
}

function createProvenanceEntry(overrides: Partial<IReviewProvenanceEntry> = {}): IReviewProvenanceEntry {
	return {
		id: 1,
		dispatch_id: 'disp-review-1',
		method: 'review.gate_verdict',
		rid: 'rid-1',
		actor_role: 'axiom-judge',
		client_id: 'atlas-client',
		identity: 'atlas@desktop',
		outcome: 'go',
		created_at: '2026-03-12T12:20:00.000Z',
		provenance: { source: 'atlas' },
		...overrides,
	};
}
