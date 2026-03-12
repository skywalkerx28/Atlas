/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 keeps sessions-only navigation registration inside the sessions contribution to avoid workbench leakage. */

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewDescriptor, IViewsRegistry, Extensions as ViewContainerExtensions, WindowVisibility, ViewContainer, IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views.js';
import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SessionsTitleBarContribution } from './sessionsTitleBarWidget.js';
import { AtlasNavigationViewPane, AtlasNavigationViewId } from '../../atlasNavigation/browser/atlasNavigationViewPane.js';
import { SessionsManagementService, ISessionsManagementService } from './sessionsManagementService.js';
import { FleetManagementService } from '../../../services/fleet/browser/fleetManagementService.js';
import { IFleetManagementService } from '../../../services/fleet/common/fleetManagementService.js';

const agentSessionsViewIcon = registerIcon('atlas-navigation-icon', Codicon.listTree, localize('atlasNavigationIcon', 'Icon for Atlas navigation in the sessions window'));
const AGENT_SESSIONS_VIEW_TITLE = localize2('atlasNavigation.view.label', "Atlas");
const SessionsContainerId = 'agentic.workbench.view.sessionsContainer';

const agentSessionsViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: SessionsContainerId,
	title: AGENT_SESSIONS_VIEW_TITLE,
	icon: agentSessionsViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [SessionsContainerId, { mergeViewWithContainerWhenSingleView: true, }]),
	storageId: SessionsContainerId,
	hideIfEmpty: true,
	order: 6,
	windowVisibility: WindowVisibility.Sessions
}, ViewContainerLocation.Sidebar, { isDefault: true });

const agentSessionsViewDescriptor: IViewDescriptor = {
	id: AtlasNavigationViewId,
	containerIcon: agentSessionsViewIcon,
	containerTitle: AGENT_SESSIONS_VIEW_TITLE.value,
	singleViewPaneContainerTitle: AGENT_SESSIONS_VIEW_TITLE.value,
	name: AGENT_SESSIONS_VIEW_TITLE,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(AtlasNavigationViewPane),
	windowVisibility: WindowVisibility.Sessions
};

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([agentSessionsViewDescriptor], agentSessionsViewContainer);

registerWorkbenchContribution2(SessionsTitleBarContribution.ID, SessionsTitleBarContribution, WorkbenchPhase.AfterRestored);

registerSingleton(ISessionsManagementService, SessionsManagementService, InstantiationType.Delayed);
registerSingleton(IFleetManagementService, FleetManagementService, InstantiationType.Delayed);
