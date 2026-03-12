/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, WindowVisibility } from '../../../../workbench/common/views.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { IPaneCompositePartService } from '../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { ATLAS_CENTER_SHELL_CONTAINER_ID, ATLAS_CENTER_SHELL_VIEW_ID } from '../../../common/navigation.js';
import { AtlasCenterShellViewPane } from './atlasCenterShellViewPane.js';

const atlasCenterShellIcon = registerIcon('atlas-center-shell-icon', Codicon.layoutPanel, localize2('atlasCenterShellIcon', "View icon for the Atlas center shell.").value);

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const atlasCenterShellContainer = viewContainersRegistry.registerViewContainer({
	id: ATLAS_CENTER_SHELL_CONTAINER_ID,
	title: localize2('atlasCenterShell', "Atlas"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ATLAS_CENTER_SHELL_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: atlasCenterShellIcon,
	storageId: ATLAS_CENTER_SHELL_CONTAINER_ID,
	hideIfEmpty: true,
	order: 0,
	windowVisibility: WindowVisibility.Sessions,
}, ViewContainerLocation.ChatBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: ATLAS_CENTER_SHELL_VIEW_ID,
	name: localize2('atlasCenterShell', "Atlas"),
	containerIcon: atlasCenterShellIcon,
	containerTitle: atlasCenterShellContainer.title.value,
	singleViewPaneContainerTitle: atlasCenterShellContainer.title.value,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(AtlasCenterShellViewPane),
	windowVisibility: WindowVisibility.Sessions,
}], atlasCenterShellContainer);

class AtlasCenterShellStartupContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.atlasCenterShellStartup';

	constructor(
		@IPaneCompositePartService paneCompositePartService: IPaneCompositePartService,
	) {
		void paneCompositePartService.openPaneComposite(ATLAS_CENTER_SHELL_CONTAINER_ID, ViewContainerLocation.ChatBar, false);
	}
}

registerWorkbenchContribution2(AtlasCenterShellStartupContribution.ID, AtlasCenterShellStartupContribution, WorkbenchPhase.AfterRestored);
