/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- The sessions-scoped fleet management runtime owns Phase 4 selection/context state and must bridge sessions services with sessions UI contracts. */

import { disposableTimeout, Queue } from '../../../../base/common/async.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, derived, observableValue } from '../../../../base/common/observable.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ViewContainerLocation } from '../../../../workbench/common/views.js';
import { IPaneCompositePartService } from '../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { AtlasSelectedEntityKindContext, AtlasSelectedSectionContext } from '../../../common/contextkeys.js';
import { ATLAS_CENTER_SHELL_CONTAINER_ID } from '../../../common/navigation.js';
import { EntityKind, NavigationSection, ReviewTargetKind } from '../../../common/model/selection.js';
import { HarnessConnectionState, IHarnessService } from '../../harness/common/harnessService.js';
import { IFleetManagementService } from '../common/fleetManagementService.js';

const CONNECTION_RETRY_DELAYS_MS = Object.freeze([1_000, 5_000, 15_000, 30_000, 60_000]);

export class FleetManagementService extends Disposable implements IFleetManagementService {

	declare readonly _serviceBrand: undefined;
	static retryDelaysMs: readonly number[] = CONNECTION_RETRY_DELAYS_MS;

	private readonly _selection = observableValue<AtlasModel.INavigationSelection>(this, {
		section: NavigationSection.Tasks,
		entity: undefined,
	});

	readonly selection = this._selection;
	readonly selectedSection = derived(this, reader => this._selection.read(reader).section);
	readonly selectedEntity = derived(this, reader => this._selection.read(reader).entity);
	readonly selectedEntityKind = derived(this, reader => this._selection.read(reader).entity?.kind);

	private readonly workspaceConnectionQueue = new Queue<void>();
	private readonly reconnectHandle = this._register(new MutableDisposable());
	private connectedWorkspaceRoot: URI | undefined;
	private readonly retryDelaysMs: readonly number[];
	private reconnectAttempt = 0;
	private suppressDisconnectRetry = false;

	constructor(
		@IHarnessService private readonly harnessService: IHarnessService,
		@IPaneCompositePartService private readonly paneCompositePartService: IPaneCompositePartService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.retryDelaysMs = FleetManagementService.retryDelaysMs;

		const selectedEntityKindContext = AtlasSelectedEntityKindContext.bindTo(contextKeyService);
		const selectedSectionContext = AtlasSelectedSectionContext.bindTo(contextKeyService);

		this._register(autorun(reader => {
			selectedEntityKindContext.set(this.selectedEntityKind.read(reader) ?? '');
			selectedSectionContext.set(this.selectedSection.read(reader));
		}));

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleWorkspaceConnection({ force: true, resetRetry: true })));
		this._register(this.harnessService.onDidDisconnect(() => this.handleHarnessDisconnect()));
		this.scheduleWorkspaceConnection({ resetRetry: true });
	}

	selectSection(section: AtlasModel.NavigationSection): void {
		const current = this._selection.get();
		const entity = current.entity && sectionForEntity(current.entity.kind) === section ? current.entity : undefined;
		this.setSelection(section, entity);
		void this.revealCenterShell();
	}

	selectEntity(entity: AtlasModel.ISelectedEntity | undefined): void {
		const section = entity ? sectionForEntity(entity.kind) : this._selection.get().section;
		this.setSelection(section, entity);
		void this.revealCenterShell();
	}

	selectAgent(dispatchId: string): void {
		this.setSelection(NavigationSection.Agents, { kind: EntityKind.Agent, id: dispatchId });
		void this.revealCenterShell();
	}

	selectTask(taskId: string): void {
		this.setSelection(NavigationSection.Tasks, { kind: EntityKind.Task, id: taskId });
		void this.revealCenterShell();
	}

	selectObjective(objectiveId: string): void {
		this.setSelection(NavigationSection.Tasks, { kind: EntityKind.Objective, id: objectiveId });
		void this.revealCenterShell();
	}

	selectSwarm(swarmId: string): void {
		this.setSelection(NavigationSection.Tasks, { kind: EntityKind.Swarm, id: swarmId });
		void this.revealCenterShell();
	}

	selectReview(dispatchId: string, targetKind: AtlasModel.ReviewTargetKind = ReviewTargetKind.Gate): void {
		this.setSelection(NavigationSection.Reviews, { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: targetKind });
		void this.revealCenterShell();
	}

	clearSelection(): void {
		this.setSelection(this._selection.get().section, undefined);
	}

	async openSwarmBoard(swarmId: string): Promise<void> {
		this.setSelection(NavigationSection.Tasks, { kind: EntityKind.Swarm, id: swarmId });
		await this.revealCenterShell();
	}

	async openObjectiveBoard(objectiveId: string): Promise<void> {
		this.setSelection(NavigationSection.Tasks, { kind: EntityKind.Objective, id: objectiveId });
		await this.revealCenterShell();
	}

	async openAgentView(dispatchId: string): Promise<void> {
		this.setSelection(NavigationSection.Agents, { kind: EntityKind.Agent, id: dispatchId });
		await this.revealCenterShell();
	}

	async openFleetGrid(): Promise<void> {
		this.setSelection(NavigationSection.Fleet, undefined);
		await this.revealCenterShell();
	}

	async openReview(dispatchId: string, targetKind: AtlasModel.ReviewTargetKind = ReviewTargetKind.Gate): Promise<void> {
		this.setSelection(NavigationSection.Reviews, { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: targetKind });
		await this.revealCenterShell();
	}

	private setSelection(section: AtlasModel.NavigationSection, entity: AtlasModel.ISelectedEntity | undefined): void {
		const current = this._selection.get();
		if (current.section === section
			&& current.entity?.kind === entity?.kind
			&& current.entity?.id === entity?.id
			&& current.entity?.kind !== EntityKind.Review
			&& entity?.kind !== EntityKind.Review) {
			return;
		}

		if (current.section === section
			&& current.entity?.kind === EntityKind.Review
			&& entity?.kind === EntityKind.Review
			&& current.entity.id === entity.id
			&& current.entity.reviewTargetKind === entity.reviewTargetKind) {
			return;
		}

		this._selection.set({ section, entity }, undefined, undefined);
	}

	private async revealCenterShell(): Promise<void> {
		await this.paneCompositePartService.openPaneComposite(ATLAS_CENTER_SHELL_CONTAINER_ID, ViewContainerLocation.ChatBar, false);
	}

	private scheduleWorkspaceConnection(options: { readonly force?: boolean; readonly resetRetry?: boolean } = {}): void {
		if (options.resetRetry) {
			this.resetReconnectSchedule();
		}

		void this.workspaceConnectionQueue.queue(async () => {
			const nextWorkspaceRoot = this.getPrimaryWorkspaceRoot();
			const currentConnectionState = this.harnessService.connectionState.get().state;
			if (!options.force
				&& nextWorkspaceRoot
				&& this.connectedWorkspaceRoot
				&& isEqual(nextWorkspaceRoot, this.connectedWorkspaceRoot)
				&& currentConnectionState !== HarnessConnectionState.Disconnected
				&& currentConnectionState !== HarnessConnectionState.Error) {
				return;
			}

			if (!nextWorkspaceRoot) {
				this.connectedWorkspaceRoot = undefined;
				this.resetReconnectSchedule();
				this.suppressDisconnectRetry = true;
				try {
					await this.harnessService.disconnect();
				} finally {
					this.suppressDisconnectRetry = false;
				}
				return;
			}

			try {
				await this.harnessService.connect(nextWorkspaceRoot);
				this.connectedWorkspaceRoot = nextWorkspaceRoot;
				this.resetReconnectSchedule();
			} catch (error) {
				this.connectedWorkspaceRoot = undefined;
				this.logService.warn(`Atlas harness connection failed for workspace ${nextWorkspaceRoot.toString()}: ${asErrorMessage(error)}`);
				this.scheduleReconnect(nextWorkspaceRoot, asErrorMessage(error));
			}
		});
	}

	private getPrimaryWorkspaceRoot(): URI | undefined {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri;
	}

	private handleHarnessDisconnect(): void {
		if (this.suppressDisconnectRetry) {
			return;
		}

		this.connectedWorkspaceRoot = undefined;
		const workspaceRoot = this.getPrimaryWorkspaceRoot();
		if (!workspaceRoot) {
			this.resetReconnectSchedule();
			return;
		}

		this.scheduleReconnect(workspaceRoot, 'harness disconnected');
	}

	private scheduleReconnect(workspaceRoot: URI, reason: string): void {
		if (this.reconnectHandle.value) {
			return;
		}
		if (this.reconnectAttempt >= this.retryDelaysMs.length) {
			this.logService.warn(`Atlas harness reconnect attempts exhausted for workspace ${workspaceRoot.toString()} after ${this.retryDelaysMs.length} tries.`);
			return;
		}

		const delay = this.retryDelaysMs[this.reconnectAttempt++];
		this.logService.info(`Atlas harness reconnect scheduled in ${delay}ms for workspace ${workspaceRoot.toString()} (${reason}).`);
		this.reconnectHandle.value = disposableTimeout(() => {
			this.reconnectHandle.clear();
			const currentWorkspaceRoot = this.getPrimaryWorkspaceRoot();
			if (!currentWorkspaceRoot || !isEqual(currentWorkspaceRoot, workspaceRoot)) {
				return;
			}
			this.scheduleWorkspaceConnection({ force: true });
		}, delay);
	}

	private resetReconnectSchedule(): void {
		this.reconnectAttempt = 0;
		this.reconnectHandle.clear();
	}
}

function sectionForEntity(kind: AtlasModel.EntityKind): AtlasModel.NavigationSection {
	switch (kind) {
		case EntityKind.Agent:
			return NavigationSection.Agents;
		case EntityKind.Review:
			return NavigationSection.Reviews;
		case EntityKind.Task:
		case EntityKind.Objective:
		case EntityKind.Swarm:
		case EntityKind.Worktree:
		case EntityKind.Artifact:
		default:
			return NavigationSection.Tasks;
	}
}

function asErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
