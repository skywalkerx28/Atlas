/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 Atlas center shell is a sessions-only pane wired to sessions service contracts via DI. */

import './media/atlasCenterShellViewPane.css';
import * as DOM from '../../../../base/browser/dom.js';
import { autorun } from '../../../../base/common/observable.js';
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
import { IFleetManagementService } from '../../../services/fleet/common/fleetManagementService.js';
import { IHarnessService } from '../../../services/harness/common/harnessService.js';
import { buildAtlasShellModel, buildFleetCommandModel, buildReviewWorkspaceModel, type IReviewWorkspaceAction, type IReviewWorkspaceEntry, type IReviewWorkspaceLink, type IReviewWorkspaceModel } from './atlasNavigationModel.js';
import { AtlasReviewWorkspaceActionController } from './atlasReviewWorkspaceActions.js';

const $ = DOM.$;

export class AtlasCenterShellViewPane extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private readonly reviewWorkspaceActions: AtlasReviewWorkspaceActionController;

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
			const reviewUiState = this.reviewWorkspaceActions.uiState.read(reader);
			const state = {
				connection: this.harnessService.connectionState.read(reader),
				swarms: this.harnessService.swarms.read(reader),
				tasks: this.harnessService.tasks.read(reader),
				objectives: this.harnessService.objectives.read(reader),
				fleet: this.harnessService.fleet.read(reader),
				health: this.harnessService.health.read(reader),
				reviewGates: this.harnessService.reviewGates.read(reader),
				mergeQueue: this.harnessService.mergeQueue.read(reader),
			};

			if (selection.section === NavigationSection.Fleet) {
				this.renderFleetCommand(buildFleetCommandModel(state));
				return;
			}

			if (selection.section === NavigationSection.Reviews) {
				this.renderReviewWorkspace(buildReviewWorkspaceModel(selection, state, reviewUiState));
				return;
			}

			this.renderShell(buildAtlasShellModel(selection, state));
		}));
	}

	private renderShell(model: ReturnType<typeof buildAtlasShellModel>): void {
		if (!this.bodyContainer) {
			return;
		}

		DOM.clearNode(this.bodyContainer);

		const root = DOM.append(this.bodyContainer, $('.atlas-center-shell-root'));
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

	private renderFleetCommand(model: ReturnType<typeof buildFleetCommandModel>): void {
		if (!this.bodyContainer) {
			return;
		}

		DOM.clearNode(this.bodyContainer);

		const root = DOM.append(this.bodyContainer, $('.atlas-center-shell-root.atlas-center-shell-root-fleet'));
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

	private renderReviewWorkspace(model: IReviewWorkspaceModel): void {
		if (!this.bodyContainer) {
			return;
		}

		DOM.clearNode(this.bodyContainer);

		const root = DOM.append(this.bodyContainer, $('.atlas-center-shell-root.atlas-center-shell-root-review'));
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

	private renderReviewLink(container: HTMLElement, link: IReviewWorkspaceLink): void {
		const button = DOM.append(container, $('button.atlas-review-workspace-link')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = link.label;
		button.addEventListener('click', () => this.fleetManagementService.selectEntity(link.target));
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
