/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- The sessions-scoped fleet management runtime owns Phase 4 selection/context state and must bridge sessions services with sessions UI contracts. */

import { Queue } from '../../../../base/common/async.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun, derived, observableValue } from '../../../../base/common/observable.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ViewContainerLocation } from '../../../../workbench/common/views.js';
import { IPaneCompositePartService } from '../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { AtlasSelectedEntityKindContext, AtlasSelectedSectionContext } from '../../../common/contextkeys.js';
import { ATLAS_CENTER_SHELL_CONTAINER_ID } from '../../../common/navigation.js';
import { EntityKind, NavigationSection } from '../../../common/model/selection.js';
import { IHarnessService } from '../../harness/common/harnessService.js';
import { IFleetManagementService } from '../common/fleetManagementService.js';

export class FleetManagementService extends Disposable implements IFleetManagementService {

	declare readonly _serviceBrand: undefined;

	private readonly _selection = observableValue<AtlasModel.INavigationSelection>(this, {
		section: NavigationSection.Tasks,
		entity: undefined,
	});

	readonly selection = this._selection;
	readonly selectedSection = derived(this, reader => this._selection.read(reader).section);
	readonly selectedEntity = derived(this, reader => this._selection.read(reader).entity);
	readonly selectedEntityKind = derived(this, reader => this._selection.read(reader).entity?.kind);

	private readonly workspaceConnectionQueue = new Queue<void>();
	private connectedWorkspaceRoot: URI | undefined;

	constructor(
		@IHarnessService private readonly harnessService: IHarnessService,
		@IPaneCompositePartService private readonly paneCompositePartService: IPaneCompositePartService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		const selectedEntityKindContext = AtlasSelectedEntityKindContext.bindTo(contextKeyService);
		const selectedSectionContext = AtlasSelectedSectionContext.bindTo(contextKeyService);

		this._register(autorun(reader => {
			selectedEntityKindContext.set(this.selectedEntityKind.read(reader) ?? '');
			selectedSectionContext.set(this.selectedSection.read(reader));
		}));

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleWorkspaceConnection()));
		this.scheduleWorkspaceConnection();
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

	selectReview(dispatchId: string): void {
		this.setSelection(NavigationSection.Reviews, { kind: EntityKind.Review, id: dispatchId });
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

	async openReview(dispatchId: string): Promise<void> {
		this.setSelection(NavigationSection.Reviews, { kind: EntityKind.Review, id: dispatchId });
		await this.revealCenterShell();
	}

	private setSelection(section: AtlasModel.NavigationSection, entity: AtlasModel.ISelectedEntity | undefined): void {
		const current = this._selection.get();
		if (current.section === section && current.entity?.kind === entity?.kind && current.entity?.id === entity?.id) {
			return;
		}

		this._selection.set({ section, entity }, undefined, undefined);
	}

	private async revealCenterShell(): Promise<void> {
		await this.paneCompositePartService.openPaneComposite(ATLAS_CENTER_SHELL_CONTAINER_ID, ViewContainerLocation.ChatBar, false);
	}

	private scheduleWorkspaceConnection(): void {
		void this.workspaceConnectionQueue.queue(async () => {
			const nextWorkspaceRoot = this.getPrimaryWorkspaceRoot();
			if (nextWorkspaceRoot && this.connectedWorkspaceRoot && isEqual(nextWorkspaceRoot, this.connectedWorkspaceRoot)) {
				return;
			}

			if (!nextWorkspaceRoot) {
				this.connectedWorkspaceRoot = undefined;
				await this.harnessService.disconnect();
				return;
			}

			try {
				await this.harnessService.connect(nextWorkspaceRoot);
				this.connectedWorkspaceRoot = nextWorkspaceRoot;
			} catch (error) {
				this.connectedWorkspaceRoot = undefined;
				this.logService.warn(`Atlas harness connection failed for workspace ${nextWorkspaceRoot.toString()}: ${asErrorMessage(error)}`);
			}
		});
	}

	private getPrimaryWorkspaceRoot(): URI | undefined {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri;
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
