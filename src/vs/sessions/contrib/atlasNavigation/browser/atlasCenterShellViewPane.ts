/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 Atlas center shell is a sessions-only pane wired to sessions service contracts via DI. */

import './media/atlasCenterShellViewPane.css';
import * as DOM from '../../../../base/browser/dom.js';
import { autorun, observableValue, type IReader } from '../../../../base/common/observable.js';
import { basename } from '../../../../base/common/path.js';
import { localize2 } from '../../../../nls.js';
import { AttentionLevel } from '../../../common/model/attention.js';
import { EntityKind, NavigationSection, ReviewTargetKind } from '../../../common/model/selection.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFleetManagementService } from '../../../services/fleet/common/fleetManagementService.js';
import { IHarnessService } from '../../../services/harness/common/harnessService.js';
import {
	buildAgentsWorkspaceModel,
	buildAtlasShellModel,
	buildFleetCommandModel,
	buildReviewWorkspaceModel,
	buildTasksWorkspaceModel,
	type IAgentWorkspaceGroup,
	type IAgentWorkspaceItem,
	type IAtlasWorkspaceLink,
	type IReviewWorkspaceAction,
	type IReviewWorkspaceEntry,
	type IReviewWorkspaceModel,
	type ITaskWorkspaceAgentEntry,
	type ITaskWorkspaceModel,
	type ITaskWorkspacePressureEntry,
	type ITaskWorkspaceSwarmCard,
	type ITaskWorkspaceTaskEntry,
} from './atlasNavigationModel.js';
import { buildAtlasHeaderModel, type IAtlasHeaderModel } from './atlasHeaderModel.js';
import {
	buildAtlasInspectorModel,
	createLoadingAtlasInspectorModel,
	type IAtlasInspectorLink,
	type IAtlasInspectorModel,
	type IAtlasInspectorStateSnapshot,
} from './atlasInspectorModel.js';
import { AtlasReviewWorkspaceActionController } from './atlasReviewWorkspaceActions.js';

const $ = DOM.$;

export class AtlasCenterShellViewPane extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private readonly reviewWorkspaceActions: AtlasReviewWorkspaceActionController;
	private readonly inspectorModel = observableValue<IAtlasInspectorModel | undefined>(this, undefined);
	private inspectorRefreshToken = 0;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFleetManagementService private readonly fleetManagementService: IFleetManagementService,
		@IHarnessService private readonly harnessService: IHarnessService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.reviewWorkspaceActions = this._register(new AtlasReviewWorkspaceActionController(harnessService));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.bodyContainer = container;
		container.classList.add('atlas-center-shell-view-pane');

		this._register(autorun(reader => {
			const selection = this.fleetManagementService.selection.read(reader);
			this.reviewWorkspaceActions.setSelection(selection.section === NavigationSection.Reviews && selection.entity?.kind === EntityKind.Review ? selection.entity : undefined);
		}));

		this._register(autorun(reader => {
			const selection = this.fleetManagementService.selection.read(reader);
			const state = this.readInspectorStateSnapshot(reader);
			const loadingModel = createLoadingAtlasInspectorModel(selection, state);
			this.inspectorModel.set(loadingModel, undefined, undefined);
			const refreshToken = ++this.inspectorRefreshToken;
			if (!loadingModel) {
				return;
			}

			void this.refreshInspectorModel(refreshToken, selection, state);
		}));

		this._register(autorun(reader => {
			const selection = this.fleetManagementService.selection.read(reader);
			const reviewUiState = this.reviewWorkspaceActions.uiState.read(reader);
			const state = this.readInspectorStateSnapshot(reader);
			const inspectorModel = this.inspectorModel.read(reader);
			const headerModel = buildAtlasHeaderModel(selection, state, this.workspaceContextService.getWorkspace().folders[0]?.name);

			if (selection.section === NavigationSection.Fleet) {
				this.renderFleetCommand(buildFleetCommandModel(state), headerModel, inspectorModel);
				return;
			}

			if (selection.section === NavigationSection.Reviews) {
				this.renderReviewWorkspace(buildReviewWorkspaceModel(selection, state, reviewUiState), headerModel, inspectorModel);
				return;
			}

			if (selection.section === NavigationSection.Tasks) {
				this.renderTasksWorkspace(buildTasksWorkspaceModel(selection, state), headerModel, inspectorModel);
				return;
			}

			if (selection.section === NavigationSection.Agents) {
				this.renderAgentsWorkspace(buildAgentsWorkspaceModel(selection, state), headerModel, inspectorModel);
				return;
			}

			this.renderShell(buildAtlasShellModel(selection, state), headerModel, inspectorModel);
		}));
	}

	private readInspectorStateSnapshot(reader: IReader): IAtlasInspectorStateSnapshot {
		return {
			connection: this.harnessService.connectionState.read(reader),
			swarms: this.harnessService.swarms.read(reader),
			tasks: this.harnessService.tasks.read(reader),
			objectives: this.harnessService.objectives.read(reader),
			fleet: this.harnessService.fleet.read(reader),
			health: this.harnessService.health.read(reader),
			reviewGates: this.harnessService.reviewGates.read(reader),
			mergeQueue: this.harnessService.mergeQueue.read(reader),
		};
	}

	private async refreshInspectorModel(
		refreshToken: number,
		selection: AtlasModel.INavigationSelection,
		state: IAtlasInspectorStateSnapshot,
	): Promise<void> {
		const nextModel = await buildAtlasInspectorModel(selection, state, this.harnessService);
		if (refreshToken !== this.inspectorRefreshToken) {
			return;
		}
		this.inspectorModel.set(nextModel, undefined, undefined);
	}

	private prepareBodyLayout(headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): HTMLElement | undefined {
		if (!this.bodyContainer) {
			return undefined;
		}

		DOM.clearNode(this.bodyContainer);
		const frame = DOM.append(this.bodyContainer, $('div.atlas-center-shell-frame'));
		this.renderAtlasHeader(frame, headerModel);

		const layout = DOM.append(frame, $('div.atlas-center-shell-layout'));
		if (!inspectorModel) {
			layout.classList.add('atlas-center-shell-layout-single');
		}
		const mainContainer = DOM.append(layout, $('div.atlas-center-shell-main-region'));
		if (inspectorModel) {
			const inspectorContainer = DOM.append(layout, $('aside.atlas-center-shell-inspector-region'));
			this.renderInspector(inspectorContainer, inspectorModel);
		}
		return mainContainer;
	}

	private renderShell(model: ReturnType<typeof buildAtlasShellModel>, headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): void {
		if (!this.bodyContainer) {
			return;
		}

		const mainContainer = this.prepareBodyLayout(headerModel, inspectorModel);
		if (!mainContainer) {
			return;
		}

		const root = DOM.append(mainContainer, $('.atlas-center-shell-root'));
		const hero = DOM.append(root, $('.atlas-center-shell-hero'));
		const title = DOM.append(hero, $('h1.atlas-center-shell-title'));
		title.textContent = model.title;
		const subtitle = DOM.append(hero, $('div.atlas-center-shell-subtitle'));
		subtitle.textContent = model.subtitle;

		const stats = DOM.append(root, $('.atlas-center-shell-stats'));
		for (const item of model.stats) {
			const card = DOM.append(stats, $('.atlas-center-shell-stat'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-center-shell-stat-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-center-shell-stat-value'));
			value.textContent = item.value;
		}

		if (model.items.length === 0) {
			const empty = DOM.append(root, $('.atlas-center-shell-empty'));
			const emptyTitle = DOM.append(empty, $('div.atlas-center-shell-empty-title'));
			emptyTitle.textContent = localize2('atlasCenterShell.empty', "No live data yet").value;
			const emptyMessage = DOM.append(empty, $('div.atlas-center-shell-empty-message'));
			emptyMessage.textContent = model.emptyMessage;
			return;
		}

		const list = DOM.append(root, $('.atlas-center-shell-list'));
		for (const item of model.items) {
			const row = DOM.append(list, $('.atlas-center-shell-item'));
			row.classList.add(attentionClass(item.attentionLevel));
			const itemTitle = DOM.append(row, $('div.atlas-center-shell-item-title'));
			itemTitle.textContent = item.label;
			const itemDescription = DOM.append(row, $('div.atlas-center-shell-item-description'));
			itemDescription.textContent = item.description;
			const itemStatus = DOM.append(row, $('div.atlas-center-shell-item-status'));
			itemStatus.textContent = item.status;
		}
	}

	private renderTasksWorkspace(model: ITaskWorkspaceModel, headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): void {
		if (!this.bodyContainer) {
			return;
		}

		const mainContainer = this.prepareBodyLayout(headerModel, inspectorModel);
		if (!mainContainer) {
			return;
		}

		const root = DOM.append(mainContainer, $('.atlas-center-shell-root.atlas-center-shell-root-tasks'));
		this.renderWorkspaceHero(root, model.title, model.subtitle, model.stats);

		if (model.details.length > 0) {
			this.renderWorkspaceDetails(root, model.details, 'atlas-task-workspace-details');
		}
		if (model.links.length > 0) {
			this.renderWorkspaceLinks(root, model.links, 'atlas-task-workspace-links');
		}

		if (model.mode === 'overview') {
			if (model.swarmCards.length === 0) {
				this.renderEmptyState(root, localize2('atlasCenterShell.tasksEmpty', 'No swarms yet').value, model.emptyMessage);
				return;
			}

			const grid = DOM.append(root, $('section.atlas-task-workspace-swarm-grid'));
			for (const card of model.swarmCards) {
				this.renderTaskSwarmCard(grid, card);
			}
			return;
		}

		const support = DOM.append(root, $('div.atlas-task-workspace-support'));
		const agentSection = DOM.append(support, $('section.atlas-task-workspace-panel'));
		const agentTitle = DOM.append(agentSection, $('div.atlas-task-workspace-panel-title'));
		agentTitle.textContent = localize2('atlasCenterShell.taskAgents', 'Related agents').value;
		if (model.agentEntries.length === 0) {
			const empty = DOM.append(agentSection, $('div.atlas-task-workspace-panel-empty'));
			empty.textContent = 'No live agents are currently linked to this swarm.';
		} else {
			const list = DOM.append(agentSection, $('div.atlas-task-workspace-agent-list'));
			for (const entry of model.agentEntries) {
				this.renderTaskAgentEntry(list, entry);
			}
		}

		const pressureSection = DOM.append(support, $('section.atlas-task-workspace-panel'));
		const pressureTitle = DOM.append(pressureSection, $('div.atlas-task-workspace-panel-title'));
		pressureTitle.textContent = localize2('atlasCenterShell.taskPressure', 'Review and merge pressure').value;
		if (model.pressureEntries.length === 0) {
			const empty = DOM.append(pressureSection, $('div.atlas-task-workspace-panel-empty'));
			empty.textContent = 'No active review or merge pressure is currently attached to this swarm.';
		} else {
			const list = DOM.append(pressureSection, $('div.atlas-task-workspace-pressure-list'));
			for (const entry of model.pressureEntries) {
				this.renderTaskPressureEntry(list, entry);
			}
		}

		if (model.taskEntries.length === 0) {
			this.renderEmptyState(root, localize2('atlasCenterShell.taskLineageEmpty', 'No task lineage yet').value, model.emptyMessage);
			return;
		}

		const treeSection = DOM.append(root, $('section.atlas-task-workspace-tree-section'));
		const treeTitle = DOM.append(treeSection, $('div.atlas-task-workspace-panel-title'));
		treeTitle.textContent = localize2('atlasCenterShell.taskTree', 'Rooted task tree').value;
		const tree = DOM.append(treeSection, $('div.atlas-task-workspace-tree'));
		for (const entry of model.taskEntries) {
			this.renderTaskTreeEntry(tree, entry);
		}
	}

	private renderAgentsWorkspace(model: ReturnType<typeof buildAgentsWorkspaceModel>, headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): void {
		if (!this.bodyContainer) {
			return;
		}

		const mainContainer = this.prepareBodyLayout(headerModel, inspectorModel);
		if (!mainContainer) {
			return;
		}

		const root = DOM.append(mainContainer, $('.atlas-center-shell-root.atlas-center-shell-root-agents'));
		this.renderWorkspaceHero(root, model.title, model.subtitle, model.stats);

		if (model.details.length > 0) {
			this.renderWorkspaceDetails(root, model.details, 'atlas-agent-workspace-details');
		}
		if (model.links.length > 0) {
			this.renderWorkspaceLinks(root, model.links, 'atlas-agent-workspace-links');
		}

		if (model.pressureEntries.length > 0) {
			const pressure = DOM.append(root, $('section.atlas-agent-workspace-pressure'));
			const title = DOM.append(pressure, $('div.atlas-task-workspace-panel-title'));
			title.textContent = localize2('atlasCenterShell.agentPressure', 'Dispatch pressure').value;
			const list = DOM.append(pressure, $('div.atlas-task-workspace-pressure-list'));
			for (const entry of model.pressureEntries) {
				this.renderTaskPressureEntry(list, entry);
			}
		}

		const groups = DOM.append(root, $('div.atlas-agent-workspace-groups'));
		for (const group of model.groups) {
			this.renderAgentWorkspaceGroup(groups, group);
		}

		if (model.groups.every(group => group.items.length === 0)) {
			this.renderEmptyState(root, localize2('atlasCenterShell.agentsEmpty', 'No related agents').value, model.emptyMessage);
		}
	}

	private renderWorkspaceHero(container: HTMLElement, titleText: string, subtitleText: string, stats: readonly { label: string; value: string; attentionLevel: AttentionLevel | undefined }[]): void {
		const hero = DOM.append(container, $('.atlas-center-shell-hero'));
		const title = DOM.append(hero, $('h1.atlas-center-shell-title'));
		title.textContent = titleText;
		const subtitle = DOM.append(hero, $('div.atlas-center-shell-subtitle'));
		subtitle.textContent = subtitleText;

		const statGrid = DOM.append(container, $('.atlas-center-shell-stats'));
		for (const item of stats) {
			const card = DOM.append(statGrid, $('.atlas-center-shell-stat'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-center-shell-stat-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-center-shell-stat-value'));
			value.textContent = item.value;
		}
	}

	private renderAtlasHeader(container: HTMLElement, model: IAtlasHeaderModel): void {
		const header = DOM.append(container, $('header.atlas-shell-header'));
		const topRow = DOM.append(header, $('div.atlas-shell-header-top'));

		const identity = DOM.append(topRow, $('div.atlas-shell-header-identity'));
		const brand = DOM.append(identity, $('div.atlas-shell-header-brand'));
		brand.textContent = model.brandLabel;
		const project = DOM.append(identity, $('div.atlas-shell-header-project'));
		project.textContent = model.projectLabel;
		const fabric = DOM.append(identity, $('div.atlas-shell-header-fabric'));
		fabric.textContent = model.fabricLabel;

		const context = DOM.append(topRow, $('div.atlas-shell-header-context'));
		const breadcrumbs = DOM.append(context, $('div.atlas-shell-header-breadcrumbs'));
		for (const [index, crumb] of model.breadcrumbs.entries()) {
			if (index > 0) {
				const separator = DOM.append(breadcrumbs, $('span.atlas-shell-header-breadcrumb-separator'));
				separator.textContent = '/';
			}
			const item = DOM.append(breadcrumbs, $('span.atlas-shell-header-breadcrumb'));
			item.textContent = crumb.label;
		}
		const contextTitle = DOM.append(context, $('div.atlas-shell-header-context-title'));
		contextTitle.textContent = model.contextTitle;
		const contextSubtitle = DOM.append(context, $('div.atlas-shell-header-context-subtitle'));
		contextSubtitle.textContent = model.contextSubtitle;

		const status = DOM.append(topRow, $('div.atlas-shell-header-status'));
		for (const chipModel of model.statusChips) {
			const chip = DOM.append(status, $('div.atlas-shell-header-status-chip'));
			chip.classList.add(attentionClass(chipModel.attentionLevel));
			const label = DOM.append(chip, $('div.atlas-shell-header-status-label'));
			label.textContent = chipModel.label;
			const value = DOM.append(chip, $('div.atlas-shell-header-status-value'));
			value.textContent = chipModel.value;
		}

		const pivots = DOM.append(header, $('nav.atlas-shell-header-pivots'));
		for (const pivot of model.pivots) {
			const button = DOM.append(pivots, $('button.atlas-shell-header-pivot')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.add(attentionClass(pivot.attentionLevel));
			if (pivot.selected) {
				button.classList.add('atlas-shell-header-pivot-selected');
			}
			button.addEventListener('click', () => this.fleetManagementService.selectSection(pivot.section));
			const label = DOM.append(button, $('span.atlas-shell-header-pivot-label'));
			label.textContent = pivot.label;
			const count = DOM.append(button, $('span.atlas-shell-header-pivot-count'));
			count.textContent = String(pivot.count);
		}
	}

	private renderWorkspaceDetails(container: HTMLElement, details: readonly { label: string; value: string; attentionLevel: AttentionLevel | undefined }[], className: string): void {
		const section = DOM.append(container, $(`section.${className}`));
		for (const item of details) {
			const card = DOM.append(section, $('div.atlas-task-workspace-detail'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-task-workspace-detail-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-task-workspace-detail-value'));
			value.textContent = item.value;
		}
	}

	private renderWorkspaceLinks(container: HTMLElement, links: readonly IAtlasWorkspaceLink[], className: string): void {
		const section = DOM.append(container, $(`div.${className}`));
		for (const link of links) {
			const button = DOM.append(section, $('button.atlas-task-workspace-link')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = link.label;
			button.addEventListener('click', () => this.openWorkspaceLink(link));
		}
	}

	private openWorkspaceLink(link: IAtlasWorkspaceLink | IAtlasInspectorLink): void {
		if (link.kind === 'section' && link.section) {
			this.fleetManagementService.selectSection(link.section);
			return;
		}
		if (link.kind === 'entity' && link.target) {
			this.fleetManagementService.selectEntity(link.target);
		}
	}

	private renderTaskSwarmCard(container: HTMLElement, cardModel: ITaskWorkspaceSwarmCard): void {
		const card = DOM.append(container, $('button.atlas-task-workspace-swarm-card')) as HTMLButtonElement;
		card.type = 'button';
		card.classList.add(attentionClass(cardModel.attentionLevel));
		if (cardModel.selected) {
			card.classList.add('atlas-task-workspace-swarm-card-selected');
		}
		card.addEventListener('click', () => this.fleetManagementService.selectEntity(cardModel.target));

		const header = DOM.append(card, $('div.atlas-task-workspace-swarm-card-header'));
		const title = DOM.append(header, $('div.atlas-task-workspace-swarm-card-title'));
		title.textContent = cardModel.title;
		const phase = DOM.append(header, $('div.atlas-task-workspace-swarm-card-phase'));
		phase.textContent = cardModel.phaseLabel;

		const subtitle = DOM.append(card, $('div.atlas-task-workspace-swarm-card-subtitle'));
		subtitle.textContent = cardModel.subtitle;

		const meta = DOM.append(card, $('div.atlas-task-workspace-swarm-card-meta'));
		this.renderTaskMeta(meta, 'Tasks', String(cardModel.taskCount));
		this.renderTaskMeta(meta, 'Agents', String(cardModel.agentCount));
		this.renderTaskMeta(meta, 'Pressure', String(cardModel.reviewCount));
	}

	private renderTaskTreeEntry(container: HTMLElement, entry: ITaskWorkspaceTaskEntry): void {
		const button = DOM.append(container, $('button.atlas-task-workspace-tree-entry')) as HTMLButtonElement;
		button.type = 'button';
		button.classList.add(attentionClass(entry.attentionLevel));
		if (entry.selected) {
			button.classList.add('atlas-task-workspace-tree-entry-selected');
		}
		button.style.paddingLeft = `${14 + (entry.depth * 18)}px`;
		button.addEventListener('click', () => this.fleetManagementService.selectEntity(entry.target));

		const titleRow = DOM.append(button, $('div.atlas-task-workspace-tree-title-row'));
		const title = DOM.append(titleRow, $('div.atlas-task-workspace-tree-title'));
		title.textContent = entry.summary;
		const status = DOM.append(titleRow, $('div.atlas-task-workspace-tree-status'));
		status.textContent = entry.statusLabel;

		const meta = DOM.append(button, $('div.atlas-task-workspace-tree-meta'));
		const role = DOM.append(meta, $('span.atlas-task-workspace-tree-pill'));
		role.textContent = entry.roleLabel;
		if (entry.isRoot) {
			const root = DOM.append(meta, $('span.atlas-task-workspace-tree-pill'));
			root.textContent = 'Root';
		}
		if (entry.dispatchId) {
			const dispatch = DOM.append(meta, $('span.atlas-task-workspace-tree-pill'));
			dispatch.textContent = entry.dispatchId;
		}
		const agents = DOM.append(meta, $('span.atlas-task-workspace-tree-pill'));
		agents.textContent = `${entry.agentCount} agent${entry.agentCount === 1 ? '' : 's'}`;
		if (entry.pressureSummary) {
			const pressure = DOM.append(meta, $('span.atlas-task-workspace-tree-pill.atlas-task-workspace-tree-pill-pressure'));
			pressure.textContent = entry.pressureSummary;
		}
	}

	private renderTaskAgentEntry(container: HTMLElement, entry: ITaskWorkspaceAgentEntry): void {
		const button = DOM.append(container, $('button.atlas-task-workspace-support-entry')) as HTMLButtonElement;
		button.type = 'button';
		button.classList.add(attentionClass(entry.attentionLevel));
		button.addEventListener('click', () => this.fleetManagementService.selectEntity(entry.target));

		const title = DOM.append(button, $('div.atlas-task-workspace-support-entry-title'));
		title.textContent = entry.label;
		const subtitle = DOM.append(button, $('div.atlas-task-workspace-support-entry-subtitle'));
		subtitle.textContent = entry.subtitle;
		const status = DOM.append(button, $('div.atlas-task-workspace-support-entry-status'));
		status.textContent = entry.status;
	}

	private renderTaskPressureEntry(container: HTMLElement, entry: ITaskWorkspacePressureEntry | { label: string; subtitle: string; status: string; kind: ReviewTargetKind; attentionLevel: AttentionLevel; target: AtlasModel.ISelectedEntity }): void {
		const button = DOM.append(container, $('button.atlas-task-workspace-support-entry')) as HTMLButtonElement;
		button.type = 'button';
		button.classList.add(attentionClass(entry.attentionLevel));
		button.addEventListener('click', () => this.fleetManagementService.selectEntity(entry.target));

		const title = DOM.append(button, $('div.atlas-task-workspace-support-entry-title'));
		title.textContent = entry.label;
		const subtitle = DOM.append(button, $('div.atlas-task-workspace-support-entry-subtitle'));
		subtitle.textContent = `${entry.kind === ReviewTargetKind.Gate ? 'Gate' : 'Merge'} • ${entry.subtitle}`;
		const status = DOM.append(button, $('div.atlas-task-workspace-support-entry-status'));
		status.textContent = entry.status;
	}

	private renderAgentWorkspaceGroup(container: HTMLElement, group: IAgentWorkspaceGroup): void {
		const section = DOM.append(container, $('section.atlas-agent-workspace-group'));
		const header = DOM.append(section, $('div.atlas-agent-workspace-group-header'));
		const text = DOM.append(header, $('div.atlas-agent-workspace-group-text'));
		const title = DOM.append(text, $('div.atlas-agent-workspace-group-title'));
		title.textContent = group.label;
		const summary = DOM.append(text, $('div.atlas-agent-workspace-group-summary'));
		summary.textContent = group.summary;
		const count = DOM.append(header, $('div.atlas-agent-workspace-group-count'));
		count.classList.add(attentionClass(group.attentionLevel));
		count.textContent = String(group.count);

		if (group.items.length === 0) {
			const empty = DOM.append(section, $('div.atlas-task-workspace-panel-empty'));
			empty.textContent = group.emptyMessage;
			return;
		}

		const list = DOM.append(section, $('div.atlas-agent-workspace-card-list'));
		for (const item of group.items) {
			this.renderAgentWorkspaceItem(list, item);
		}
	}

	private renderAgentWorkspaceItem(container: HTMLElement, item: IAgentWorkspaceItem): void {
		const card = DOM.append(container, $('button.atlas-agent-workspace-card')) as HTMLButtonElement;
		card.type = 'button';
		card.classList.add(attentionClass(item.attentionLevel));
		if (item.selected) {
			card.classList.add('atlas-agent-workspace-card-selected');
		}
		card.addEventListener('click', () => this.fleetManagementService.selectEntity(item.target));

		const header = DOM.append(card, $('div.atlas-agent-workspace-card-header'));
		const title = DOM.append(header, $('div.atlas-agent-workspace-card-title'));
		title.textContent = item.title;
		const status = DOM.append(header, $('div.atlas-agent-workspace-card-status'));
		status.textContent = item.status;

		const subtitle = DOM.append(card, $('div.atlas-agent-workspace-card-subtitle'));
		subtitle.textContent = item.subtitle;

		const meta = DOM.append(card, $('div.atlas-agent-workspace-card-meta'));
		this.renderTaskMeta(meta, 'Task', item.taskId);
		this.renderTaskMeta(meta, item.swarmId ? 'Swarm' : 'Work root', item.swarmId ?? item.taskId);
		this.renderTaskMeta(meta, 'Heartbeat', item.heartbeatLabel);
		this.renderTaskMeta(meta, 'Activity', item.activityLabel);
		if (item.worktreePath) {
			this.renderTaskMeta(meta, 'Worktree', item.worktreePath);
		}
		if (item.pressureSummary) {
			this.renderTaskMeta(meta, 'Pressure', item.pressureSummary);
		}
	}

	private renderTaskMeta(container: HTMLElement, labelText: string, valueText: string): void {
		const item = DOM.append(container, $('div.atlas-task-workspace-meta-item'));
		const label = DOM.append(item, $('div.atlas-task-workspace-meta-label'));
		label.textContent = labelText;
		const value = DOM.append(item, $('div.atlas-task-workspace-meta-value'));
		value.textContent = valueText;
	}

	private renderEmptyState(container: HTMLElement, titleText: string, messageText: string): void {
		const empty = DOM.append(container, $('.atlas-center-shell-empty'));
		const title = DOM.append(empty, $('div.atlas-center-shell-empty-title'));
		title.textContent = titleText;
		const message = DOM.append(empty, $('div.atlas-center-shell-empty-message'));
		message.textContent = messageText;
	}

	private renderFleetCommand(model: ReturnType<typeof buildFleetCommandModel>, headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): void {
		if (!this.bodyContainer) {
			return;
		}

		const mainContainer = this.prepareBodyLayout(headerModel, inspectorModel);
		if (!mainContainer) {
			return;
		}

		const root = DOM.append(mainContainer, $('.atlas-center-shell-root.atlas-center-shell-root-fleet'));
		const hero = DOM.append(root, $('.atlas-center-shell-hero'));
		const title = DOM.append(hero, $('h1.atlas-center-shell-title'));
		title.textContent = model.title;
		const subtitle = DOM.append(hero, $('div.atlas-center-shell-subtitle'));
		subtitle.textContent = model.subtitle;

		const stats = DOM.append(root, $('.atlas-center-shell-stats'));
		for (const item of model.stats) {
			const card = DOM.append(stats, $('.atlas-center-shell-stat'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-center-shell-stat-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-center-shell-stat-value'));
			value.textContent = item.value;
		}

		if (model.totalAgents === 0) {
			const empty = DOM.append(root, $('.atlas-center-shell-empty'));
			const emptyTitle = DOM.append(empty, $('div.atlas-center-shell-empty-title'));
			emptyTitle.textContent = localize2('atlasCenterShell.fleetEmpty', "No live fleet agents").value;
			const emptyMessage = DOM.append(empty, $('div.atlas-center-shell-empty-message'));
			emptyMessage.textContent = model.emptyMessage;
			return;
		}

		const groups = DOM.append(root, $('.atlas-fleet-command-groups'));
		for (const group of model.groups) {
			const section = DOM.append(groups, $('section.atlas-fleet-command-group'));
			const heading = DOM.append(section, $('div.atlas-fleet-command-group-heading'));
			const headingText = DOM.append(heading, $('div.atlas-fleet-command-group-text'));
			const headingTitle = DOM.append(headingText, $('div.atlas-fleet-command-group-title'));
			headingTitle.textContent = group.label;
			const headingSummary = DOM.append(headingText, $('div.atlas-fleet-command-group-summary'));
			headingSummary.textContent = group.summary;
			const count = DOM.append(heading, $('div.atlas-fleet-command-group-count'));
			count.classList.add(attentionClass(group.attentionLevel));
			count.textContent = String(group.count);

			if (group.items.length === 0) {
				const empty = DOM.append(section, $('.atlas-fleet-command-group-empty'));
				empty.textContent = group.emptyMessage;
				continue;
			}

			const list = DOM.append(section, $('.atlas-fleet-command-list'));
			for (const item of group.items) {
				const card = DOM.append(list, $('article.atlas-fleet-command-item'));
				card.classList.add(attentionClass(item.attentionLevel));

				const header = DOM.append(card, $('div.atlas-fleet-command-item-header'));
				const primary = DOM.append(header, $('button.atlas-fleet-command-primary')) as HTMLButtonElement;
				primary.type = 'button';
				primary.addEventListener('click', () => this.fleetManagementService.selectEntity(item.primaryTarget));
				const primaryTitle = DOM.append(primary, $('div.atlas-fleet-command-item-title'));
				primaryTitle.textContent = item.roleLabel;
				const primarySubtitle = DOM.append(primary, $('div.atlas-fleet-command-item-subtitle'));
				primarySubtitle.textContent = `${item.dispatchId} • ${item.statusLabel}`;

				const status = DOM.append(header, $('div.atlas-fleet-command-item-status'));
				status.textContent = item.statusLabel;

				if (item.pressureSummary) {
					const badges = DOM.append(card, $('div.atlas-fleet-command-badges'));
					for (const label of item.pressureSummary.split(' • ')) {
						const badge = DOM.append(badges, $('span.atlas-fleet-command-badge'));
						badge.textContent = label;
					}
				}

				const meta = DOM.append(card, $('div.atlas-fleet-command-meta'));
				this.renderFleetMeta(meta, 'Task', item.taskId);
				this.renderFleetMeta(meta, item.swarmId ? 'Swarm' : 'Work root', item.swarmId ?? item.taskId);
				this.renderFleetMeta(meta, 'Heartbeat', item.heartbeatLabel);
				this.renderFleetMeta(meta, 'In state', item.timeInStateLabel);
				this.renderFleetMeta(meta, 'Activity', item.lastActivityLabel);

				const pivots = DOM.append(card, $('div.atlas-fleet-command-pivots'));
				for (const pivot of item.pivots) {
					const button = DOM.append(pivots, $('button.atlas-fleet-command-pivot')) as HTMLButtonElement;
					button.type = 'button';
					button.textContent = pivot.label;
					button.addEventListener('click', () => this.fleetManagementService.selectEntity(pivot.target));
				}
			}
		}
	}

	private renderFleetMeta(container: HTMLElement, label: string, value: string): void {
		const item = DOM.append(container, $('div.atlas-fleet-command-meta-item'));
		const metaLabel = DOM.append(item, $('div.atlas-fleet-command-meta-label'));
		metaLabel.textContent = label;
		const metaValue = DOM.append(item, $('div.atlas-fleet-command-meta-value'));
		metaValue.textContent = value;
	}

	private renderReviewWorkspace(model: IReviewWorkspaceModel, headerModel: IAtlasHeaderModel, inspectorModel: IAtlasInspectorModel | undefined): void {
		if (!this.bodyContainer) {
			return;
		}

		const mainContainer = this.prepareBodyLayout(headerModel, inspectorModel);
		if (!mainContainer) {
			return;
		}

		const root = DOM.append(mainContainer, $('.atlas-center-shell-root.atlas-center-shell-root-review'));
		const hero = DOM.append(root, $('.atlas-center-shell-hero'));
		const title = DOM.append(hero, $('h1.atlas-center-shell-title'));
		title.textContent = model.title;
		const subtitle = DOM.append(hero, $('div.atlas-center-shell-subtitle'));
		subtitle.textContent = model.subtitle;

		const stats = DOM.append(root, $('.atlas-center-shell-stats'));
		for (const item of model.stats) {
			const card = DOM.append(stats, $('.atlas-center-shell-stat'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-center-shell-stat-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-center-shell-stat-value'));
			value.textContent = item.value;
		}

		if (model.feedbackMessage) {
			const feedback = DOM.append(root, $('div.atlas-review-workspace-feedback'));
			feedback.classList.add(model.feedbackKind === 'error' ? 'atlas-review-workspace-feedback-error' : 'atlas-review-workspace-feedback-progress');
			feedback.textContent = model.feedbackMessage;
		}

		if (model.readOnlyMessage) {
			const notice = DOM.append(root, $('div.atlas-review-workspace-readonly'));
			notice.textContent = model.readOnlyMessage;
		}

		if (model.details.length > 0) {
			const details = DOM.append(root, $('section.atlas-review-workspace-details'));
			for (const item of model.details) {
				const card = DOM.append(details, $('div.atlas-review-workspace-detail'));
				card.classList.add(attentionClass(item.attentionLevel));
				const label = DOM.append(card, $('div.atlas-review-workspace-detail-label'));
				label.textContent = item.label;
				const value = DOM.append(card, $('div.atlas-review-workspace-detail-value'));
				value.textContent = item.value;
			}
		}

		if (model.links.length > 0) {
			const links = DOM.append(root, $('div.atlas-review-workspace-links'));
			for (const link of model.links) {
				this.renderReviewLink(links, link);
			}
		}

		const actions = DOM.append(root, $('section.atlas-review-workspace-actions'));
		for (const action of model.actions) {
			this.renderReviewAction(actions, action, model);
		}

		if (model.entries.length === 0) {
			const empty = DOM.append(root, $('.atlas-center-shell-empty'));
			const emptyTitle = DOM.append(empty, $('div.atlas-center-shell-empty-title'));
			emptyTitle.textContent = localize2('atlasCenterShell.reviewEmpty', 'No review targets').value;
			const emptyMessage = DOM.append(empty, $('div.atlas-center-shell-empty-message'));
			emptyMessage.textContent = model.emptyMessage;
			return;
		}

		const queue = DOM.append(root, $('section.atlas-review-workspace-queue'));
		const queueTitle = DOM.append(queue, $('div.atlas-review-workspace-section-title'));
		queueTitle.textContent = localize2('atlasCenterShell.reviewQueue', 'Review targets').value;
		const list = DOM.append(queue, $('div.atlas-review-workspace-queue-list'));
		for (const entry of model.entries) {
			this.renderReviewEntry(list, entry);
		}
	}

	private renderReviewLink(container: HTMLElement, link: IAtlasWorkspaceLink): void {
		const button = DOM.append(container, $('button.atlas-review-workspace-link')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = link.label;
		button.addEventListener('click', () => this.openWorkspaceLink(link));
	}

	private renderReviewAction(container: HTMLElement, action: IReviewWorkspaceAction, model: IReviewWorkspaceModel): void {
		const card = DOM.append(container, $('article.atlas-review-workspace-action'));
		card.classList.add(`atlas-review-workspace-action-${action.emphasis}`);
		const button = DOM.append(card, $('button.atlas-review-workspace-action-button')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = action.running ? `${action.label}…` : action.label;
		button.disabled = !action.enabled;
		button.addEventListener('click', () => {
			if (button.disabled || !model.selectedDispatchId || !model.selectedTargetKind) {
				return;
			}
			void this.reviewWorkspaceActions.runAction(action.id, {
				kind: EntityKind.Review,
				id: model.selectedDispatchId,
				reviewTargetKind: model.selectedTargetKind,
			});
		});

		const detail = DOM.append(card, $('div.atlas-review-workspace-action-detail'));
		detail.textContent = action.disabledReason ?? action.description;
		if (action.disabledReason) {
			detail.classList.add('atlas-review-workspace-action-disabled');
		}
	}

	private renderReviewEntry(container: HTMLElement, entry: IReviewWorkspaceEntry): void {
		const button = DOM.append(container, $('button.atlas-review-workspace-entry')) as HTMLButtonElement;
		button.type = 'button';
		button.classList.add(attentionClass(entry.attentionLevel));
		if (entry.selected) {
			button.classList.add('atlas-review-workspace-entry-selected');
		}
		button.addEventListener('click', () => this.fleetManagementService.selectReview(entry.dispatchId, entry.kind));

		const header = DOM.append(button, $('div.atlas-review-workspace-entry-header'));
		const title = DOM.append(header, $('div.atlas-review-workspace-entry-title'));
		title.textContent = entry.title;
		const status = DOM.append(header, $('div.atlas-review-workspace-entry-status'));
		status.textContent = `${entry.kind === ReviewTargetKind.Gate ? 'Gate' : 'Merge'} • ${entry.status}`;

		const subtitle = DOM.append(button, $('div.atlas-review-workspace-entry-subtitle'));
		subtitle.textContent = entry.subtitle;
	}

	private renderInspector(container: HTMLElement, model: IAtlasInspectorModel): void {
		const root = DOM.append(container, $('section.atlas-center-shell-inspector'));
		const header = DOM.append(root, $('div.atlas-center-shell-inspector-header'));
		const title = DOM.append(header, $('h2.atlas-center-shell-inspector-title'));
		title.textContent = model.title;
		const subtitle = DOM.append(header, $('div.atlas-center-shell-inspector-subtitle'));
		subtitle.textContent = model.subtitle;

		const sections = DOM.append(root, $('div.atlas-center-shell-inspector-sections'));
		this.renderInspectorOverview(sections, model);
		this.renderInspectorWorktree(sections, model);
		this.renderInspectorResult(sections, model);
		this.renderInspectorArtifacts(sections, model);
		this.renderInspectorMemory(sections, model);
		this.renderInspectorActivity(sections, model);
		this.renderInspectorTranscript(sections, model);
		this.renderInspectorProvenance(sections, model);
	}

	private renderInspectorOverview(container: HTMLElement, model: IAtlasInspectorModel): void {
		const section = this.renderInspectorSection(container, model.overview);
		const details = DOM.append(section, $('div.atlas-inspector-overview-details'));
		for (const item of model.overview.details) {
			const card = DOM.append(details, $('div.atlas-inspector-detail'));
			card.classList.add(attentionClass(item.attentionLevel));
			const label = DOM.append(card, $('div.atlas-inspector-detail-label'));
			label.textContent = item.label;
			const value = DOM.append(card, $('div.atlas-inspector-detail-value'));
			value.textContent = item.value;
		}

		if (model.overview.links.length > 0) {
			const links = DOM.append(section, $('div.atlas-inspector-links'));
			for (const link of model.overview.links) {
				const button = DOM.append(links, $('button.atlas-inspector-link')) as HTMLButtonElement;
				button.type = 'button';
				button.textContent = link.label;
				button.addEventListener('click', () => this.openWorkspaceLink(link));
			}
		}
	}

	private renderInspectorWorktree(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.worktree, content => {
			const list = DOM.append(content, $('div.atlas-inspector-card-list'));
			for (const entry of model.worktree.entries) {
				const card = DOM.append(list, $('article.atlas-inspector-card'));
				card.classList.add(attentionClass(entry.attentionLevel));
				const heading = DOM.append(card, $('div.atlas-inspector-card-heading'));
				const title = DOM.append(heading, $('div.atlas-inspector-card-title'));
				title.textContent = basename(entry.worktreePath) || entry.worktreePath;
				const status = DOM.append(heading, $('div.atlas-inspector-card-status'));
				status.textContent = entry.workingTreeClean === undefined ? 'unknown' : entry.workingTreeClean ? 'clean' : 'dirty';

				const path = DOM.append(card, $('div.atlas-inspector-card-body'));
				path.textContent = entry.worktreePath;

				const meta = DOM.append(card, $('div.atlas-inspector-metadata'));
				this.renderInspectorMeta(meta, 'Dispatch', entry.dispatchId);
				this.renderInspectorMeta(meta, 'Task', entry.taskId);
				this.renderInspectorMeta(meta, 'Branch', entry.branch ?? '—');
				this.renderInspectorMeta(meta, 'Base', entry.baseRef ?? '—');
				this.renderInspectorMeta(meta, 'Head', entry.headSha ?? '—');
				this.renderInspectorMeta(meta, 'Merge ready', entry.mergeReady === undefined ? 'Unknown' : entry.mergeReady ? 'Yes' : 'No');
			}
		});
	}

	private renderInspectorResult(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.result, content => {
			if (!model.result.packet) {
				return;
			}

			const summary = DOM.append(content, $('div.atlas-inspector-card-body'));
			summary.textContent = model.result.packet.summary;

			const meta = DOM.append(content, $('div.atlas-inspector-metadata'));
			this.renderInspectorMeta(meta, 'Status', model.result.packet.status);
			this.renderInspectorMeta(meta, 'Decision', model.result.packet.decision ?? '—');
			this.renderInspectorMeta(meta, 'From role', model.result.packet.from_role);
			this.renderInspectorMeta(meta, 'To role', model.result.packet.to_role);
			this.renderInspectorMeta(meta, 'Branch', model.result.packet.git_branch ?? '—');
			this.renderInspectorMeta(meta, 'Head', model.result.packet.head_sha ?? '—');
			this.renderInspectorMeta(meta, 'Merge ready', model.result.packet.merge_ready ? 'Yes' : 'No');

			this.renderInspectorStringList(content, 'Artifacts', model.result.packet.artifacts);
			this.renderInspectorStringList(content, 'Commands', model.result.packet.commands);
			this.renderInspectorStringList(content, 'Risks', model.result.packet.risks);
			this.renderInspectorStringList(content, 'Next actions', model.result.packet.next_actions);
			this.renderInspectorStringList(content, 'Workspace events', model.result.packet.workspace_events);
		});
	}

	private renderInspectorArtifacts(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.artifacts, content => {
			const inventory = DOM.append(content, $('div.atlas-inspector-list'));
			for (const artifact of model.artifacts.inventory) {
				const row = DOM.append(inventory, $('div.atlas-inspector-list-row'));
				const label = DOM.append(row, $('div.atlas-inspector-list-title'));
				label.textContent = artifact.artifactPath;
				const meta = DOM.append(row, $('div.atlas-inspector-list-subtitle'));
				meta.textContent = `${artifact.kind} • ${formatByteCount(artifact.sizeBytes)}`;
			}

			if (model.artifacts.preview?.textPreview) {
				const preview = DOM.append(content, $('div.atlas-inspector-preformatted'));
				preview.textContent = model.artifacts.preview.textPreview;
			}
		});
	}

	private renderInspectorMemory(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.memory, content => {
			if (model.memory.scopeLabel) {
				const scope = DOM.append(content, $('div.atlas-inspector-note'));
				scope.textContent = model.memory.scopeLabel;
			}

			const list = DOM.append(content, $('div.atlas-inspector-list'));
			for (const record of model.memory.records) {
				const row = DOM.append(list, $('div.atlas-inspector-list-row'));
				const title = DOM.append(row, $('div.atlas-inspector-list-title'));
				title.textContent = record.summary;
				const subtitle = DOM.append(row, $('div.atlas-inspector-list-subtitle'));
				subtitle.textContent = `${record.memoryType} • ${record.scope} • ${record.lifecycle} • ${record.createdByRole} • ${record.createdAt}`;
			}
		});
	}

	private renderInspectorActivity(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.activity, content => {
			const list = DOM.append(content, $('div.atlas-inspector-list'));
			for (const entry of model.activity.entries) {
				const row = DOM.append(list, $('div.atlas-inspector-list-row'));
				const title = DOM.append(row, $('div.atlas-inspector-list-title'));
				title.textContent = entry.summary;
				const subtitle = DOM.append(row, $('div.atlas-inspector-list-subtitle'));
				subtitle.textContent = [
					new Date(entry.timestamp).toLocaleString(),
					entry.kind,
					entry.tool,
					entry.filePath,
					entry.durationMs !== undefined ? `${entry.durationMs}ms` : undefined,
				].filter(Boolean).join(' • ');
			}
		});
	}

	private renderInspectorTranscript(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.transcript, content => {
			if (!model.transcript.snapshot) {
				return;
			}

			const meta = DOM.append(content, $('div.atlas-inspector-metadata'));
			this.renderInspectorMeta(meta, 'Available', model.transcript.snapshot.available ? 'Yes' : 'No');
			this.renderInspectorMeta(meta, 'Dispatch', model.transcript.snapshot.dispatchId);

			if (model.transcript.snapshot.metadata !== undefined) {
				const metadata = DOM.append(content, $('div.atlas-inspector-preformatted'));
				metadata.textContent = JSON.stringify(model.transcript.snapshot.metadata, null, 2);
			}

			if (model.transcript.snapshot.excerptJsonl) {
				const excerpt = DOM.append(content, $('div.atlas-inspector-preformatted'));
				excerpt.textContent = model.transcript.snapshot.excerptJsonl;
			}
		});
	}

	private renderInspectorProvenance(container: HTMLElement, model: IAtlasInspectorModel): void {
		this.renderInspectorSection(container, model.provenance, content => {
			const list = DOM.append(content, $('div.atlas-inspector-list'));
			for (const entry of model.provenance.entries) {
				const row = DOM.append(list, $('div.atlas-inspector-list-row'));
				const title = DOM.append(row, $('div.atlas-inspector-list-title'));
				title.textContent = `${entry.method} • ${entry.outcome}`;
				const subtitle = DOM.append(row, $('div.atlas-inspector-list-subtitle'));
				subtitle.textContent = [entry.actor_role, entry.identity, entry.created_at, entry.rid].filter(Boolean).join(' • ');
				if (entry.provenance !== undefined) {
					const details = DOM.append(row, $('div.atlas-inspector-preformatted'));
					details.textContent = JSON.stringify(entry.provenance, null, 2);
				}
			}
		});
	}

	private renderInspectorSection<T extends { title: string; state: string; message: string | undefined }>(
		container: HTMLElement,
		sectionModel: T,
		renderReady?: (content: HTMLElement) => void,
	): HTMLElement {
		const section = DOM.append(container, $('section.atlas-inspector-section'));
		const header = DOM.append(section, $('div.atlas-inspector-section-header'));
		const title = DOM.append(header, $('div.atlas-inspector-section-title'));
		title.textContent = sectionModel.title;
		const state = DOM.append(header, $('div.atlas-inspector-section-state'));
		state.textContent = inspectorStateLabel(sectionModel.state);
		state.classList.add(`atlas-inspector-section-state-${sectionModel.state}`);

		const content = DOM.append(section, $('div.atlas-inspector-section-content'));
		if (sectionModel.state !== 'ready') {
			const message = DOM.append(content, $('div.atlas-inspector-section-empty'));
			message.textContent = sectionModel.message ?? 'No data available.';
			return content;
		}

		if (sectionModel.message) {
			const note = DOM.append(content, $('div.atlas-inspector-note'));
			note.textContent = sectionModel.message;
		}
		renderReady?.(content);
		return content;
	}

	private renderInspectorMeta(container: HTMLElement, labelText: string, valueText: string): void {
		const item = DOM.append(container, $('div.atlas-inspector-meta-item'));
		const label = DOM.append(item, $('div.atlas-inspector-meta-label'));
		label.textContent = labelText;
		const value = DOM.append(item, $('div.atlas-inspector-meta-value'));
		value.textContent = valueText;
	}

	private renderInspectorStringList(container: HTMLElement, labelText: string, values: readonly string[]): void {
		if (values.length === 0) {
			return;
		}

		const section = DOM.append(container, $('div.atlas-inspector-string-list'));
		const label = DOM.append(section, $('div.atlas-inspector-meta-label'));
		label.textContent = labelText;
		const list = DOM.append(section, $('div.atlas-inspector-badges'));
		for (const value of values) {
			const badge = DOM.append(list, $('span.atlas-inspector-badge'));
			badge.textContent = value;
		}
	}
}

function attentionClass(level: number | undefined): string {
	switch (level) {
		case AttentionLevel.Critical:
			return 'attention-critical';
		case AttentionLevel.NeedsAction:
			return 'attention-needs-action';
		case AttentionLevel.Active:
			return 'attention-active';
		case AttentionLevel.Completed:
			return 'attention-completed';
		default:
			return 'attention-idle';
	}
}

function inspectorStateLabel(state: string): string {
	switch (state) {
		case 'loading':
			return 'Loading';
		case 'empty':
			return 'Empty';
		case 'error':
			return 'Error';
		default:
			return 'Ready';
	}
}

function formatByteCount(value: number): string {
	if (value < 1024) {
		return `${value} B`;
	}
	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} KB`;
	}
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
