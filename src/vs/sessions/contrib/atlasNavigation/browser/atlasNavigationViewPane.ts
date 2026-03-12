/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 Atlas navigation panes are sessions-only surfaces that consume sessions service contracts via DI. */

import './media/atlasNavigationViewPane.css';
import * as DOM from '../../../../base/browser/dom.js';
import { autorun } from '../../../../base/common/observable.js';
import { localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { AttentionLevel } from '../../../common/model/attention.js';
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
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { EntityKind, NavigationSection } from '../../../common/model/selection.js';
import { IFleetManagementService } from '../../../services/fleet/common/fleetManagementService.js';
import { IHarnessService } from '../../../services/harness/common/harnessService.js';
import {
	buildAgentNavigationItems,
	buildFleetOverview,
	buildReviewNavigationItems,
	buildSectionDescriptors,
	buildTaskNavigationItems,
	emptyMessageForConnection,
	formatConnectionLabel,
	formatStateLabel,
	ReviewNavigationKind,
	type IAgentNavigationItem,
	type IAtlasSectionDescriptor,
	type IFleetOverview,
	type IReviewNavigationItem,
	type ITaskNavigationItem,
} from './atlasNavigationModel.js';

const $ = DOM.$;

export const AtlasNavigationViewId = 'atlas.workbench.view.navigation';

export class AtlasNavigationViewPane extends ViewPane {

	private bodyContainer: HTMLElement | undefined;

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
		@IFleetManagementService private readonly fleetManagementService: IFleetManagementService,
		@IHarnessService private readonly harnessService: IHarnessService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.bodyContainer = container;
		container.classList.add('atlas-navigation-view-pane');

		this._register(autorun(reader => {
			const selection = this.fleetManagementService.selection.read(reader);
			const sectionDescriptors = buildSectionDescriptors(
				this.harnessService.connectionState.read(reader),
				this.harnessService.swarms.read(reader),
				this.harnessService.fleet.read(reader),
				this.harnessService.reviewGates.read(reader),
				this.harnessService.mergeQueue.read(reader),
			);
			const tasks = buildTaskNavigationItems(this.harnessService.swarms.read(reader));
			const agents = buildAgentNavigationItems(this.harnessService.fleet.read(reader), this.harnessService.swarms.read(reader));
			const reviews = buildReviewNavigationItems(
				this.harnessService.reviewGates.read(reader),
				this.harnessService.mergeQueue.read(reader),
				this.harnessService.swarms.read(reader),
			);
			const fleetOverview = buildFleetOverview(
				this.harnessService.connectionState.read(reader),
				this.harnessService.fleet.read(reader),
				this.harnessService.health.read(reader),
				this.harnessService.swarms.read(reader),
			);

			this.renderNavigation(selection.section, selection.entity, sectionDescriptors, tasks, agents, reviews, fleetOverview);
		}));
	}

	private renderNavigation(
		section: AtlasModel.NavigationSection,
		entity: AtlasModel.ISelectedEntity | undefined,
		sections: readonly IAtlasSectionDescriptor[],
		taskItems: readonly ITaskNavigationItem[],
		agentItems: readonly IAgentNavigationItem[],
		reviewItems: readonly IReviewNavigationItem[],
		fleetOverview: IFleetOverview,
	): void {
		if (!this.bodyContainer) {
			return;
		}

		DOM.clearNode(this.bodyContainer);

		const root = DOM.append(this.bodyContainer, $('.atlas-navigation-root'));
		const header = DOM.append(root, $('.atlas-navigation-header'));
		const headerTitle = DOM.append(header, $('div.atlas-navigation-header-title'));
		headerTitle.textContent = localize2('atlasNavigation.title', "Atlas").value;
		const headerStatus = DOM.append(header, $('div.atlas-navigation-header-status'));
		headerStatus.textContent = `${formatConnectionLabel(this.harnessService.connectionState.get())} • ${formatStateLabel(this.harnessService.health.get().mode)}`;

		const sectionsContainer = DOM.append(root, $('.atlas-navigation-sections'));
		for (const sectionDescriptor of sections) {
			const button = DOM.append(sectionsContainer, $('button.atlas-navigation-section-button')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.toggle('selected', sectionDescriptor.section === section);
			button.classList.add(attentionClass(sectionDescriptor.attentionLevel));
			button.setAttribute('aria-pressed', String(sectionDescriptor.section === section));
			button.addEventListener('click', () => this.fleetManagementService.selectSection(sectionDescriptor.section));

			const label = DOM.append(button, $('span.atlas-navigation-section-label'));
			label.textContent = sectionDescriptor.label;
			const count = DOM.append(button, $('span.atlas-navigation-section-count'));
			count.textContent = String(sectionDescriptor.count);
		}

		const content = DOM.append(root, $('.atlas-navigation-content'));
		switch (section) {
			case NavigationSection.Tasks:
				this.renderTaskSection(content, taskItems, entity);
				return;
			case NavigationSection.Agents:
				this.renderAgentSection(content, agentItems, entity);
				return;
			case NavigationSection.Reviews:
				this.renderReviewSection(content, reviewItems, entity);
				return;
			case NavigationSection.Fleet:
				this.renderFleetSection(content, fleetOverview, taskItems, agentItems);
				return;
		}
	}

	private renderTaskSection(
		container: HTMLElement,
		items: readonly ITaskNavigationItem[],
		entity: AtlasModel.ISelectedEntity | undefined,
	): void {
		this.renderSectionHeading(container, localize2('atlasNavigation.tasks', "Swarm-rooted tasks").value, `${items.length} swarms`);
		if (items.length === 0) {
			this.renderEmpty(container, emptyMessageForConnection(this.harnessService.connectionState.get(), 'No rooted swarms are available yet.'));
			return;
		}

		const list = DOM.append(container, $('.atlas-navigation-list'));
		for (const item of items) {
			const button = DOM.append(list, $('button.atlas-navigation-item')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.toggle('selected', entity?.kind === EntityKind.Swarm && entity.id === item.swarmId);
			button.classList.add(attentionClass(item.attentionLevel));
			button.addEventListener('click', () => this.fleetManagementService.selectSwarm(item.swarmId));

			const title = DOM.append(button, $('div.atlas-navigation-item-title'));
			title.textContent = item.title;
			const subtitle = DOM.append(button, $('div.atlas-navigation-item-subtitle'));
			subtitle.textContent = `${item.subtitle} • ${formatStateLabel(item.phase)}`;
			const meta = DOM.append(button, $('div.atlas-navigation-item-meta'));
			meta.textContent = `${item.taskCount} tasks • ${item.agentCount} agents`;
			if (item.reviewNeeded || item.mergeBlocked) {
				const flag = DOM.append(button, $('div.atlas-navigation-item-flag'));
				flag.textContent = item.mergeBlocked ? 'Merge blocked' : 'Review needed';
			}
		}
	}

	private renderAgentSection(
		container: HTMLElement,
		items: readonly IAgentNavigationItem[],
		entity: AtlasModel.ISelectedEntity | undefined,
	): void {
		this.renderSectionHeading(container, localize2('atlasNavigation.agents', "Agents").value, `${items.length} visible agents`);
		if (items.length === 0) {
			this.renderEmpty(container, emptyMessageForConnection(this.harnessService.connectionState.get(), 'No agents are visible for this workspace.'));
			return;
		}

		const list = DOM.append(container, $('.atlas-navigation-list'));
		for (const item of items) {
			const button = DOM.append(list, $('button.atlas-navigation-item')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.toggle('selected', entity?.kind === EntityKind.Agent && entity.id === item.dispatchId);
			button.classList.add(attentionClass(item.attentionLevel));
			button.addEventListener('click', () => this.fleetManagementService.selectAgent(item.dispatchId));

			const title = DOM.append(button, $('div.atlas-navigation-item-title'));
			title.textContent = item.title;
			const subtitle = DOM.append(button, $('div.atlas-navigation-item-subtitle'));
			subtitle.textContent = `${formatStateLabel(item.status)} • ${item.subtitle}`;
			const meta = DOM.append(button, $('div.atlas-navigation-item-meta'));
			meta.textContent = item.swarmId ? `Swarm ${item.swarmId}` : item.taskId;
		}
	}

	private renderReviewSection(
		container: HTMLElement,
		items: readonly IReviewNavigationItem[],
		entity: AtlasModel.ISelectedEntity | undefined,
	): void {
		const outstanding = items.filter(item => item.kind === ReviewNavigationKind.Gate).length;
		this.renderSectionHeading(container, localize2('atlasNavigation.reviews', "Reviews").value, `${outstanding} gate entries`);
		if (items.length === 0) {
			this.renderEmpty(container, emptyMessageForConnection(this.harnessService.connectionState.get(), 'No review or merge entries are available.'));
			return;
		}

		const list = DOM.append(container, $('.atlas-navigation-list'));
		for (const item of items) {
			const button = DOM.append(list, $('button.atlas-navigation-item')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.toggle('selected', entity?.kind === EntityKind.Review && entity.id === item.dispatchId);
			button.classList.add(attentionClass(item.attentionLevel));
			button.addEventListener('click', () => this.fleetManagementService.selectReview(item.dispatchId));

			const titleRow = DOM.append(button, $('div.atlas-navigation-item-title-row'));
			const title = DOM.append(titleRow, $('div.atlas-navigation-item-title'));
			title.textContent = item.title;
			const kind = DOM.append(titleRow, $('span.atlas-navigation-kind-badge'));
			kind.textContent = item.kind === ReviewNavigationKind.Gate ? 'Gate' : 'Merge';

			const subtitle = DOM.append(button, $('div.atlas-navigation-item-subtitle'));
			subtitle.textContent = `${item.status} • ${item.subtitle}`;
			const meta = DOM.append(button, $('div.atlas-navigation-item-meta'));
			meta.textContent = item.swarmId ? `Swarm ${item.swarmId}` : item.taskId;
		}
	}

	private renderFleetSection(
		container: HTMLElement,
		overview: IFleetOverview,
		taskItems: readonly ITaskNavigationItem[],
		agentItems: readonly IAgentNavigationItem[],
	): void {
		this.renderSectionHeading(container, localize2('atlasNavigation.fleet', "Fleet").value, overview.connectionLabel);

		const cards = DOM.append(container, $('.atlas-navigation-fleet-cards'));
		for (const [label, value] of [
			['Swarms', String(overview.swarmCount)],
			['Running', String(overview.activeAgents)],
			['Needs action', String(overview.needsActionSwarms + overview.blockedAgents + overview.failedAgents)],
			['Queue depth', String(overview.queueDepth)],
		] as const) {
			const card = DOM.append(cards, $('.atlas-navigation-fleet-card'));
			const cardLabel = DOM.append(card, $('div.atlas-navigation-fleet-card-label'));
			cardLabel.textContent = label;
			const cardValue = DOM.append(card, $('div.atlas-navigation-fleet-card-value'));
			cardValue.textContent = value;
		}

		const topAttentionHeading = DOM.append(container, $('div.atlas-navigation-heading.atlas-navigation-subheading'));
		topAttentionHeading.textContent = localize2('atlasNavigation.topAttention', "Top attention").value;
		const list = DOM.append(container, $('.atlas-navigation-list'));
		for (const swarm of taskItems.slice(0, 3)) {
			const button = DOM.append(list, $('button.atlas-navigation-item')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.add(attentionClass(swarm.attentionLevel));
			button.addEventListener('click', () => this.fleetManagementService.selectSwarm(swarm.swarmId));
			const icon = DOM.append(button, $('div.atlas-navigation-item-title-row'));
			icon.appendChild(renderIcon(Codicon.graph));
			const title = DOM.append(icon, $('div.atlas-navigation-item-title'));
			title.textContent = swarm.title;
			const subtitle = DOM.append(button, $('div.atlas-navigation-item-subtitle'));
			subtitle.textContent = `${formatStateLabel(swarm.phase)} • ${swarm.taskCount} tasks`;
		}
		for (const agent of agentItems.slice(0, 2)) {
			const button = DOM.append(list, $('button.atlas-navigation-item')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.add(attentionClass(agent.attentionLevel));
			button.addEventListener('click', () => this.fleetManagementService.selectAgent(agent.dispatchId));
			const icon = DOM.append(button, $('div.atlas-navigation-item-title-row'));
			icon.appendChild(renderIcon(Codicon.person));
			const title = DOM.append(icon, $('div.atlas-navigation-item-title'));
			title.textContent = agent.title;
			const subtitle = DOM.append(button, $('div.atlas-navigation-item-subtitle'));
			subtitle.textContent = `${formatStateLabel(agent.status)} • ${agent.subtitle}`;
		}
	}

	private renderSectionHeading(container: HTMLElement, title: string, subtitle: string): void {
		const heading = DOM.append(container, $('.atlas-navigation-heading'));
		const headingTitle = DOM.append(heading, $('div.atlas-navigation-heading-title'));
		headingTitle.textContent = title;
		const headingSubtitle = DOM.append(heading, $('div.atlas-navigation-heading-subtitle'));
		headingSubtitle.textContent = subtitle;
	}

	private renderEmpty(container: HTMLElement, message: string): void {
		const empty = DOM.append(container, $('.atlas-navigation-empty'));
		empty.textContent = message;
	}
}

function attentionClass(level: number): string {
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
