/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IFleetManagementService = createDecorator<IFleetManagementService>('fleetManagementService');

export interface IFleetManagementService {
	readonly _serviceBrand: undefined;

	readonly selection: IObservable<AtlasModel.INavigationSelection>;
	readonly layoutProfile: IObservable<AtlasModel.AtlasLayoutProfile>;
	readonly selectedSection: IObservable<AtlasModel.NavigationSection>;
	readonly selectedEntity: IObservable<AtlasModel.ISelectedEntity | undefined>;
	readonly selectedEntityKind: IObservable<AtlasModel.EntityKind | undefined>;

	selectLayoutProfile(profile: AtlasModel.AtlasLayoutProfile): void;
	selectSection(section: AtlasModel.NavigationSection): void;
	selectEntity(entity: AtlasModel.ISelectedEntity | undefined): void;
	selectAgent(dispatchId: string): void;
	selectTask(taskId: string): void;
	selectObjective(objectiveId: string): void;
	selectSwarm(swarmId: string): void;
	selectReview(dispatchId: string, targetKind?: AtlasModel.ReviewTargetKind): void;
	clearSelection(): void;

	openSwarmBoard(swarmId: string): Promise<void>;
	openObjectiveBoard(objectiveId: string): Promise<void>;
	openAgentView(dispatchId: string): Promise<void>;
	openFleetGrid(): Promise<void>;
	openReview(dispatchId: string, targetKind?: AtlasModel.ReviewTargetKind): Promise<void>;
}
