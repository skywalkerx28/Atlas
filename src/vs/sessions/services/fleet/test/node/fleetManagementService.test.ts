/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side Phase 4 tests intentionally exercise the sessions fleet management runtime directly. */

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFolder, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { ViewContainerLocation } from '../../../../../workbench/common/views.js';
import type { IPaneCompositePartService } from '../../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { ATLAS_CENTER_SHELL_CONTAINER_ID } from '../../../../common/navigation.js';
import { EntityKind, NavigationSection } from '../../../../common/model/selection.js';
import { PoolMode } from '../../../../common/model/health.js';
import { AtlasSelectedEntityKindContext, AtlasSelectedSectionContext } from '../../../../common/contextkeys.js';
import { HarnessConnectionState, type IHarnessConnectionInfo, type IHarnessService } from '../../../harness/common/harnessService.js';
import type { IHarnessTaskTree } from '../../../harness/common/harnessTypes.js';
import { FleetManagementService } from '../../browser/fleetManagementService.js';

suite('FleetManagementService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('connects to the primary workspace root and defaults to the tasks section', async () => {
		const harnessService = new TestHarnessService();
		const paneCompositePartService = new TestPaneCompositePartService();
		const workspaceContextService = new TestWorkspaceContextService([workspaceFolder('/workspace-a')]);
		const contextKeyService = new MockContextKeyService();
		const service = store.add(new FleetManagementService(
			harnessService as unknown as IHarnessService,
			paneCompositePartService as unknown as IPaneCompositePartService,
			workspaceContextService as unknown as IWorkspaceContextService,
			contextKeyService,
			new NullLogService(),
		));

		await flushAsync();

		assert.deepStrictEqual(harnessService.connectCalls.map(uri => uri.fsPath), ['/workspace-a']);
		assert.strictEqual(service.selection.get().section, NavigationSection.Tasks);
		assert.strictEqual(service.selection.get().entity, undefined);
		assert.strictEqual(contextKeyService.getContextKeyValue(AtlasSelectedSectionContext.key), NavigationSection.Tasks);
		assert.strictEqual(contextKeyService.getContextKeyValue(AtlasSelectedEntityKindContext.key), '');
	});

	test('selection methods stay deterministic and reveal the read-only center shell', async () => {
		const harnessService = new TestHarnessService();
		const paneCompositePartService = new TestPaneCompositePartService();
		const workspaceContextService = new TestWorkspaceContextService([workspaceFolder('/workspace-a')]);
		const contextKeyService = new MockContextKeyService();
		const service = store.add(new FleetManagementService(
			harnessService as unknown as IHarnessService,
			paneCompositePartService as unknown as IPaneCompositePartService,
			workspaceContextService as unknown as IWorkspaceContextService,
			contextKeyService,
			new NullLogService(),
		));

		await flushAsync();

		service.selectSwarm('TASK-ROOT-1');
		await flushAsync();
		assert.deepStrictEqual(service.selection.get(), {
			section: NavigationSection.Tasks,
			entity: { kind: EntityKind.Swarm, id: 'TASK-ROOT-1' },
		});
		assert.strictEqual(contextKeyService.getContextKeyValue(AtlasSelectedEntityKindContext.key), EntityKind.Swarm);

		service.selectSection(NavigationSection.Tasks);
		assert.deepStrictEqual(service.selection.get(), {
			section: NavigationSection.Tasks,
			entity: { kind: EntityKind.Swarm, id: 'TASK-ROOT-1' },
		});

		service.selectSection(NavigationSection.Fleet);
		await flushAsync();
		assert.deepStrictEqual(service.selection.get(), {
			section: NavigationSection.Fleet,
			entity: undefined,
		});
		assert.strictEqual(contextKeyService.getContextKeyValue(AtlasSelectedSectionContext.key), NavigationSection.Fleet);
		assert.strictEqual(contextKeyService.getContextKeyValue(AtlasSelectedEntityKindContext.key), '');

		await service.openReview('disp-review-1');
		assert.deepStrictEqual(service.selection.get(), {
			section: NavigationSection.Reviews,
			entity: { kind: EntityKind.Review, id: 'disp-review-1' },
		});

		assert.deepStrictEqual(paneCompositePartService.openCalls, [
			{ id: ATLAS_CENTER_SHELL_CONTAINER_ID, location: ViewContainerLocation.ChatBar, focus: false },
			{ id: ATLAS_CENTER_SHELL_CONTAINER_ID, location: ViewContainerLocation.ChatBar, focus: false },
			{ id: ATLAS_CENTER_SHELL_CONTAINER_ID, location: ViewContainerLocation.ChatBar, focus: false },
			{ id: ATLAS_CENTER_SHELL_CONTAINER_ID, location: ViewContainerLocation.ChatBar, focus: false },
		]);
	});

	test('reconnects on workspace-root changes and disconnects when the workspace becomes empty', async () => {
		const harnessService = new TestHarnessService();
		const paneCompositePartService = new TestPaneCompositePartService();
		const workspaceContextService = new TestWorkspaceContextService([workspaceFolder('/workspace-a')]);
		store.add(new FleetManagementService(
			harnessService as unknown as IHarnessService,
			paneCompositePartService as unknown as IPaneCompositePartService,
			workspaceContextService as unknown as IWorkspaceContextService,
			new MockContextKeyService(),
			new NullLogService(),
		));

		await flushAsync();
		workspaceContextService.setFolders([workspaceFolder('/workspace-b')]);
		await flushAsync();
		workspaceContextService.setFolders([]);
		await flushAsync();

		assert.deepStrictEqual(harnessService.connectCalls.map(uri => uri.fsPath), ['/workspace-a', '/workspace-b']);
		assert.strictEqual(harnessService.disconnectCount, 1);
	});
});

class TestHarnessService {
	declare readonly _serviceBrand: undefined;

	readonly connectionState = observableValue<IHarnessConnectionInfo>('harnessConnectionState', disconnectedConnectionState());
	readonly onDidDisconnect = Event.None;
	readonly objectives = observableValue<readonly AtlasModel.IObjectiveState[]>('harnessObjectives', Object.freeze([]));
	readonly swarms = observableValue<readonly AtlasModel.ISwarmState[]>('harnessSwarms', Object.freeze([]));
	readonly tasks = observableValue<readonly AtlasModel.ITaskState[]>('harnessTasks', Object.freeze([]));
	readonly fleet = observableValue<AtlasModel.IFleetState>('harnessFleet', emptyFleetState());
	readonly health = observableValue<AtlasModel.IHealthState>('harnessHealth', emptyHealthState());
	readonly cost = observableValue<AtlasModel.ICostState>('harnessCost', emptyCostState());
	readonly advisoryReviewQueue = observableValue<readonly AtlasModel.IAdvisoryReviewEntry[]>('harnessAdvisory', Object.freeze([]));
	readonly reviewGates = observableValue<readonly AtlasModel.IReviewGateState[]>('harnessReviewGates', Object.freeze([]));
	readonly mergeQueue = observableValue<readonly AtlasModel.IMergeEntry[]>('harnessMergeQueue', Object.freeze([]));

	readonly connectCalls: URI[] = [];
	disconnectCount = 0;

	async connect(workspaceRoot: URI): Promise<void> {
		this.connectCalls.push(workspaceRoot);
	}

	async disconnect(): Promise<void> {
		this.disconnectCount++;
	}

	async getObjective(_objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined> { return undefined; }
	async getSwarm(_swarmId: string): Promise<AtlasModel.ISwarmState | undefined> { return undefined; }
	async getTask(_taskId: string): Promise<AtlasModel.ITaskState | undefined> { return undefined; }
	async getTaskTree(_rootTaskId: string): Promise<IHarnessTaskTree | undefined> { return undefined; }
	async getAgent(_dispatchId: string): Promise<AtlasModel.IAgentState | undefined> { return undefined; }
	async getReviewGate(_dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined> { return undefined; }
	async getMergeEntry(_dispatchId: string): Promise<AtlasModel.IMergeEntry | undefined> { return undefined; }
	async getTaskPacket(_taskId: string): Promise<AtlasModel.IWireTaskPacket | undefined> { return undefined; }
	async getResultPacket(_dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> { return undefined; }
	async getTranscript(_dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> { return Object.freeze([]); }
	async getMemoryRecords(_swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> { return Object.freeze([]); }
	async getWorktreeState(_dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> { return undefined; }
	async pauseAgent(_dispatchId: string): Promise<void> { throw new Error('unsupported'); }
	async resumeAgent(_dispatchId: string): Promise<void> { throw new Error('unsupported'); }
	async cancelAgent(_dispatchId: string): Promise<void> { throw new Error('unsupported'); }
	async steerAgent(_dispatchId: string, _message: string): Promise<void> { throw new Error('unsupported'); }
	async pauseAll(): Promise<void> { throw new Error('unsupported'); }
	async resumeAll(): Promise<void> { throw new Error('unsupported'); }
	async submitObjective(_problemStatement: string, _options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> { throw new Error('unsupported'); }
	async submitDispatch(_command: AtlasModel.IWireDispatchCommand): Promise<string> { throw new Error('unsupported'); }
	async recordGateVerdict(_dispatchId: string, _decision: AtlasModel.ReviewDecision, _reviewedByRole: string): Promise<void> { throw new Error('unsupported'); }
	async authorizePromotion(_dispatchId: string, _authorizedByRole: string): Promise<void> { throw new Error('unsupported'); }
	async enqueueForMerge(_dispatchId: string): Promise<void> { throw new Error('unsupported'); }
	subscribeAgentActivity(_dispatchId: string) { return observableValue<readonly AtlasModel.ITranscriptEntry[]>('agentActivity', Object.freeze([])); }
	subscribeSwarmActivity(_swarmId: string) { return observableValue<readonly AtlasModel.ITranscriptEntry[]>('swarmActivity', Object.freeze([])); }
}

class TestPaneCompositePartService {
	readonly openCalls: { id: string; location: ViewContainerLocation; focus?: boolean }[] = [];

	async openPaneComposite(id: string, location: ViewContainerLocation, focus?: boolean): Promise<void> {
		this.openCalls.push({ id, location, focus });
	}
}

class TestWorkspaceContextService {
	private readonly workspaceFoldersEmitter = new Emitter<void>();
	private folders: IWorkspaceFolder[];

	constructor(folders: IWorkspaceFolder[]) {
		this.folders = folders;
	}

	readonly onDidChangeWorkspaceFolders = this.workspaceFoldersEmitter.event as unknown as IWorkspaceContextService['onDidChangeWorkspaceFolders'];
	readonly onDidChangeWorkbenchState = Event.None;
	readonly onDidChangeWorkspaceName = Event.None;

	getWorkspace(): IWorkspace {
		return { folders: this.folders } as IWorkspace;
	}

	getWorkbenchState(): WorkbenchState {
		return this.folders.length > 0 ? WorkbenchState.FOLDER : WorkbenchState.EMPTY;
	}

	getWorkspaceFolder(): IWorkspaceFolder | null {
		return this.folders[0] ?? null;
	}

	isInsideWorkspace(): boolean {
		return this.folders.length > 0;
	}

	setFolders(folders: IWorkspaceFolder[]): void {
		this.folders = folders;
		this.workspaceFoldersEmitter.fire();
	}
}

function workspaceFolder(path: string): IWorkspaceFolder {
	const uri = URI.file(path);
	return {
		uri,
		name: uri.path.split('/').pop() || path,
		index: 0,
		toResource: (relativePath: string) => URI.joinPath(uri, relativePath),
	};
}

function disconnectedConnectionState(): IHarnessConnectionInfo {
	return {
		state: HarnessConnectionState.Disconnected,
		mode: 'none',
		writesEnabled: false,
		daemonVersion: undefined,
		schemaVersion: undefined,
		grantedCapabilities: Object.freeze([]),
		errorMessage: undefined,
	};
}

function emptyFleetState(): AtlasModel.IFleetState {
	return {
		agents: Object.freeze([]),
		activeCount: 0,
		idleCount: 0,
		blockedCount: 0,
		failedCount: 0,
		totalCostSpent: 0,
		attentionLevel: 1,
	};
}

function emptyHealthState(): AtlasModel.IHealthState {
	return {
		mode: PoolMode.Normal,
		diskUsagePct: 0,
		memoryUsagePct: 0,
		walSizeBytes: undefined,
		activeWorkers: 0,
		queueDepth: 0,
		attentionLevel: 1,
		lastHealthCheck: undefined,
	};
}

function emptyCostState(): AtlasModel.ICostState {
	return {
		totalSpentUsd: 0,
		budgetCeilingUsd: undefined,
		utilization: undefined,
		burnRateUsdPerHour: undefined,
		breakdowns: Object.freeze([]),
		attentionLevel: 1,
		updatedAt: undefined,
	};
}

async function flushAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
