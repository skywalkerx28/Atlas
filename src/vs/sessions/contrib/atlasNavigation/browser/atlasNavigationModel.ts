/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 Atlas navigation models are sessions-only contrib code that summarizes sessions service state without introducing workbench leakage. */

import { basename } from '../../../../base/common/path.js';
import { AttentionLevel } from '../../../common/model/attention.js';
import { NavigationSection, EntityKind, ReviewTargetKind, type INavigationSelection } from '../../../common/model/selection.js';
import { MergeExecutionStatus, type IReviewGateState } from '../../../common/model/review.js';
import { SwarmPhase, type ISwarmState } from '../../../common/model/swarm.js';
import { TaskStatus, type ITaskState } from '../../../common/model/task.js';
import { WireReviewState } from '../../../common/model/wire.js';
import { HarnessConnectionState, type IHarnessConnectionInfo } from '../../../services/harness/common/harnessService.js';

export interface IAtlasSectionDescriptor {
	readonly section: AtlasModel.NavigationSection;
	readonly label: string;
	readonly count: number;
	readonly attentionLevel: AttentionLevel;
}

export interface ITaskNavigationItem {
	readonly swarmId: string;
	readonly title: string;
	readonly subtitle: string;
	readonly phase: AtlasModel.SwarmPhase;
	readonly attentionLevel: AttentionLevel;
	readonly taskCount: number;
	readonly agentCount: number;
	readonly reviewNeeded: boolean;
	readonly mergeBlocked: boolean;
	readonly updatedAt: number;
}

export interface IAgentNavigationItem {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly swarmId: string | undefined;
	readonly title: string;
	readonly subtitle: string;
	readonly status: AtlasModel.AgentStatus;
	readonly attentionLevel: AttentionLevel;
	readonly updatedAt: number;
}

export interface IReviewNavigationItem {
	readonly id: string;
	readonly dispatchId: string;
	readonly taskId: string;
	readonly swarmId: string | undefined;
	readonly kind: ReviewTargetKind;
	readonly title: string;
	readonly subtitle: string;
	readonly status: string;
	readonly attentionLevel: AttentionLevel;
	readonly updatedAt: number;
}

export interface IFleetOverview {
	readonly connectionLabel: string;
	readonly activeAgents: number;
	readonly idleAgents: number;
	readonly blockedAgents: number;
	readonly failedAgents: number;
	readonly swarmCount: number;
	readonly criticalSwarms: number;
	readonly needsActionSwarms: number;
	readonly healthMode: string;
	readonly queueDepth: number;
	readonly attentionLevel: AttentionLevel;
}

export interface IAtlasShellStat {
	readonly label: string;
	readonly value: string;
	readonly attentionLevel: AttentionLevel | undefined;
}

export interface IAtlasShellItem {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly status: string;
	readonly attentionLevel: AttentionLevel;
}

export interface IAtlasShellModel {
	readonly section: AtlasModel.NavigationSection;
	readonly title: string;
	readonly subtitle: string;
	readonly emptyMessage: string;
	readonly stats: readonly IAtlasShellStat[];
	readonly items: readonly IAtlasShellItem[];
}

interface IAtlasStateSnapshot {
	readonly connection: IHarnessConnectionInfo;
	readonly swarms: readonly AtlasModel.ISwarmState[];
	readonly tasks: readonly AtlasModel.ITaskState[];
	readonly objectives: readonly AtlasModel.IObjectiveState[];
	readonly fleet: AtlasModel.IFleetState;
	readonly health: AtlasModel.IHealthState;
	readonly reviewGates: readonly AtlasModel.IReviewGateState[];
	readonly mergeQueue: readonly AtlasModel.IMergeEntry[];
}

export function buildSectionDescriptors(
	connection: IHarnessConnectionInfo,
	swarms: readonly AtlasModel.ISwarmState[],
	fleet: AtlasModel.IFleetState,
	reviewGates: readonly AtlasModel.IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
): readonly IAtlasSectionDescriptor[] {
	const reviewCount = reviewGates.filter(gate => gate.reviewState !== WireReviewState.ReviewGo).length
		+ mergeQueue.filter(entry => entry.status !== MergeExecutionStatus.Merged && entry.status !== MergeExecutionStatus.Abandoned).length;

	const connectionAttention = connection.state === HarnessConnectionState.Error || connection.state === HarnessConnectionState.Disconnected
		? AttentionLevel.NeedsAction
		: connection.state === HarnessConnectionState.Connecting || connection.state === HarnessConnectionState.Reconnecting
			? AttentionLevel.Active
			: AttentionLevel.Idle;

	return Object.freeze([
		{
			section: NavigationSection.Tasks,
			label: 'Tasks',
			count: swarms.length,
			attentionLevel: highestAttention(swarms.map(swarm => swarm.attentionLevel), connectionAttention),
		},
		{
			section: NavigationSection.Agents,
			label: 'Agents',
			count: fleet.agents.length,
			attentionLevel: highestAttention(fleet.agents.map(agent => agent.attentionLevel), connectionAttention),
		},
		{
			section: NavigationSection.Reviews,
			label: 'Reviews',
			count: reviewCount,
			attentionLevel: highestAttention([
				...reviewGates.map(gate => gate.attentionLevel),
				...mergeQueue.map(entry => entry.attentionLevel),
				connectionAttention,
			]),
		},
		{
			section: NavigationSection.Fleet,
			label: 'Fleet',
			count: fleet.activeCount,
			attentionLevel: highestAttention([fleet.attentionLevel, connectionAttention]),
		},
	]);
}

export function buildTaskNavigationItems(swarms: readonly AtlasModel.ISwarmState[]): readonly ITaskNavigationItem[] {
	return Object.freeze([...swarms]
		.sort(compareByAttentionThenUpdated)
		.map(swarm => ({
			swarmId: swarm.swarmId,
			title: swarm.objectiveProblemStatement ?? swarm.rootTaskId,
			subtitle: swarm.objectiveProblemStatement ? swarm.rootTaskId : 'Ad-hoc root task',
			phase: swarm.phase,
			attentionLevel: swarm.attentionLevel,
			taskCount: swarm.taskIds.length,
			agentCount: swarm.agentDispatchIds.length,
			reviewNeeded: swarm.reviewNeeded,
			mergeBlocked: swarm.mergeBlocked,
			updatedAt: swarm.updatedAt,
		})));
}

export function buildAgentNavigationItems(
	fleet: AtlasModel.IFleetState,
	swarms: readonly AtlasModel.ISwarmState[],
): readonly IAgentNavigationItem[] {
	const swarmByTaskId = indexSwarmsByTaskId(swarms);

	return Object.freeze([...fleet.agents]
		.sort((left, right) =>
			right.attentionLevel - left.attentionLevel
			|| right.lastHeartbeat - left.lastHeartbeat
			|| left.dispatchId.localeCompare(right.dispatchId))
		.map(agent => ({
			dispatchId: agent.dispatchId,
			taskId: agent.taskId,
			swarmId: swarmByTaskId.get(agent.taskId)?.swarmId,
			title: agent.roleId,
			subtitle: agent.lastActivity ?? agent.taskId,
			status: agent.status,
			attentionLevel: agent.attentionLevel,
			updatedAt: agent.lastHeartbeat,
		})));
}

export function buildReviewNavigationItems(
	reviewGates: readonly AtlasModel.IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
	swarms: readonly AtlasModel.ISwarmState[],
): readonly IReviewNavigationItem[] {
	const swarmByTaskId = indexSwarmsByTaskId(swarms);
	const gateItems = reviewGates.map(gate => ({
		id: reviewItemId(gate.dispatchId, ReviewTargetKind.Gate),
		dispatchId: gate.dispatchId,
		taskId: gate.taskId,
		swarmId: swarmByTaskId.get(gate.taskId)?.swarmId,
		kind: ReviewTargetKind.Gate,
		title: gate.roleId,
		subtitle: gate.stateReason ?? gate.taskId,
		status: formatStateLabel(gate.reviewState),
		attentionLevel: gate.attentionLevel,
		updatedAt: gate.updatedAt,
	}));
	const mergeItems = mergeQueue.map(entry => ({
		id: reviewItemId(entry.dispatchId, ReviewTargetKind.Merge),
		dispatchId: entry.dispatchId,
		taskId: entry.taskId,
		swarmId: swarmByTaskId.get(entry.taskId)?.swarmId,
		kind: ReviewTargetKind.Merge,
		title: basename(entry.worktreePath) || entry.candidateBranch,
		subtitle: entry.blockedReason ?? entry.taskId,
		status: formatStateLabel(entry.status),
		attentionLevel: entry.attentionLevel,
		updatedAt: entry.mergedAt ?? entry.enqueuedAt,
	}));

	return Object.freeze([...gateItems, ...mergeItems]
		.sort((left, right) =>
			right.attentionLevel - left.attentionLevel
			|| right.updatedAt - left.updatedAt
			|| left.dispatchId.localeCompare(right.dispatchId)));
}

export function buildFleetOverview(
	connection: IHarnessConnectionInfo,
	fleet: AtlasModel.IFleetState,
	health: AtlasModel.IHealthState,
	swarms: readonly AtlasModel.ISwarmState[],
): IFleetOverview {
	const criticalSwarms = swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.Critical).length;
	const needsActionSwarms = swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.NeedsAction).length;

	return {
		connectionLabel: formatConnectionLabel(connection),
		activeAgents: fleet.activeCount,
		idleAgents: fleet.idleCount,
		blockedAgents: fleet.blockedCount,
		failedAgents: fleet.failedCount,
		swarmCount: swarms.length,
		criticalSwarms,
		needsActionSwarms,
		healthMode: formatStateLabel(health.mode),
		queueDepth: health.queueDepth,
		attentionLevel: highestAttention([fleet.attentionLevel, health.attentionLevel]),
	};
}

export function buildAtlasShellModel(
	selection: INavigationSelection,
	state: IAtlasStateSnapshot,
): IAtlasShellModel {
	switch (selection.section) {
		case NavigationSection.Tasks:
			return buildTasksShellModel(selection, state);
		case NavigationSection.Agents:
			return buildAgentsShellModel(selection, state);
		case NavigationSection.Reviews:
			return buildReviewsShellModel(selection, state);
		case NavigationSection.Fleet:
		default:
			return buildFleetShellModel(state);
	}
}

function buildTasksShellModel(selection: INavigationSelection, state: IAtlasStateSnapshot): IAtlasShellModel {
	const swarms = buildTaskNavigationItems(state.swarms);
	const selectedSwarm = selection.entity?.kind === EntityKind.Swarm
		? state.swarms.find(swarm => swarm.swarmId === selection.entity!.id)
		: selection.entity?.kind === EntityKind.Task
			? state.swarms.find(swarm => swarm.taskIds.includes(selection.entity!.id))
			: selection.entity?.kind === EntityKind.Objective
				? state.swarms.find(swarm => swarm.objectiveId === selection.entity!.id)
				: undefined;

	if (!selectedSwarm) {
		return {
			section: NavigationSection.Tasks,
			title: 'Tasks',
			subtitle: 'Swarm-rooted execution across the current harness fabric.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No rooted swarms are available for this workspace yet.'),
			stats: [
				stat('Swarms', String(state.swarms.length)),
				stat('Critical', String(state.swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.Critical).length), AttentionLevel.Critical),
				stat('Needs review', String(state.swarms.filter(swarm => swarm.reviewNeeded).length), AttentionLevel.NeedsAction),
			],
			items: swarms.map(item => ({
				id: item.swarmId,
				label: item.title,
				description: `${formatStateLabel(item.phase)} • ${item.taskCount} tasks • ${item.agentCount} agents`,
				status: item.subtitle,
				attentionLevel: item.attentionLevel,
			})),
		};
	}

	const swarmTasks = state.tasks
		.filter(task => selectedSwarm.taskIds.includes(task.taskId))
		.sort((left, right) =>
			left.taskId === selectedSwarm.rootTaskId ? -1 :
				right.taskId === selectedSwarm.rootTaskId ? 1 :
					left.enqueuedAt - right.enqueuedAt);

	return {
		section: NavigationSection.Tasks,
		title: selectedSwarm.objectiveProblemStatement ?? selectedSwarm.rootTaskId,
		subtitle: `Root task ${selectedSwarm.rootTaskId}`,
		emptyMessage: 'No task lineage is available for the current swarm.',
		stats: [
			stat('Phase', formatStateLabel(selectedSwarm.phase), selectedSwarm.attentionLevel),
			stat('Tasks', String(selectedSwarm.taskIds.length)),
			stat('Agents', String(selectedSwarm.agentDispatchIds.length)),
			stat('Reviews', String(selectedSwarm.reviewDispatchIds.length + selectedSwarm.mergeDispatchIds.length), selectedSwarm.reviewNeeded || selectedSwarm.mergeBlocked ? AttentionLevel.NeedsAction : undefined),
		],
		items: swarmTasks.map(task => ({
			id: task.taskId,
			label: task.summary || task.taskId,
			description: `${formatStateLabel(task.status)} • ${task.roleId}`,
			status: task.taskId,
			attentionLevel: task.attentionLevel,
		})),
	};
}

function buildAgentsShellModel(selection: INavigationSelection, state: IAtlasStateSnapshot): IAtlasShellModel {
	const agents = buildAgentNavigationItems(state.fleet, state.swarms);
	const selectedAgent = selection.entity?.kind === EntityKind.Agent
		? state.fleet.agents.find(agent => agent.dispatchId === selection.entity!.id)
		: undefined;
	const selectedSwarm = selectedAgent ? state.swarms.find(swarm => swarm.taskIds.includes(selectedAgent.taskId)) : undefined;

	if (!selectedAgent) {
		return {
			section: NavigationSection.Agents,
			title: 'Agents',
			subtitle: 'Active and recent daemon-backed agents, linked back to rooted work when possible.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No agents are currently visible in fleet state.'),
			stats: [
				stat('Running', String(state.fleet.activeCount), AttentionLevel.Active),
				stat('Blocked', String(state.fleet.blockedCount), AttentionLevel.NeedsAction),
				stat('Failed', String(state.fleet.failedCount), AttentionLevel.Critical),
			],
			items: agents.map(agent => ({
				id: agent.dispatchId,
				label: agent.title,
				description: `${formatStateLabel(agent.status)} • ${agent.subtitle}`,
				status: agent.swarmId ?? agent.taskId,
				attentionLevel: agent.attentionLevel,
			})),
		};
	}

	return {
		section: NavigationSection.Agents,
		title: selectedAgent.roleId,
		subtitle: `Dispatch ${selectedAgent.dispatchId}`,
		emptyMessage: 'No related agents are available for the current selection.',
		stats: [
			stat('Status', formatStateLabel(selectedAgent.status), selectedAgent.attentionLevel),
			stat('Task', selectedAgent.taskId),
			stat('Swarm', selectedSwarm?.swarmId ?? 'Unmapped'),
			stat('Heartbeat', String(selectedAgent.lastHeartbeat)),
		],
		items: state.fleet.agents
			.filter(agent => agent.taskId === selectedAgent.taskId || agent.dispatchId === selectedAgent.dispatchId)
			.map(agent => ({
				id: agent.dispatchId,
				label: agent.roleId,
				description: agent.lastActivity ?? agent.taskId,
				status: formatStateLabel(agent.status),
				attentionLevel: agent.attentionLevel,
			})),
	};
}

function buildReviewsShellModel(selection: INavigationSelection, state: IAtlasStateSnapshot): IAtlasShellModel {
	const reviewItems = buildReviewNavigationItems(state.reviewGates, state.mergeQueue, state.swarms);
	const selectedReview = selection.entity?.kind === EntityKind.Review ? selection.entity : undefined;
	const dispatchId = selectedReview?.id;
	const selectedKind = selectedReview?.reviewTargetKind;
	const gate = dispatchId ? state.reviewGates.find(entry => entry.dispatchId === dispatchId) : undefined;
	const merge = dispatchId ? state.mergeQueue.find(entry => entry.dispatchId === dispatchId) : undefined;

	if (!dispatchId || (!gate && !merge)) {
		return {
			section: NavigationSection.Reviews,
			title: 'Reviews',
			subtitle: 'Authoritative review gates and merge-lane state only.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No review or merge queue entries are visible yet.'),
			stats: [
				stat('Awaiting review', String(state.reviewGates.filter(entry => entry.reviewState === WireReviewState.AwaitingReview).length), AttentionLevel.NeedsAction),
				stat('Merge blocked', String(state.mergeQueue.filter(entry => entry.status === MergeExecutionStatus.MergeBlocked).length), AttentionLevel.Critical),
				stat('Merge pending', String(state.mergeQueue.filter(entry => entry.status === MergeExecutionStatus.Pending || entry.status === MergeExecutionStatus.MergeStarted).length), AttentionLevel.Active),
			],
			items: reviewItems.map(item => ({
				id: item.id,
				label: item.title,
				description: `${item.kind === ReviewTargetKind.Gate ? 'Gate' : 'Merge'} • ${item.subtitle}`,
				status: item.status,
				attentionLevel: item.attentionLevel,
			})),
		};
	}

	const primaryKind = selectedKind ?? (gate ? ReviewTargetKind.Gate : ReviewTargetKind.Merge);
	const sourceAttention = primaryKind === ReviewTargetKind.Merge
		? merge?.attentionLevel ?? gate?.attentionLevel ?? AttentionLevel.Idle
		: gate?.attentionLevel ?? merge?.attentionLevel ?? AttentionLevel.Idle;
	const title = primaryKind === ReviewTargetKind.Merge
		? basename(merge?.worktreePath ?? '') || merge?.candidateBranch || dispatchId
		: gate?.roleId ?? dispatchId;
	const subtitle = primaryKind === ReviewTargetKind.Merge
		? `Merge lane for dispatch ${dispatchId}`
		: `Review gate for dispatch ${dispatchId}`;

	return {
		section: NavigationSection.Reviews,
		title,
		subtitle,
		emptyMessage: 'No review history is available for this dispatch.',
		stats: [
			stat('Gate', gate ? formatStateLabel(gate.reviewState) : '—', gate ? gate.attentionLevel : undefined),
			stat('Promotion', gate ? formatStateLabel(gate.promotionState) : '—'),
			stat('Integration', gate ? formatStateLabel(gate.integrationState) : merge ? formatStateLabel(merge.status) : '—', sourceAttention),
		],
		items: [
			gate ? {
				id: reviewItemId(gate.dispatchId, ReviewTargetKind.Gate),
				label: gate.taskId,
				description: gate.stateReason ?? gate.baseRef,
				status: formatStateLabel(gate.reviewState),
				attentionLevel: gate.attentionLevel,
			} : undefined,
			merge ? {
				id: reviewItemId(merge.dispatchId, ReviewTargetKind.Merge),
				label: merge.taskId,
				description: merge.blockedReason ?? merge.baseRef,
				status: formatStateLabel(merge.status),
				attentionLevel: merge.attentionLevel,
			} : undefined,
		].filter((value): value is IAtlasShellItem => value !== undefined),
	};
}

function buildFleetShellModel(state: IAtlasStateSnapshot): IAtlasShellModel {
	const overview = buildFleetOverview(state.connection, state.fleet, state.health, state.swarms);
	const attentionSwarms = buildTaskNavigationItems(state.swarms).slice(0, 6);

	return {
		section: NavigationSection.Fleet,
		title: 'Fleet',
		subtitle: 'Read-only fabric posture across connection, health, and live agent capacity.',
		emptyMessage: emptyMessageForConnection(state.connection, 'No fleet activity is visible for this workspace yet.'),
		stats: [
			stat('Connection', overview.connectionLabel, state.connection.state === HarnessConnectionState.Connected ? AttentionLevel.Idle : AttentionLevel.NeedsAction),
			stat('Health', overview.healthMode, state.health.attentionLevel),
			stat('Agents', String(state.fleet.agents.length), state.fleet.attentionLevel),
			stat('Queue depth', String(overview.queueDepth), state.health.queueDepth > 0 ? AttentionLevel.Active : undefined),
		],
		items: attentionSwarms.map(item => ({
			id: item.swarmId,
			label: item.title,
			description: `${formatStateLabel(item.phase)} • ${item.taskCount} tasks`,
			status: item.subtitle,
			attentionLevel: item.attentionLevel,
		})),
	};
}

function indexSwarmsByTaskId(swarms: readonly ISwarmState[]): Map<string, ISwarmState> {
	const index = new Map<string, ISwarmState>();
	for (const swarm of swarms) {
		for (const taskId of swarm.taskIds) {
			index.set(taskId, swarm);
		}
	}
	return index;
}

function compareByAttentionThenUpdated(left: { attentionLevel: AttentionLevel; updatedAt: number; swarmId: string }, right: { attentionLevel: AttentionLevel; updatedAt: number; swarmId: string }): number {
	return right.attentionLevel - left.attentionLevel
		|| right.updatedAt - left.updatedAt
		|| left.swarmId.localeCompare(right.swarmId);
}

function highestAttention(levels: readonly AttentionLevel[], fallback: AttentionLevel = AttentionLevel.Idle): AttentionLevel {
	let current = fallback;
	for (const level of levels) {
		if (level > current) {
			current = level;
		}
	}
	return current;
}

function stat(label: string, value: string, attentionLevel: AttentionLevel | undefined = undefined): IAtlasShellStat {
	return { label, value, attentionLevel };
}

function reviewItemId(dispatchId: string, kind: ReviewTargetKind): string {
	return `${kind}:${dispatchId}`;
}

export function formatConnectionLabel(connection: IHarnessConnectionInfo): string {
	switch (connection.state) {
		case HarnessConnectionState.Connected:
			return connection.mode === 'daemon' ? 'Daemon' : connection.mode === 'polling' ? 'Polling' : 'Connected';
		case HarnessConnectionState.Connecting:
			return 'Connecting';
		case HarnessConnectionState.Reconnecting:
			return 'Reconnecting';
		case HarnessConnectionState.Error:
			return 'Error';
		case HarnessConnectionState.Disconnected:
			return 'Disconnected';
	}
}

export function emptyMessageForConnection(connection: IHarnessConnectionInfo, fallback: string): string {
	if (connection.state === HarnessConnectionState.Error) {
		return connection.errorMessage ?? fallback;
	}
	if (connection.state === HarnessConnectionState.Connecting || connection.state === HarnessConnectionState.Reconnecting) {
		return 'Connecting to the harness daemon…';
	}
	if (connection.state === HarnessConnectionState.Disconnected) {
		return 'Atlas is not connected to a harness fabric for this workspace.';
	}
	return fallback;
}

export function formatStateLabel(value: string): string {
	return value
		.split('_')
		.map(segment => segment.length > 0 ? segment[0].toUpperCase() + segment.slice(1) : segment)
		.join(' ');
}

export function isTaskSelection(section: NavigationSection): boolean {
	return section === NavigationSection.Tasks;
}

export function isReviewOutstanding(review: IReviewGateState): boolean {
	return review.reviewState === WireReviewState.AwaitingReview || review.reviewState === WireReviewState.ReviewBlocked;
}

export function isSwarmActive(swarm: ISwarmState): boolean {
	return swarm.phase === SwarmPhase.Executing || swarm.phase === SwarmPhase.Reviewing || swarm.phase === SwarmPhase.Merging || swarm.phase === SwarmPhase.Planning;
}

export function isTaskOutstanding(task: ITaskState): boolean {
	return task.status !== TaskStatus.Completed && task.status !== TaskStatus.Cancelled && task.status !== TaskStatus.Failed;
}
