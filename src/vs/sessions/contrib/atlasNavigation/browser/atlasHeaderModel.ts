/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 9 Atlas header is sessions-only contrib code that summarizes sessions service state without introducing workbench leakage. */

import { basename } from '../../../../base/common/path.js';
import { AttentionLevel } from '../../../common/model/attention.js';
import { NavigationSection, EntityKind, ReviewTargetKind, type INavigationSelection } from '../../../common/model/selection.js';
import { HarnessConnectionState, type IHarnessConnectionInfo } from '../../../services/harness/common/harnessService.js';
import { buildAtlasLayoutProfileModel, type IAtlasLayoutProfileOption } from './atlasLayoutProfileModel.js';
import { buildSectionDescriptors } from './atlasNavigationModel.js';

export interface IAtlasHeaderBreadcrumb {
	readonly id: string;
	readonly label: string;
}

export interface IAtlasHeaderStatusChip {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly attentionLevel: AttentionLevel | undefined;
}

export interface IAtlasHeaderPivot {
	readonly id: string;
	readonly section: NavigationSection;
	readonly label: string;
	readonly count: number;
	readonly selected: boolean;
	readonly attentionLevel: AttentionLevel;
}

export interface IAtlasHeaderModel {
	readonly brandLabel: string;
	readonly projectLabel: string;
	readonly fabricLabel: string;
	readonly contextTitle: string;
	readonly contextSubtitle: string;
	readonly breadcrumbs: readonly IAtlasHeaderBreadcrumb[];
	readonly statusChips: readonly IAtlasHeaderStatusChip[];
	readonly pivots: readonly IAtlasHeaderPivot[];
	readonly layoutProfiles: readonly IAtlasLayoutProfileOption[];
}

interface IAtlasHeaderStateSnapshot {
	readonly connection: IHarnessConnectionInfo;
	readonly swarms: readonly AtlasModel.ISwarmState[];
	readonly tasks: readonly AtlasModel.ITaskState[];
	readonly objectives: readonly AtlasModel.IObjectiveState[];
	readonly fleet: AtlasModel.IFleetState;
	readonly health: AtlasModel.IHealthState;
	readonly reviewGates: readonly AtlasModel.IReviewGateState[];
	readonly mergeQueue: readonly AtlasModel.IMergeEntry[];
}

export function buildAtlasHeaderModel(
	selection: INavigationSelection,
	state: IAtlasHeaderStateSnapshot,
	workspaceName: string | undefined,
	layoutProfile: AtlasModel.AtlasLayoutProfile,
): IAtlasHeaderModel {
	const criticalSwarms = state.swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.Critical).length;
	const needsActionSwarms = state.swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.NeedsAction).length;
	const sectionLabel = sectionDisplayLabel(selection.section);
	const sectionDescriptors = buildSectionDescriptors(state.connection, state.swarms, state.fleet, state.reviewGates, state.mergeQueue);
	const context = buildContext(selection, state);
	const layoutProfileModel = buildAtlasLayoutProfileModel(layoutProfile);
	const projectLabel = resolveProjectLabel(workspaceName, state.connection);
	const fabricLabel = state.connection.fabricIdentity
		? `Fabric ${state.connection.fabricIdentity.fabric_id}`
		: state.connection.state === HarnessConnectionState.Connected && state.connection.mode === 'polling'
			? 'Read-only polling attached'
			: state.connection.state === HarnessConnectionState.Connecting || state.connection.state === HarnessConnectionState.Reconnecting
				? 'Connecting to harness fabric'
				: state.connection.state === HarnessConnectionState.Error
					? 'Harness unavailable'
					: 'No harness fabric attached';

	return {
		brandLabel: 'Atlas',
		projectLabel,
		fabricLabel,
		contextTitle: context.title,
		contextSubtitle: context.subtitle,
		breadcrumbs: Object.freeze([
			{ id: `section:${selection.section}`, label: sectionLabel },
			...context.breadcrumbs,
		]),
		statusChips: Object.freeze([
			statusChip('connection', 'Connection', connectionValue(state.connection), connectionAttention(state.connection)),
			statusChip('health', 'Health', formatStateLabel(state.health.mode), state.health.attentionLevel),
			statusChip('queue', 'Queue', String(state.health.queueDepth), state.health.queueDepth > 0 ? AttentionLevel.Active : AttentionLevel.Idle),
			statusChip('active', 'Active', String(state.fleet.activeCount), state.fleet.activeCount > 0 ? AttentionLevel.Active : AttentionLevel.Idle),
			statusChip('blocked', 'Blocked', String(state.fleet.blockedCount), state.fleet.blockedCount > 0 ? AttentionLevel.NeedsAction : AttentionLevel.Idle),
			statusChip('failed', 'Failed', String(state.fleet.failedCount), state.fleet.failedCount > 0 ? AttentionLevel.Critical : AttentionLevel.Idle),
			statusChip('critical-swarms', 'Critical', String(criticalSwarms), criticalSwarms > 0 ? AttentionLevel.Critical : AttentionLevel.Idle),
			statusChip('needs-action-swarms', 'Needs action', String(needsActionSwarms), needsActionSwarms > 0 ? AttentionLevel.NeedsAction : AttentionLevel.Idle),
		]),
		pivots: Object.freeze(sectionDescriptors.map(descriptor => ({
			id: descriptor.section,
			section: descriptor.section,
			label: descriptor.label,
			count: descriptor.count,
			selected: descriptor.section === selection.section,
			attentionLevel: descriptor.attentionLevel,
		}))),
		layoutProfiles: layoutProfileModel.options,
	};
}

function buildContext(
	selection: INavigationSelection,
	state: IAtlasHeaderStateSnapshot,
): {
	readonly title: string;
	readonly subtitle: string;
	readonly breadcrumbs: readonly IAtlasHeaderBreadcrumb[];
} {
	const entity = selection.entity;
	if (!entity) {
		return {
			title: sectionDisplayLabel(selection.section),
			subtitle: defaultSectionSubtitle(selection.section),
			breadcrumbs: Object.freeze([]),
		};
	}

	switch (entity.kind) {
		case EntityKind.Swarm: {
			const swarm = state.swarms.find(candidate => candidate.swarmId === entity.id);
			const title = swarm?.objectiveProblemStatement ?? `Swarm ${entity.id}`;
			return {
				title,
				subtitle: `Root task ${swarm?.rootTaskId ?? entity.id} · ${swarm?.taskIds.length ?? 0} task${swarm?.taskIds.length === 1 ? '' : 's'} · ${swarm?.agentDispatchIds.length ?? 0} agent${swarm?.agentDispatchIds.length === 1 ? '' : 's'}`,
				breadcrumbs: Object.freeze([
					{ id: 'kind:swarm', label: 'Swarm' },
					{ id: `swarm:${entity.id}`, label: title },
				]),
			};
		}
		case EntityKind.Task: {
			const task = state.tasks.find(candidate => candidate.taskId === entity.id);
			const swarm = state.swarms.find(candidate => candidate.taskIds.includes(entity.id));
			const title = task?.summary || entity.id;
			return {
				title,
				subtitle: `Task ${entity.id}${swarm ? ` · Swarm ${swarm.swarmId}` : ''}`,
				breadcrumbs: Object.freeze([
					{ id: 'kind:task', label: 'Task' },
					{ id: `task:${entity.id}`, label: title },
				]),
			};
		}
		case EntityKind.Objective: {
			const objective = state.objectives.find(candidate => candidate.objectiveId === entity.id);
			const title = objective?.problemStatement || entity.id;
			return {
				title,
				subtitle: objective?.rootTaskId ? `Objective ${entity.id} · Root task ${objective.rootTaskId}` : `Objective ${entity.id}`,
				breadcrumbs: Object.freeze([
					{ id: 'kind:objective', label: 'Objective' },
					{ id: `objective:${entity.id}`, label: title },
				]),
			};
		}
		case EntityKind.Agent: {
			const agent = state.fleet.agents.find(candidate => candidate.dispatchId === entity.id);
			const swarm = agent ? state.swarms.find(candidate => candidate.taskIds.includes(agent.taskId)) : undefined;
			const title = agent ? `${agent.roleId} · ${agent.dispatchId}` : `Agent ${entity.id}`;
			return {
				title,
				subtitle: agent ? `Task ${agent.taskId}${swarm ? ` · Swarm ${swarm.swarmId}` : ''} · ${formatStateLabel(agent.status)}` : `Dispatch ${entity.id}`,
				breadcrumbs: Object.freeze([
					{ id: 'kind:agent', label: 'Agent' },
					{ id: `agent:${entity.id}`, label: title },
				]),
			};
		}
		case EntityKind.Review: {
			const targetKindLabel = entity.reviewTargetKind === ReviewTargetKind.Merge ? 'Merge' : 'Gate';
			const gate = entity.reviewTargetKind === ReviewTargetKind.Gate
				? state.reviewGates.find(candidate => candidate.dispatchId === entity.id)
				: undefined;
			const merge = entity.reviewTargetKind === ReviewTargetKind.Merge
				? state.mergeQueue.find(candidate => candidate.dispatchId === entity.id)
				: undefined;
			const title = entity.reviewTargetKind === ReviewTargetKind.Gate
				? (gate?.roleId ? `${gate.roleId} gate` : `Gate ${entity.id}`)
				: (merge?.candidateBranch ? `${basename(merge.candidateBranch)} merge` : `Merge ${entity.id}`);
			return {
				title,
				subtitle: `Dispatch ${entity.id}${gate ? ` · ${formatStateLabel(gate.reviewState)}` : merge ? ` · ${formatStateLabel(merge.status)}` : ''}`,
				breadcrumbs: Object.freeze([
					{ id: `kind:${entity.reviewTargetKind}`, label: targetKindLabel },
					{ id: `review:${entity.reviewTargetKind}:${entity.id}`, label: title },
				]),
			};
		}
		case EntityKind.Worktree:
		case EntityKind.Artifact:
			return {
				title: entity.id,
				subtitle: `Selected ${entity.kind}`,
				breadcrumbs: Object.freeze([
					{ id: `kind:${entity.kind}`, label: formatStateLabel(entity.kind) },
					{ id: `${entity.kind}:${entity.id}`, label: entity.id },
				]),
			};
	}
}

function statusChip(
	id: string,
	label: string,
	value: string,
	attentionLevel: AttentionLevel | undefined,
): IAtlasHeaderStatusChip {
	return { id, label, value, attentionLevel };
}

function connectionValue(connection: IHarnessConnectionInfo): string {
	switch (connection.state) {
		case HarnessConnectionState.Connected:
			return connection.mode === 'daemon' ? 'Daemon connected' : connection.mode === 'polling' ? 'Polling read-only' : 'Connected';
		case HarnessConnectionState.Connecting:
			return 'Connecting';
		case HarnessConnectionState.Reconnecting:
			return 'Reconnecting';
		case HarnessConnectionState.Error:
			return 'Connection error';
		case HarnessConnectionState.Disconnected:
		default:
			return 'Disconnected';
	}
}

function resolveProjectLabel(
	workspaceName: string | undefined,
	connection: IHarnessConnectionInfo,
): string {
	if (workspaceName) {
		return workspaceName;
	}
	if (connection.fabricIdentity) {
		return basename(connection.fabricIdentity.repo_root);
	}
	return 'No workspace attached';
}

function connectionAttention(connection: IHarnessConnectionInfo): AttentionLevel {
	switch (connection.state) {
		case HarnessConnectionState.Error:
		case HarnessConnectionState.Disconnected:
			return AttentionLevel.NeedsAction;
		case HarnessConnectionState.Connecting:
		case HarnessConnectionState.Reconnecting:
			return AttentionLevel.Active;
		case HarnessConnectionState.Connected:
		default:
			return AttentionLevel.Idle;
	}
}

function sectionDisplayLabel(section: NavigationSection): string {
	switch (section) {
		case NavigationSection.Tasks:
			return 'Tasks';
		case NavigationSection.Agents:
			return 'Agents';
		case NavigationSection.Reviews:
			return 'Reviews';
		case NavigationSection.Fleet:
			return 'Fleet';
	}
}

function defaultSectionSubtitle(section: NavigationSection): string {
	switch (section) {
		case NavigationSection.Tasks:
			return 'Swarm-rooted work across the current harness fabric.';
		case NavigationSection.Agents:
			return 'Live execution state for current and recent agents.';
		case NavigationSection.Reviews:
			return 'Authoritative review-gate and merge-lane state for the current fabric.';
		case NavigationSection.Fleet:
			return 'Operational status across connection, health, and live capacity.';
	}
}

function formatStateLabel(value: string): string {
	return value.replace(/_/g, ' ');
}
