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
import { buildAtlasShellModel } from './atlasNavigationModel.js';

const $ = DOM.$;

export class AtlasCenterShellViewPane extends ViewPane {

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
		container.classList.add('atlas-center-shell-view-pane');

		this._register(autorun(reader => {
			const model = buildAtlasShellModel(this.fleetManagementService.selection.read(reader), {
				connection: this.harnessService.connectionState.read(reader),
				swarms: this.harnessService.swarms.read(reader),
				tasks: this.harnessService.tasks.read(reader),
				objectives: this.harnessService.objectives.read(reader),
				fleet: this.harnessService.fleet.read(reader),
				health: this.harnessService.health.read(reader),
				reviewGates: this.harnessService.reviewGates.read(reader),
				mergeQueue: this.harnessService.mergeQueue.read(reader),
			});
			this.renderShell(model);
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
