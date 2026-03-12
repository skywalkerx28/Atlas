/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 4 Atlas navigation models are sessions-only contrib code that summarizes sessions service state without introducing workbench leakage. */

import { basename } from '../../../../base/common/path.js';
import { AgentStatus, type IAgentState } from '../../../common/model/agent.js';
import { AttentionLevel } from '../../../common/model/attention.js';
import { NavigationSection, EntityKind, ReviewTargetKind, type INavigationSelection, type IReviewSelectedEntity } from '../../../common/model/selection.js';
import { MergeExecutionStatus, type IReviewGateState } from '../../../common/model/review.js';
import { SwarmPhase, type ISwarmState } from '../../../common/model/swarm.js';
import { TaskStatus, type ITaskState } from '../../../common/model/task.js';
import { WirePromotionState, WireReviewState } from '../../../common/model/wire.js';
import { HarnessConnectionState, type IHarnessConnectionInfo } from '../../../services/harness/common/harnessService.js';
import { ReviewWorkspaceActionId, type IReviewWorkspaceUiState, reviewTargetKey, unavailableReasonForWriteMethod } from './atlasReviewWorkspaceActions.js';

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

export interface IFleetCommandPivot {
	readonly id: string;
	readonly label: string;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface IFleetCommandItem {
	readonly id: string;
	readonly dispatchId: string;
	readonly roleLabel: string;
	readonly taskId: string;
	readonly swarmId: string | undefined;
	readonly status: AtlasModel.AgentStatus;
	readonly statusLabel: string;
	readonly attentionLevel: AttentionLevel;
	readonly lastHeartbeat: number;
	readonly heartbeatLabel: string;
	readonly timeInStateLabel: string;
	readonly lastActivityLabel: string;
	readonly pressureSummary: string | undefined;
	readonly hasReviewPressure: boolean;
	readonly hasMergePressure: boolean;
	readonly primaryTarget: AtlasModel.ISelectedEntity;
	readonly pivots: readonly IFleetCommandPivot[];
}

export interface IFleetCommandGroup {
	readonly id: string;
	readonly label: string;
	readonly summary: string;
	readonly count: number;
	readonly attentionLevel: AttentionLevel;
	readonly emptyMessage: string;
	readonly items: readonly IFleetCommandItem[];
}

export interface IFleetCommandModel {
	readonly title: string;
	readonly subtitle: string;
	readonly emptyMessage: string;
	readonly stats: readonly IAtlasShellStat[];
	readonly groups: readonly IFleetCommandGroup[];
	readonly totalAgents: number;
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

export interface IEntityWorkspaceLink {
	readonly kind: 'entity';
	readonly id: string;
	readonly label: string;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface ISectionWorkspaceLink {
	readonly kind: 'section';
	readonly id: string;
	readonly label: string;
	readonly section: NavigationSection;
}

export type IAtlasWorkspaceLink = IEntityWorkspaceLink | ISectionWorkspaceLink;

export interface IAtlasWorkspaceDetail {
	readonly label: string;
	readonly value: string;
	readonly attentionLevel: AttentionLevel | undefined;
}

export interface ITaskWorkspaceSwarmCard {
	readonly id: string;
	readonly swarmId: string;
	readonly title: string;
	readonly subtitle: string;
	readonly phaseLabel: string;
	readonly attentionLevel: AttentionLevel;
	readonly taskCount: number;
	readonly agentCount: number;
	readonly reviewCount: number;
	readonly selected: boolean;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface ITaskWorkspaceTaskEntry {
	readonly id: string;
	readonly taskId: string;
	readonly summary: string;
	readonly statusLabel: string;
	readonly roleLabel: string;
	readonly attentionLevel: AttentionLevel;
	readonly depth: number;
	readonly selected: boolean;
	readonly isRoot: boolean;
	readonly dispatchId: string | undefined;
	readonly agentCount: number;
	readonly pressureSummary: string | undefined;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface ITaskWorkspaceAgentEntry {
	readonly id: string;
	readonly dispatchId: string;
	readonly label: string;
	readonly subtitle: string;
	readonly status: string;
	readonly attentionLevel: AttentionLevel;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface ITaskWorkspacePressureEntry {
	readonly id: string;
	readonly label: string;
	readonly subtitle: string;
	readonly status: string;
	readonly kind: ReviewTargetKind;
	readonly attentionLevel: AttentionLevel;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface ITaskWorkspaceModel {
	readonly mode: 'overview' | 'swarm';
	readonly title: string;
	readonly subtitle: string;
	readonly emptyMessage: string;
	readonly stats: readonly IAtlasShellStat[];
	readonly details: readonly IAtlasWorkspaceDetail[];
	readonly links: readonly IAtlasWorkspaceLink[];
	readonly swarmCards: readonly ITaskWorkspaceSwarmCard[];
	readonly taskEntries: readonly ITaskWorkspaceTaskEntry[];
	readonly agentEntries: readonly ITaskWorkspaceAgentEntry[];
	readonly pressureEntries: readonly ITaskWorkspacePressureEntry[];
	readonly selectedSwarmId: string | undefined;
	readonly selectedTaskId: string | undefined;
}

export interface IAgentWorkspaceItem {
	readonly id: string;
	readonly dispatchId: string;
	readonly title: string;
	readonly subtitle: string;
	readonly statusKind: AtlasModel.AgentStatus;
	readonly status: string;
	readonly attentionLevel: AttentionLevel;
	readonly heartbeatLabel: string;
	readonly activityLabel: string;
	readonly taskId: string;
	readonly swarmId: string | undefined;
	readonly worktreePath: string | undefined;
	readonly pressureSummary: string | undefined;
	readonly selected: boolean;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface IAgentWorkspaceGroup {
	readonly id: string;
	readonly label: string;
	readonly summary: string;
	readonly count: number;
	readonly attentionLevel: AttentionLevel;
	readonly emptyMessage: string;
	readonly items: readonly IAgentWorkspaceItem[];
}

export interface IAgentWorkspacePressureEntry {
	readonly id: string;
	readonly label: string;
	readonly subtitle: string;
	readonly status: string;
	readonly kind: ReviewTargetKind;
	readonly attentionLevel: AttentionLevel;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface IAgentWorkspaceModel {
	readonly mode: 'overview' | 'agent';
	readonly title: string;
	readonly subtitle: string;
	readonly emptyMessage: string;
	readonly stats: readonly IAtlasShellStat[];
	readonly details: readonly IAtlasWorkspaceDetail[];
	readonly links: readonly IAtlasWorkspaceLink[];
	readonly pressureEntries: readonly IAgentWorkspacePressureEntry[];
	readonly groups: readonly IAgentWorkspaceGroup[];
	readonly selectedDispatchId: string | undefined;
}

export type IReviewWorkspaceLink = IAtlasWorkspaceLink;

export type IReviewWorkspaceDetail = IAtlasWorkspaceDetail;

export interface IReviewWorkspaceEntry {
	readonly id: string;
	readonly dispatchId: string;
	readonly kind: ReviewTargetKind;
	readonly title: string;
	readonly subtitle: string;
	readonly status: string;
	readonly attentionLevel: AttentionLevel;
	readonly selected: boolean;
	readonly target: AtlasModel.ISelectedEntity;
}

export interface IReviewWorkspaceAction {
	readonly id: ReviewWorkspaceActionId;
	readonly label: string;
	readonly description: string;
	readonly enabled: boolean;
	readonly running: boolean;
	readonly disabledReason: string | undefined;
	readonly emphasis: 'primary' | 'secondary' | 'danger';
}

export interface IReviewWorkspaceModel {
	readonly title: string;
	readonly subtitle: string;
	readonly emptyMessage: string;
	readonly stats: readonly IAtlasShellStat[];
	readonly entries: readonly IReviewWorkspaceEntry[];
	readonly details: readonly IReviewWorkspaceDetail[];
	readonly links: readonly IReviewWorkspaceLink[];
	readonly actions: readonly IReviewWorkspaceAction[];
	readonly feedbackMessage: string | undefined;
	readonly feedbackKind: 'error' | 'progress' | undefined;
	readonly readOnlyMessage: string | undefined;
	readonly selectedDispatchId: string | undefined;
	readonly selectedTargetKind: ReviewTargetKind | undefined;
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

export function buildFleetCommandModel(
	state: IAtlasStateSnapshot,
	now: number = Date.now(),
): IFleetCommandModel {
	const overview = buildFleetOverview(state.connection, state.fleet, state.health, state.swarms);
	const items = buildFleetCommandItems(state.fleet.agents, state.swarms, state.reviewGates, state.mergeQueue, now);
	const attentionCount = items.filter(item => item.hasReviewPressure || item.hasMergePressure).length;

	return {
		title: 'Fleet Command',
		subtitle: 'Read-only operator awareness across connection, pool health, queue pressure, and live agent execution.',
		emptyMessage: emptyMessageForConnection(state.connection, 'No fleet activity is visible for this workspace yet.'),
		totalAgents: items.length,
		stats: [
			stat('Connection', overview.connectionLabel, state.connection.state === HarnessConnectionState.Connected ? AttentionLevel.Idle : AttentionLevel.NeedsAction),
			stat('Health', overview.healthMode, state.health.attentionLevel),
			stat('Queue depth', String(overview.queueDepth), state.health.queueDepth > 0 ? AttentionLevel.Active : undefined),
			stat('Running', String(overview.activeAgents), overview.activeAgents > 0 ? AttentionLevel.Active : undefined),
			stat('Blocked', String(overview.blockedAgents), overview.blockedAgents > 0 ? AttentionLevel.NeedsAction : undefined),
			stat('Failed', String(overview.failedAgents), overview.failedAgents > 0 ? AttentionLevel.Critical : undefined),
			stat('Critical swarms', String(overview.criticalSwarms), overview.criticalSwarms > 0 ? AttentionLevel.Critical : undefined),
			stat('Needs action swarms', String(overview.needsActionSwarms), overview.needsActionSwarms > 0 ? AttentionLevel.NeedsAction : undefined),
			stat('Review pressure', String(attentionCount), attentionCount > 0 ? AttentionLevel.NeedsAction : undefined),
		],
		groups: Object.freeze([
			buildFleetCommandGroup(
				'attention',
				'Needs review / merge attention',
				'Live dispatches that are directly carrying review or merge pressure.',
				items.filter(item => item.hasReviewPressure || item.hasMergePressure),
				'No live agents are currently carrying direct review or merge pressure.',
			),
			buildFleetCommandGroup(
				'running',
				'Running',
				'Dispatches actively executing or spawning on the current harness fabric.',
				items.filter(item => isRunningAgentStatus(item.status)),
				'No agents are currently running.',
			),
			buildFleetCommandGroup(
				'blocked',
				'Blocked',
				'Dispatches waiting on dependencies, external state, or human follow-up.',
				items.filter(item => item.status === AgentStatus.Blocked),
				'No agents are currently blocked.',
			),
			buildFleetCommandGroup(
				'failed',
				'Failed',
				'Dispatches that failed closed or timed out and need operator awareness.',
				items.filter(item => isFailedAgentStatus(item.status)),
				'No failed or timed-out agents are visible.',
			),
			buildFleetCommandGroup(
				'idle',
				'Idle / recent',
				'Dispatches with no active execution in flight but still visible in fleet state.',
				items.filter(item => item.status === AgentStatus.Idle || item.status === AgentStatus.Completed),
				'No idle or recently completed agents are visible.',
			),
		]),
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

export function buildReviewWorkspaceModel(
	selection: INavigationSelection,
	state: IAtlasStateSnapshot,
	uiState: IReviewWorkspaceUiState = { targetKey: undefined, pendingAction: undefined, errorMessage: undefined },
): IReviewWorkspaceModel {
	const entries = buildReviewNavigationItems(state.reviewGates, state.mergeQueue, state.swarms);
	const selectedReview = selection.entity?.kind === EntityKind.Review ? selection.entity : undefined;
	const selectedDispatchId = selectedReview?.id;
	const selectedTargetKind = selectedReview?.reviewTargetKind;
	const gate = selectedDispatchId ? state.reviewGates.find(entry => entry.dispatchId === selectedDispatchId) : undefined;
	const merge = selectedDispatchId ? state.mergeQueue.find(entry => entry.dispatchId === selectedDispatchId) : undefined;
	const activeTargetKey = reviewTargetKey(selectedReview);
	const pendingAction = uiState.targetKey === activeTargetKey ? uiState.pendingAction : undefined;
	const errorMessage = uiState.targetKey === activeTargetKey ? uiState.errorMessage : undefined;
	const taskId = gate?.taskId ?? merge?.taskId;
	const swarm = taskId ? state.swarms.find(candidate => candidate.taskIds.includes(taskId)) : undefined;
	const agent = selectedDispatchId ? state.fleet.agents.find(candidate => candidate.dispatchId === selectedDispatchId) : undefined;
	const primaryKind = selectedTargetKind ?? (gate ? ReviewTargetKind.Gate : merge ? ReviewTargetKind.Merge : undefined);
	const queueEntries = entries.map<IReviewWorkspaceEntry>(item => {
		const target: AtlasModel.ISelectedEntity = {
			kind: EntityKind.Review,
			id: item.dispatchId,
			reviewTargetKind: item.kind,
		};
		return {
			id: item.id,
			dispatchId: item.dispatchId,
			kind: item.kind,
			title: item.title,
			subtitle: item.subtitle,
			status: item.status,
			attentionLevel: item.attentionLevel,
			selected: selectedDispatchId === item.dispatchId && selectedTargetKind === item.kind,
			target,
		};
	});

	const stats = [
		stat('Awaiting review', String(state.reviewGates.filter(entry => entry.reviewState === WireReviewState.AwaitingReview).length), AttentionLevel.NeedsAction),
		stat('Promotion ready', String(state.reviewGates.filter(entry => entry.reviewState === WireReviewState.ReviewGo && entry.promotionState === WirePromotionState.NotRequested).length), AttentionLevel.Active),
		stat('Merge pending', String(state.mergeQueue.filter(entry => entry.status === MergeExecutionStatus.Pending || entry.status === MergeExecutionStatus.MergeStarted).length), AttentionLevel.Active),
		stat('Merge blocked', String(state.mergeQueue.filter(entry => entry.status === MergeExecutionStatus.MergeBlocked).length), AttentionLevel.Critical),
	];

	if (!selectedDispatchId || (!gate && !merge) || !primaryKind) {
		return {
			title: 'Reviews',
			subtitle: 'Authoritative review gates and merge-lane state, with actions only when the current daemon explicitly supports them.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No review or merge queue entries are visible yet.'),
			stats,
			entries: queueEntries,
			details: Object.freeze([]),
			links: Object.freeze([]),
			actions: buildReviewWorkspaceActions(state.connection, undefined, undefined, undefined, pendingAction),
			feedbackMessage: errorMessage,
			feedbackKind: errorMessage ? 'error' : undefined,
			readOnlyMessage: 'Select a review target to inspect authoritative state and available actions.',
			selectedDispatchId: undefined,
			selectedTargetKind: undefined,
		};
	}

	const integrationLabel = merge
		? formatStateLabel(merge.status)
		: gate
			? formatStateLabel(gate.integrationState)
			: '—';
	const details: IReviewWorkspaceDetail[] = [
		detail('Target', primaryKind === ReviewTargetKind.Gate ? 'Review gate' : 'Merge lane', undefined),
		detail('Dispatch', selectedDispatchId, undefined),
		detail('Task', taskId ?? '—', undefined),
		detail('Swarm', swarm?.swarmId ?? 'Unmapped', swarm?.attentionLevel),
		detail(primaryKind === ReviewTargetKind.Gate ? 'Role' : 'Branch', primaryKind === ReviewTargetKind.Gate ? gate?.roleId ?? '—' : merge?.candidateBranch ?? '—', undefined),
		detail('Gate state', gate ? formatStateLabel(gate.reviewState) : '—', gate?.attentionLevel),
		detail('Promotion', gate ? formatStateLabel(gate.promotionState) : '—', gate?.promotionState === WirePromotionState.PromotionAuthorized ? AttentionLevel.Active : undefined),
		detail('Merge state', integrationLabel, merge?.attentionLevel ?? gate?.attentionLevel),
	];

	const reason = gate?.stateReason ?? merge?.blockedReason;
	if (reason) {
		details.push(detail('Reason', reason, merge?.status === MergeExecutionStatus.MergeBlocked ? AttentionLevel.Critical : undefined));
	}

	const links: IReviewWorkspaceLink[] = [];
	if (swarm) {
		links.push({ kind: 'entity', id: `swarm:${swarm.swarmId}`, label: 'Open swarm', target: swarmTarget(swarm.swarmId) });
	}
	if (taskId) {
		links.push({ kind: 'entity', id: `task:${taskId}`, label: 'Open task', target: taskTarget(taskId) });
	}
	if (agent) {
		links.push({ kind: 'entity', id: `agent:${agent.dispatchId}`, label: 'Open agent', target: agentTarget(agent.dispatchId) });
	}

	const readOnlyMessage = buildReadOnlyMessage(state.connection, gate, merge);

	return {
		title: primaryKind === ReviewTargetKind.Merge
			? basename(merge?.worktreePath ?? '') || merge?.candidateBranch || selectedDispatchId
			: gate?.roleId ?? selectedDispatchId,
		subtitle: primaryKind === ReviewTargetKind.Merge
			? `Merge lane for dispatch ${selectedDispatchId}`
			: `Review gate for dispatch ${selectedDispatchId}`,
		emptyMessage: 'No review history is available for this dispatch.',
		stats,
		entries: queueEntries,
		details: Object.freeze(details),
		links: Object.freeze(links),
		actions: buildReviewWorkspaceActions(state.connection, gate, merge, selectedReview, pendingAction),
		feedbackMessage: pendingAction
			? pendingLabel(pendingAction)
			: errorMessage,
		feedbackKind: pendingAction
			? 'progress'
			: errorMessage
				? 'error'
				: undefined,
		readOnlyMessage,
		selectedDispatchId,
		selectedTargetKind,
	};
}

export function buildTasksWorkspaceModel(
	selection: INavigationSelection,
	state: IAtlasStateSnapshot,
	now: number = Date.now(),
): ITaskWorkspaceModel {
	const selectedSwarm = resolveSelectedSwarm(selection, state.swarms);
	const selectedTaskId = selection.entity?.kind === EntityKind.Task
		? selection.entity.id
		: selectedSwarm?.rootTaskId;
	const swarmById = new Map(state.swarms.map(swarm => [swarm.swarmId, swarm] as const));
	const swarmCards = buildTaskNavigationItems(state.swarms).map<ITaskWorkspaceSwarmCard>(item => ({
		id: item.swarmId,
		swarmId: item.swarmId,
		title: item.title,
		subtitle: item.subtitle,
		phaseLabel: formatStateLabel(item.phase),
		attentionLevel: item.attentionLevel,
		taskCount: item.taskCount,
		agentCount: item.agentCount,
		reviewCount: (swarmById.get(item.swarmId)?.reviewDispatchIds.length ?? 0) + (swarmById.get(item.swarmId)?.mergeDispatchIds.length ?? 0),
		selected: item.swarmId === selectedSwarm?.swarmId,
		target: swarmTarget(item.swarmId),
	}));

	if (!selectedSwarm) {
		return {
			mode: 'overview',
			title: 'Tasks',
			subtitle: 'Swarm-rooted work across the current harness fabric, with objective metadata attached only when the rooted lineage proves it.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No rooted swarms are available for this workspace yet.'),
			stats: [
				stat('Swarms', String(state.swarms.length)),
				stat('Critical', String(state.swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.Critical).length), AttentionLevel.Critical),
				stat('Needs action', String(state.swarms.filter(swarm => swarm.attentionLevel === AttentionLevel.NeedsAction).length), AttentionLevel.NeedsAction),
				stat('Active agents', String(state.fleet.activeCount), state.fleet.activeCount > 0 ? AttentionLevel.Active : undefined),
			],
			details: Object.freeze([]),
			links: Object.freeze([
				sectionLink('agents', 'Open Agents', NavigationSection.Agents),
				sectionLink('reviews', 'Open Reviews', NavigationSection.Reviews),
				sectionLink('fleet', 'Open Fleet', NavigationSection.Fleet),
			]),
			swarmCards: Object.freeze(swarmCards),
			taskEntries: Object.freeze([]),
			agentEntries: Object.freeze([]),
			pressureEntries: Object.freeze([]),
			selectedSwarmId: undefined,
			selectedTaskId: undefined,
		};
	}

	const objective = selectedSwarm.objectiveId
		? state.objectives.find(candidate => candidate.objectiveId === selectedSwarm.objectiveId)
		: state.objectives.find(candidate => candidate.rootTaskId === selectedSwarm.rootTaskId);
	const taskEntries = buildTaskWorkspaceTaskEntries(selectedSwarm, state.tasks, state.fleet.agents, state.reviewGates, state.mergeQueue, selectedTaskId);
	const agentEntries = buildTaskWorkspaceAgentEntries(selectedSwarm, state.fleet.agents, now);
	const pressureEntries = buildTaskWorkspacePressureEntries(selectedSwarm, state.reviewGates, state.mergeQueue);
	const links: IAtlasWorkspaceLink[] = [
		sectionLink('agents', 'Browse Agents', NavigationSection.Agents),
		sectionLink('reviews', 'Browse Reviews', NavigationSection.Reviews),
		sectionLink('fleet', 'Open Fleet', NavigationSection.Fleet),
	];
	if (objective) {
		links.unshift(entityLink(`objective:${objective.objectiveId}`, 'Open Objective', objectiveTarget(objective.objectiveId)));
	}

	return {
		mode: 'swarm',
		title: selectedSwarm.objectiveProblemStatement ?? objective?.problemStatement ?? selectedSwarm.rootTaskId,
		subtitle: `Root task ${selectedSwarm.rootTaskId}`,
		emptyMessage: 'No rooted task lineage is currently available for this swarm.',
		stats: [
			stat('Phase', formatStateLabel(selectedSwarm.phase), selectedSwarm.attentionLevel),
			stat('Root status', formatStateLabel(selectedSwarm.rootTaskStatus), taskEntries.find(entry => entry.taskId === selectedSwarm.rootTaskId)?.attentionLevel),
			stat('Tasks', String(selectedSwarm.taskIds.length)),
			stat('Agents', String(selectedSwarm.agentDispatchIds.length), selectedSwarm.agentDispatchIds.length > 0 ? AttentionLevel.Active : undefined),
			stat('Review pressure', String(selectedSwarm.reviewDispatchIds.length + selectedSwarm.mergeDispatchIds.length), selectedSwarm.reviewNeeded || selectedSwarm.mergeBlocked ? AttentionLevel.NeedsAction : undefined),
		],
		details: Object.freeze([
			detail('Swarm', selectedSwarm.swarmId, selectedSwarm.attentionLevel),
			detail('Objective', objective ? `${objective.objectiveId} • ${objective.problemStatement}` : 'Ad-hoc root task', objective?.attentionLevel),
			detail('Created', formatRecencyLabel(now, selectedSwarm.createdAt), undefined),
			detail('Updated', formatRecencyLabel(now, selectedSwarm.updatedAt), undefined),
			detail('Failures', selectedSwarm.hasFailures ? 'Detected' : 'None', selectedSwarm.hasFailures ? AttentionLevel.Critical : undefined),
			detail('Blocked tasks', selectedSwarm.hasBlockedTasks ? 'Present' : 'None', selectedSwarm.hasBlockedTasks ? AttentionLevel.NeedsAction : undefined),
		]),
		links: Object.freeze(links),
		swarmCards: Object.freeze(swarmCards),
		taskEntries: Object.freeze(taskEntries),
		agentEntries: Object.freeze(agentEntries),
		pressureEntries: Object.freeze(pressureEntries),
		selectedSwarmId: selectedSwarm.swarmId,
		selectedTaskId,
	};
}

export function buildAgentsWorkspaceModel(
	selection: INavigationSelection,
	state: IAtlasStateSnapshot,
	now: number = Date.now(),
): IAgentWorkspaceModel {
	const selectedDispatchId = selection.entity?.kind === EntityKind.Agent ? selection.entity.id : undefined;
	const selectedAgent = selectedDispatchId
		? state.fleet.agents.find(agent => agent.dispatchId === selectedDispatchId)
		: undefined;
	const groups = buildAgentWorkspaceGroups(state, selectedAgent, now);

	if (!selectedAgent) {
		return {
			mode: 'overview',
			title: 'Agents',
			subtitle: 'Dispatch-linked execution across live agents, with work rooted back to swarms and tasks instead of a flat console.',
			emptyMessage: emptyMessageForConnection(state.connection, 'No agents are currently visible in fleet state.'),
			stats: [
				stat('Running', String(state.fleet.activeCount), state.fleet.activeCount > 0 ? AttentionLevel.Active : undefined),
				stat('Blocked', String(state.fleet.blockedCount), state.fleet.blockedCount > 0 ? AttentionLevel.NeedsAction : undefined),
				stat('Failed', String(state.fleet.failedCount), state.fleet.failedCount > 0 ? AttentionLevel.Critical : undefined),
				stat('Idle', String(state.fleet.idleCount), state.fleet.idleCount > 0 ? AttentionLevel.Idle : undefined),
			],
			details: Object.freeze([]),
			links: Object.freeze([
				sectionLink('tasks', 'Browse Tasks', NavigationSection.Tasks),
				sectionLink('reviews', 'Browse Reviews', NavigationSection.Reviews),
				sectionLink('fleet', 'Open Fleet', NavigationSection.Fleet),
			]),
			pressureEntries: Object.freeze([]),
			groups: Object.freeze(groups),
			selectedDispatchId: undefined,
		};
	}

	const selectedSwarm = state.swarms.find(swarm => swarm.taskIds.includes(selectedAgent.taskId));
	const gate = state.reviewGates.find(entry => entry.dispatchId === selectedAgent.dispatchId && isReviewOutstanding(entry));
	const merge = state.mergeQueue.find(entry => entry.dispatchId === selectedAgent.dispatchId && isMergeAttentionEntry(entry));
	const links: IAtlasWorkspaceLink[] = [
		entityLink(`task:${selectedAgent.taskId}`, 'Open Task', taskTarget(selectedAgent.taskId)),
		sectionLink('fleet', 'Open Fleet', NavigationSection.Fleet),
	];
	if (selectedSwarm) {
		links.unshift(entityLink(`swarm:${selectedSwarm.swarmId}`, 'Open Swarm', swarmTarget(selectedSwarm.swarmId)));
	}
	if (gate) {
		links.push(entityLink(reviewItemId(gate.dispatchId, ReviewTargetKind.Gate), 'Open Gate', { kind: EntityKind.Review, id: gate.dispatchId, reviewTargetKind: ReviewTargetKind.Gate }));
	}
	if (merge) {
		links.push(entityLink(reviewItemId(merge.dispatchId, ReviewTargetKind.Merge), 'Open Merge', { kind: EntityKind.Review, id: merge.dispatchId, reviewTargetKind: ReviewTargetKind.Merge }));
	}

	return {
		mode: 'agent',
		title: selectedAgent.roleId,
		subtitle: `Dispatch ${selectedAgent.dispatchId}`,
		emptyMessage: 'No related agents are currently visible for this dispatch.',
		stats: [
			stat('Status', formatStateLabel(selectedAgent.status), selectedAgent.attentionLevel),
			stat('Heartbeat', formatRecencyLabel(now, selectedAgent.lastHeartbeat)),
			stat('Task', selectedAgent.taskId),
			stat('Swarm', selectedSwarm?.swarmId ?? 'Unmapped'),
			stat('Pressure', String(Number(gate !== undefined) + Number(merge !== undefined)), gate || merge ? highestAttention([gate?.attentionLevel ?? AttentionLevel.Idle, merge?.attentionLevel ?? AttentionLevel.Idle]) : undefined),
		],
		details: Object.freeze([
			detail('Role', selectedAgent.roleId, undefined),
			detail('Activity', selectedAgent.lastActivity ?? 'No recent activity reported', undefined),
			detail('In state', formatDurationLabel(selectedAgent.timeInState), undefined),
			detail('Started', formatRecencyLabel(now, selectedAgent.startedAt), undefined),
			detail('Worktree', selectedAgent.worktreePath ?? 'No worktree reported', undefined),
			detail('Cost spent', String(selectedAgent.costSpent), selectedAgent.costSpent > 0 ? AttentionLevel.Active : undefined),
		]),
		links: Object.freeze(links),
		pressureEntries: Object.freeze(buildAgentWorkspacePressureEntries(selectedAgent, state.reviewGates, state.mergeQueue)),
		groups: Object.freeze(groups),
		selectedDispatchId: selectedAgent.dispatchId,
	};
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

function buildFleetCommandItems(
	agents: readonly IAgentState[],
	swarms: readonly ISwarmState[],
	reviewGates: readonly IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
	now: number,
): readonly IFleetCommandItem[] {
	const swarmByTaskId = indexSwarmsByTaskId(swarms);
	const reviewByDispatchId = new Map(reviewGates.filter(isReviewOutstanding).map(gate => [gate.dispatchId, gate] as const));
	const mergeByDispatchId = new Map(mergeQueue.filter(isMergeAttentionEntry).map(entry => [entry.dispatchId, entry] as const));

	return Object.freeze([...agents]
		.map(agent => {
			const swarmId = swarmByTaskId.get(agent.taskId)?.swarmId;
			const gate = reviewByDispatchId.get(agent.dispatchId);
			const merge = mergeByDispatchId.get(agent.dispatchId);
			const primaryTarget: AtlasModel.ISelectedEntity = { kind: EntityKind.Agent, id: agent.dispatchId };
			const ownershipTarget: AtlasModel.ISelectedEntity = swarmId
				? { kind: EntityKind.Swarm, id: swarmId }
				: { kind: EntityKind.Task, id: agent.taskId };
			const pivots: IFleetCommandPivot[] = [
				{
					id: `agent:${agent.dispatchId}`,
					label: 'Agent',
					target: primaryTarget,
				},
				{
					id: swarmId ? `swarm:${swarmId}` : `task:${agent.taskId}`,
					label: swarmId ? 'Swarm' : 'Task',
					target: ownershipTarget,
				},
			];
			if (gate) {
				pivots.push({
					id: reviewItemId(gate.dispatchId, ReviewTargetKind.Gate),
					label: 'Gate',
					target: { kind: EntityKind.Review, id: gate.dispatchId, reviewTargetKind: ReviewTargetKind.Gate },
				});
			}
			if (merge) {
				pivots.push({
					id: reviewItemId(merge.dispatchId, ReviewTargetKind.Merge),
					label: merge.status === MergeExecutionStatus.MergeBlocked ? 'Merge blocked' : 'Merge',
					target: { kind: EntityKind.Review, id: merge.dispatchId, reviewTargetKind: ReviewTargetKind.Merge },
				});
			}

			const pressureLabels: string[] = [];
			if (gate) {
				pressureLabels.push(`Gate ${formatStateLabel(gate.reviewState)}`);
			}
			if (merge) {
				pressureLabels.push(`Merge ${formatStateLabel(merge.status)}`);
			}

			return {
				id: agent.dispatchId,
				dispatchId: agent.dispatchId,
				roleLabel: agent.roleId,
				taskId: agent.taskId,
				swarmId,
				status: agent.status,
				statusLabel: formatStateLabel(agent.status),
				attentionLevel: agent.attentionLevel,
				lastHeartbeat: agent.lastHeartbeat,
				heartbeatLabel: formatRecencyLabel(now, agent.lastHeartbeat),
				timeInStateLabel: formatDurationLabel(agent.timeInState),
				lastActivityLabel: agent.lastActivity ?? 'No recent activity reported',
				pressureSummary: pressureLabels.length > 0 ? pressureLabels.join(' • ') : undefined,
				hasReviewPressure: gate !== undefined,
				hasMergePressure: merge !== undefined,
				primaryTarget,
				pivots: Object.freeze(pivots),
			};
		})
		.sort(compareFleetCommandItems));
}

function buildFleetCommandGroup(
	id: string,
	label: string,
	summary: string,
	items: readonly IFleetCommandItem[],
	emptyMessage: string,
): IFleetCommandGroup {
	return {
		id,
		label,
		summary,
		count: items.length,
		attentionLevel: highestAttention(items.map(item => item.attentionLevel)),
		emptyMessage,
		items,
	};
}

function resolveSelectedSwarm(
	selection: INavigationSelection,
	swarms: readonly ISwarmState[],
): ISwarmState | undefined {
	const entity = selection.entity;
	return entity?.kind === EntityKind.Swarm
		? swarms.find(swarm => swarm.swarmId === entity.id)
		: entity?.kind === EntityKind.Task
			? swarms.find(swarm => swarm.taskIds.includes(entity.id))
			: entity?.kind === EntityKind.Objective
				? swarms.find(swarm => swarm.objectiveId === entity.id)
				: undefined;
}

function buildTaskWorkspaceTaskEntries(
	swarm: ISwarmState,
	tasks: readonly ITaskState[],
	agents: readonly IAgentState[],
	reviewGates: readonly IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
	selectedTaskId: string | undefined,
): readonly ITaskWorkspaceTaskEntry[] {
	const taskMap = new Map(tasks
		.filter(task => swarm.taskIds.includes(task.taskId))
		.map(task => [task.taskId, task] as const));
	const childrenByParent = new Map<string | undefined, ITaskState[]>();
	for (const task of taskMap.values()) {
		const bucket = childrenByParent.get(task.parentTaskId) ?? [];
		bucket.push(task);
		childrenByParent.set(task.parentTaskId, bucket);
	}
	for (const bucket of childrenByParent.values()) {
		bucket.sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.taskId.localeCompare(right.taskId));
	}

	const agentCountByTaskId = new Map<string, number>();
	for (const agent of agents) {
		agentCountByTaskId.set(agent.taskId, (agentCountByTaskId.get(agent.taskId) ?? 0) + 1);
	}

	const gateCountByTaskId = new Map<string, number>();
	for (const gate of reviewGates.filter(isReviewOutstanding)) {
		gateCountByTaskId.set(gate.taskId, (gateCountByTaskId.get(gate.taskId) ?? 0) + 1);
	}

	const mergeCountByTaskId = new Map<string, number>();
	for (const entry of mergeQueue.filter(isMergeAttentionEntry)) {
		mergeCountByTaskId.set(entry.taskId, (mergeCountByTaskId.get(entry.taskId) ?? 0) + 1);
	}

	const ordered: ITaskWorkspaceTaskEntry[] = [];
	const visited = new Set<string>();
	const visit = (task: ITaskState, depth: number): void => {
		if (visited.has(task.taskId)) {
			return;
		}
		visited.add(task.taskId);

		const pressureParts: string[] = [];
		const gateCount = gateCountByTaskId.get(task.taskId) ?? 0;
		const mergeCount = mergeCountByTaskId.get(task.taskId) ?? 0;
		if (gateCount > 0) {
			pressureParts.push(`${gateCount} gate${gateCount === 1 ? '' : 's'}`);
		}
		if (mergeCount > 0) {
			pressureParts.push(`${mergeCount} merge${mergeCount === 1 ? '' : 's'}`);
		}

		ordered.push({
			id: task.taskId,
			taskId: task.taskId,
			summary: task.summary || task.taskId,
			statusLabel: formatStateLabel(task.status),
			roleLabel: task.roleId,
			attentionLevel: task.attentionLevel,
			depth,
			selected: task.taskId === selectedTaskId,
			isRoot: task.taskId === swarm.rootTaskId,
			dispatchId: task.dispatchId,
			agentCount: agentCountByTaskId.get(task.taskId) ?? 0,
			pressureSummary: pressureParts.length > 0 ? pressureParts.join(' • ') : undefined,
			target: taskTarget(task.taskId),
		});

		for (const child of childrenByParent.get(task.taskId) ?? []) {
			visit(child, depth + 1);
		}
	};

	const rootTask = taskMap.get(swarm.rootTaskId);
	if (rootTask) {
		visit(rootTask, 0);
	}

	for (const task of [...taskMap.values()].sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.taskId.localeCompare(right.taskId))) {
		visit(task, task.taskId === swarm.rootTaskId ? 0 : 1);
	}

	return Object.freeze(ordered);
}

function buildTaskWorkspaceAgentEntries(
	swarm: ISwarmState,
	agents: readonly IAgentState[],
	now: number,
): readonly ITaskWorkspaceAgentEntry[] {
	return Object.freeze([...agents]
		.filter(agent => swarm.taskIds.includes(agent.taskId))
		.sort((left, right) =>
			right.attentionLevel - left.attentionLevel
			|| right.lastHeartbeat - left.lastHeartbeat
			|| left.dispatchId.localeCompare(right.dispatchId))
		.map(agent => ({
			id: agent.dispatchId,
			dispatchId: agent.dispatchId,
			label: agent.roleId,
			subtitle: `${agent.taskId} • ${formatRecencyLabel(now, agent.lastHeartbeat)}`,
			status: formatStateLabel(agent.status),
			attentionLevel: agent.attentionLevel,
			target: agentTarget(agent.dispatchId),
		})));
}

function buildTaskWorkspacePressureEntries(
	swarm: ISwarmState,
	reviewGates: readonly IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
): readonly ITaskWorkspacePressureEntry[] {
	const entries: ITaskWorkspacePressureEntry[] = [
		...reviewGates
			.filter(gate => swarm.taskIds.includes(gate.taskId) && isReviewOutstanding(gate))
			.map(gate => ({
				id: reviewItemId(gate.dispatchId, ReviewTargetKind.Gate),
				label: gate.roleId,
				subtitle: gate.taskId,
				status: formatStateLabel(gate.reviewState),
				kind: ReviewTargetKind.Gate,
				attentionLevel: gate.attentionLevel,
				target: { kind: EntityKind.Review, id: gate.dispatchId, reviewTargetKind: ReviewTargetKind.Gate },
			})),
		...mergeQueue
			.filter(entry => swarm.taskIds.includes(entry.taskId) && isMergeAttentionEntry(entry))
			.map(entry => ({
				id: reviewItemId(entry.dispatchId, ReviewTargetKind.Merge),
				label: basename(entry.worktreePath) || entry.candidateBranch,
				subtitle: entry.taskId,
				status: formatStateLabel(entry.status),
				kind: ReviewTargetKind.Merge,
				attentionLevel: entry.attentionLevel,
				target: { kind: EntityKind.Review, id: entry.dispatchId, reviewTargetKind: ReviewTargetKind.Merge },
			})),
	];

	return Object.freeze(entries.sort((left, right) =>
		right.attentionLevel - left.attentionLevel
		|| left.kind.localeCompare(right.kind)
		|| left.id.localeCompare(right.id)));
}

function buildAgentWorkspaceGroups(
	state: IAtlasStateSnapshot,
	selectedAgent: IAgentState | undefined,
	now: number,
): readonly IAgentWorkspaceGroup[] {
	const items = buildAgentWorkspaceItems(state.fleet.agents, state.swarms, state.reviewGates, state.mergeQueue, now, selectedAgent?.dispatchId);

	if (!selectedAgent) {
		return Object.freeze([
			buildAgentWorkspaceGroup(
				'running',
				'Running',
				'Dispatches actively executing or spawning on the current harness fabric.',
				items.filter(item => isRunningAgentStatus(item.statusKind)),
				'No agents are currently running.',
			),
			buildAgentWorkspaceGroup(
				'blocked',
				'Blocked',
				'Dispatches waiting on dependencies, external state, or human follow-up.',
				items.filter(item => item.statusKind === AgentStatus.Blocked),
				'No agents are currently blocked.',
			),
			buildAgentWorkspaceGroup(
				'failed',
				'Failed',
				'Dispatches that failed closed or timed out and need operator attention.',
				items.filter(item => isFailedAgentStatus(item.statusKind)),
				'No failed or timed-out agents are visible.',
			),
			buildAgentWorkspaceGroup(
				'idle',
				'Idle / recent',
				'Dispatches with no active execution in flight but still visible in fleet state.',
				items.filter(item => item.statusKind === AgentStatus.Idle || item.statusKind === AgentStatus.Completed),
				'No idle or recently completed agents are visible.',
			),
		]);
	}

	const selectedSwarm = state.swarms.find(swarm => swarm.taskIds.includes(selectedAgent.taskId));
	return Object.freeze([
		buildAgentWorkspaceGroup(
			'same-task',
			'Same task',
			'Other visible agents currently attached to the same task lineage node.',
			items.filter(item => item.dispatchId !== selectedAgent.dispatchId && item.taskId === selectedAgent.taskId),
			'No other visible agents are attached to this task.',
		),
		buildAgentWorkspaceGroup(
			'same-swarm',
			'Same swarm',
			'Other visible agents rooted in the same swarm but attached to different tasks.',
			items.filter(item =>
				item.dispatchId !== selectedAgent.dispatchId
				&& item.swarmId !== undefined
				&& item.swarmId === selectedSwarm?.swarmId
				&& item.taskId !== selectedAgent.taskId),
			'No other visible agents are currently mapped to this swarm.',
		),
	]);
}

function buildAgentWorkspaceItems(
	agents: readonly IAgentState[],
	swarms: readonly ISwarmState[],
	reviewGates: readonly IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
	now: number,
	selectedDispatchId: string | undefined,
): readonly IAgentWorkspaceItem[] {
	const swarmByTaskId = indexSwarmsByTaskId(swarms);
	const reviewByDispatchId = new Map(reviewGates.filter(isReviewOutstanding).map(gate => [gate.dispatchId, gate] as const));
	const mergeByDispatchId = new Map(mergeQueue.filter(isMergeAttentionEntry).map(entry => [entry.dispatchId, entry] as const));

	return Object.freeze([...agents]
		.map(agent => {
			const swarmId = swarmByTaskId.get(agent.taskId)?.swarmId;
			const gate = reviewByDispatchId.get(agent.dispatchId);
			const merge = mergeByDispatchId.get(agent.dispatchId);
			const pressureParts: string[] = [];
			if (gate) {
				pressureParts.push(`Gate ${formatStateLabel(gate.reviewState)}`);
			}
			if (merge) {
				pressureParts.push(`Merge ${formatStateLabel(merge.status)}`);
			}
			return {
				id: agent.dispatchId,
				dispatchId: agent.dispatchId,
				title: agent.roleId,
				subtitle: `${agent.dispatchId} • ${agent.taskId}`,
				statusKind: agent.status,
				status: formatStateLabel(agent.status),
				attentionLevel: agent.attentionLevel,
				heartbeatLabel: formatRecencyLabel(now, agent.lastHeartbeat),
				activityLabel: agent.lastActivity ?? 'No recent activity reported',
				taskId: agent.taskId,
				swarmId,
				worktreePath: agent.worktreePath,
				pressureSummary: pressureParts.length > 0 ? pressureParts.join(' • ') : undefined,
				selected: agent.dispatchId === selectedDispatchId,
				target: agentTarget(agent.dispatchId),
			};
		})
		.sort((left, right) =>
			Number(right.selected) - Number(left.selected)
			|| right.attentionLevel - left.attentionLevel
			|| left.dispatchId.localeCompare(right.dispatchId)));
}

function buildAgentWorkspacePressureEntries(
	agent: IAgentState,
	reviewGates: readonly IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
): readonly IAgentWorkspacePressureEntry[] {
	const entries: IAgentWorkspacePressureEntry[] = [];
	const gate = reviewGates.find(entry => entry.dispatchId === agent.dispatchId && isReviewOutstanding(entry));
	const merge = mergeQueue.find(entry => entry.dispatchId === agent.dispatchId && isMergeAttentionEntry(entry));
	if (gate) {
		entries.push({
			id: reviewItemId(gate.dispatchId, ReviewTargetKind.Gate),
			label: gate.roleId,
			subtitle: gate.taskId,
			status: formatStateLabel(gate.reviewState),
			kind: ReviewTargetKind.Gate,
			attentionLevel: gate.attentionLevel,
			target: { kind: EntityKind.Review, id: gate.dispatchId, reviewTargetKind: ReviewTargetKind.Gate },
		});
	}
	if (merge) {
		entries.push({
			id: reviewItemId(merge.dispatchId, ReviewTargetKind.Merge),
			label: basename(merge.worktreePath) || merge.candidateBranch,
			subtitle: merge.taskId,
			status: formatStateLabel(merge.status),
			kind: ReviewTargetKind.Merge,
			attentionLevel: merge.attentionLevel,
			target: { kind: EntityKind.Review, id: merge.dispatchId, reviewTargetKind: ReviewTargetKind.Merge },
		});
	}
	return Object.freeze(entries);
}

function buildAgentWorkspaceGroup(
	id: string,
	label: string,
	summary: string,
	items: readonly IAgentWorkspaceItem[],
	emptyMessage: string,
): IAgentWorkspaceGroup {
	return {
		id,
		label,
		summary,
		count: items.length,
		attentionLevel: highestAttention(items.map(item => item.attentionLevel)),
		emptyMessage,
		items,
	};
}

function entityLink(id: string, label: string, target: AtlasModel.ISelectedEntity): IEntityWorkspaceLink {
	return { kind: 'entity', id, label, target };
}

function sectionLink(id: string, label: string, section: NavigationSection): ISectionWorkspaceLink {
	return { kind: 'section', id, label, section };
}

function swarmTarget(id: string): AtlasModel.ISelectedEntity {
	return { kind: EntityKind.Swarm, id };
}

function taskTarget(id: string): AtlasModel.ISelectedEntity {
	return { kind: EntityKind.Task, id };
}

function objectiveTarget(id: string): AtlasModel.ISelectedEntity {
	return { kind: EntityKind.Objective, id };
}

function agentTarget(id: string): AtlasModel.ISelectedEntity {
	return { kind: EntityKind.Agent, id };
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

function compareFleetCommandItems(left: IFleetCommandItem, right: IFleetCommandItem): number {
	return right.attentionLevel - left.attentionLevel
		|| Number(right.hasMergePressure) - Number(left.hasMergePressure)
		|| Number(right.hasReviewPressure) - Number(left.hasReviewPressure)
		|| right.lastHeartbeat - left.lastHeartbeat
		|| left.dispatchId.localeCompare(right.dispatchId);
}

function buildReviewWorkspaceActions(
	connection: IHarnessConnectionInfo,
	gate: AtlasModel.IReviewGateState | undefined,
	merge: AtlasModel.IMergeEntry | undefined,
	target: IReviewSelectedEntity | undefined,
	pendingAction: ReviewWorkspaceActionId | undefined,
): readonly IReviewWorkspaceAction[] {
	const hasTarget = target !== undefined;
	const targetKind = target?.reviewTargetKind;
	const busy = pendingAction !== undefined;
	return Object.freeze([
		reviewAction(
			ReviewWorkspaceActionId.RecordGo,
			'Record Go',
			'Record the authoritative judge verdict as axiom-judge.',
			'primary',
			gateVerdictDisabledReason(connection, gate, targetKind, hasTarget) ?? undefined,
			busy,
			pendingAction,
		),
		reviewAction(
			ReviewWorkspaceActionId.RecordNoGo,
			'Record No-Go',
			'Record the blocking judge verdict as axiom-judge.',
			'danger',
			gateVerdictDisabledReason(connection, gate, targetKind, hasTarget) ?? undefined,
			busy,
			pendingAction,
		),
		reviewAction(
			ReviewWorkspaceActionId.AuthorizePromotion,
			'Authorize Promotion',
			'Advance a review-go dispatch into the promotion lane as axiom-planner.',
			'secondary',
			authorizePromotionDisabledReason(connection, gate, targetKind, hasTarget) ?? undefined,
			busy,
			pendingAction,
		),
		reviewAction(
			ReviewWorkspaceActionId.EnqueueMerge,
			'Enqueue for Merge',
			'Place a promotion-authorized dispatch into the authoritative merge lane.',
			'secondary',
			enqueueMergeDisabledReason(connection, gate, merge, hasTarget) ?? undefined,
			busy,
			pendingAction,
		),
	]);
}

function reviewAction(
	id: ReviewWorkspaceActionId,
	label: string,
	description: string,
	emphasis: 'primary' | 'secondary' | 'danger',
	disabledReason: string | undefined,
	busy: boolean,
	pendingAction: ReviewWorkspaceActionId | undefined,
): IReviewWorkspaceAction {
	const running = pendingAction === id;
	return {
		id,
		label,
		description,
		enabled: !busy && !disabledReason,
		running,
		disabledReason: running ? undefined : disabledReason,
		emphasis,
	};
}

function buildReadOnlyMessage(
	connection: IHarnessConnectionInfo,
	gate: AtlasModel.IReviewGateState | undefined,
	merge: AtlasModel.IMergeEntry | undefined,
): string | undefined {
	if (!gate && !merge) {
		return undefined;
	}
	if (
		connection.supportedWriteMethods.includes('review.gate_verdict')
		|| connection.supportedWriteMethods.includes('review.authorize_promotion')
		|| connection.supportedWriteMethods.includes('review.enqueue_merge')
	) {
		return undefined;
	}
	return connection.mode === 'daemon' && connection.state === HarnessConnectionState.Connected
		? 'The current daemon connection does not advertise review or merge write methods for this workspace.'
		: 'This review workspace is read-only until a daemon connection with the required review methods is available.';
}

function gateVerdictDisabledReason(
	connection: IHarnessConnectionInfo,
	gate: AtlasModel.IReviewGateState | undefined,
	targetKind: ReviewTargetKind | undefined,
	hasTarget: boolean,
): string | undefined {
	if (!hasTarget) {
		return 'Select a review target to record a verdict.';
	}
	if (targetKind !== ReviewTargetKind.Gate) {
		return 'Select a review gate target to record a verdict.';
	}
	const unsupportedReason = unavailableReasonForWriteMethod(connection, 'review.gate_verdict');
	if (unsupportedReason) {
		return unsupportedReason;
	}
	if (!gate) {
		return 'No authoritative review gate exists for this dispatch.';
	}
	if (gate.reviewState !== WireReviewState.AwaitingReview) {
		return 'This review gate is not awaiting a verdict.';
	}
	return undefined;
}

function authorizePromotionDisabledReason(
	connection: IHarnessConnectionInfo,
	gate: AtlasModel.IReviewGateState | undefined,
	targetKind: ReviewTargetKind | undefined,
	hasTarget: boolean,
): string | undefined {
	if (!hasTarget) {
		return 'Select a review target to authorize promotion.';
	}
	if (targetKind !== ReviewTargetKind.Gate) {
		return 'Select a review gate target to authorize promotion.';
	}
	const unsupportedReason = unavailableReasonForWriteMethod(connection, 'review.authorize_promotion');
	if (unsupportedReason) {
		return unsupportedReason;
	}
	if (!gate) {
		return 'No authoritative review gate exists for this dispatch.';
	}
	if (gate.reviewState !== WireReviewState.ReviewGo) {
		return 'A go verdict is required before promotion can be authorized.';
	}
	if (gate.promotionState !== WirePromotionState.NotRequested) {
		return 'Promotion is no longer awaiting authorization.';
	}
	return undefined;
}

function enqueueMergeDisabledReason(
	connection: IHarnessConnectionInfo,
	gate: AtlasModel.IReviewGateState | undefined,
	merge: AtlasModel.IMergeEntry | undefined,
	hasTarget: boolean,
): string | undefined {
	if (!hasTarget) {
		return 'Select a review target to enqueue merge.';
	}
	const unsupportedReason = unavailableReasonForWriteMethod(connection, 'review.enqueue_merge');
	if (unsupportedReason) {
		return unsupportedReason;
	}
	if (!gate) {
		return 'No authoritative review gate exists for this dispatch.';
	}
	if (gate.promotionState !== WirePromotionState.PromotionAuthorized) {
		return 'Promotion must be authorized before merge can be enqueued.';
	}
	if (merge && merge.status !== MergeExecutionStatus.Abandoned) {
		return 'This dispatch is already in the merge lane.';
	}
	return undefined;
}

function pendingLabel(action: ReviewWorkspaceActionId): string {
	switch (action) {
		case ReviewWorkspaceActionId.RecordGo:
			return 'Recording go verdict…';
		case ReviewWorkspaceActionId.RecordNoGo:
			return 'Recording no-go verdict…';
		case ReviewWorkspaceActionId.AuthorizePromotion:
			return 'Authorizing promotion…';
		case ReviewWorkspaceActionId.EnqueueMerge:
			return 'Enqueuing merge…';
	}
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

function detail(label: string, value: string, attentionLevel: AttentionLevel | undefined): IReviewWorkspaceDetail {
	return { label, value, attentionLevel };
}

function isMergeAttentionEntry(entry: AtlasModel.IMergeEntry): boolean {
	return entry.status !== MergeExecutionStatus.Merged && entry.status !== MergeExecutionStatus.Abandoned;
}

function isRunningAgentStatus(status: AgentStatus): boolean {
	return status === AgentStatus.Running || status === AgentStatus.Spawning;
}

function isFailedAgentStatus(status: AgentStatus): boolean {
	return status === AgentStatus.Failed || status === AgentStatus.TimedOut;
}

function formatRecencyLabel(now: number, timestamp: number): string {
	const deltaMs = Math.max(0, now - timestamp);
	if (deltaMs < 60_000) {
		return `${Math.max(1, Math.floor(deltaMs / 1000))}s ago`;
	}
	if (deltaMs < 3_600_000) {
		return `${Math.floor(deltaMs / 60_000)}m ago`;
	}
	if (deltaMs < 86_400_000) {
		return `${Math.floor(deltaMs / 3_600_000)}h ago`;
	}
	return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}

function formatDurationLabel(durationMs: number): string {
	if (durationMs < 60_000) {
		return `${Math.max(1, Math.floor(durationMs / 1000))}s`;
	}
	if (durationMs < 3_600_000) {
		return `${Math.floor(durationMs / 60_000)}m`;
	}
	return `${Math.floor(durationMs / 3_600_000)}h`;
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
