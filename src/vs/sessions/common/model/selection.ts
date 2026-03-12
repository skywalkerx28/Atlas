/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum EntityKind {
	Agent = 'agent',
	Task = 'task',
	Objective = 'objective',
	Swarm = 'swarm',
	Review = 'review',
	Worktree = 'worktree',
	Artifact = 'artifact',
}

export const enum NavigationSection {
	Tasks = 'tasks',
	Agents = 'agents',
	Reviews = 'reviews',
	Fleet = 'fleet',
}

export const enum ReviewTargetKind {
	Gate = 'gate',
	Merge = 'merge',
}

export interface IBaseSelectedEntity {
	readonly kind: Exclude<EntityKind, EntityKind.Review>;
	readonly id: string;
}

export interface IReviewSelectedEntity {
	readonly kind: EntityKind.Review;
	readonly id: string;
	readonly reviewTargetKind: ReviewTargetKind;
}

export type ISelectedEntity = IBaseSelectedEntity | IReviewSelectedEntity;

export interface INavigationSelection {
	readonly section: NavigationSection;
	readonly entity: ISelectedEntity | undefined;
}
