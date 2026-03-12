/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 8 inspector models are sessions-only contrib code that shape already-bridged harness reads into a read-only inspector surface. */

import { basename } from '../../../../base/common/path.js';
import { AttentionLevel } from '../../../common/model/attention.js';
import { EntityKind, NavigationSection, ReviewTargetKind, type INavigationSelection } from '../../../common/model/selection.js';
import { type IHarnessService } from '../../../services/harness/common/harnessService.js';
import type {
	IHarnessArtifactPreview,
	IReviewProvenanceEntry,
	IHarnessTranscriptSnapshot,
} from '../../../services/harness/common/harnessTypes.js';

export interface IAtlasInspectorStateSnapshot {
	readonly connection: import('../../../services/harness/common/harnessService.js').IHarnessConnectionInfo;
	readonly swarms: readonly AtlasModel.ISwarmState[];
	readonly tasks: readonly AtlasModel.ITaskState[];
	readonly objectives: readonly AtlasModel.IObjectiveState[];
	readonly fleet: AtlasModel.IFleetState;
	readonly health: AtlasModel.IHealthState;
	readonly reviewGates: readonly AtlasModel.IReviewGateState[];
	readonly mergeQueue: readonly AtlasModel.IMergeEntry[];
}

export interface IAtlasInspectorDetail {
	readonly label: string;
	readonly value: string;
	readonly attentionLevel: AttentionLevel | undefined;
}

export interface IAtlasInspectorLink {
	readonly kind: 'entity' | 'section';
	readonly id: string;
	readonly label: string;
	readonly target?: AtlasModel.ISelectedEntity;
	readonly section?: NavigationSection;
}

export type InspectorLoadState = 'loading' | 'ready' | 'empty' | 'error';

export interface IAtlasInspectorSectionBase {
	readonly title: string;
	readonly state: InspectorLoadState;
	readonly message: string | undefined;
}

export interface IAtlasInspectorOverviewSection extends IAtlasInspectorSectionBase {
	readonly details: readonly IAtlasInspectorDetail[];
	readonly links: readonly IAtlasInspectorLink[];
}

export interface IAtlasInspectorWorktreeEntry {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly worktreePath: string;
	readonly branch: string | undefined;
	readonly baseRef: string | undefined;
	readonly headSha: string | undefined;
	readonly workingTreeClean: boolean | undefined;
	readonly mergeReady: boolean | undefined;
	readonly updatedAt: number | undefined;
	readonly attentionLevel: AttentionLevel;
}

export interface IAtlasInspectorWorktreeSection extends IAtlasInspectorSectionBase {
	readonly entries: readonly IAtlasInspectorWorktreeEntry[];
}

export interface IAtlasInspectorResultSection extends IAtlasInspectorSectionBase {
	readonly packet: AtlasModel.IWireResultPacket | undefined;
}

export interface IAtlasInspectorArtifactEntry {
	readonly artifactPath: string;
	readonly kind: string;
	readonly sizeBytes: number;
}

export interface IAtlasInspectorArtifactSection extends IAtlasInspectorSectionBase {
	readonly dispatchId: string | undefined;
	readonly inventory: readonly IAtlasInspectorArtifactEntry[];
	readonly preview: IHarnessArtifactPreview | undefined;
}

export interface IAtlasInspectorMemoryEntry {
	readonly recordId: string;
	readonly memoryType: string;
	readonly scope: string;
	readonly lifecycle: string;
	readonly createdByRole: string;
	readonly createdAt: string;
	readonly summary: string;
}

export interface IAtlasInspectorMemorySection extends IAtlasInspectorSectionBase {
	readonly scopeLabel: string | undefined;
	readonly records: readonly IAtlasInspectorMemoryEntry[];
}

export interface IAtlasInspectorActivityEntry {
	readonly timestamp: number;
	readonly kind: string;
	readonly summary: string;
	readonly tool: string | undefined;
	readonly filePath: string | undefined;
	readonly durationMs: number | undefined;
}

export interface IAtlasInspectorActivitySection extends IAtlasInspectorSectionBase {
	readonly entries: readonly IAtlasInspectorActivityEntry[];
}

export interface IAtlasInspectorTranscriptSection extends IAtlasInspectorSectionBase {
	readonly snapshot: IHarnessTranscriptSnapshot | undefined;
}

export interface IAtlasInspectorProvenanceSection extends IAtlasInspectorSectionBase {
	readonly entries: readonly IReviewProvenanceEntry[];
}

export interface IAtlasInspectorModel {
	readonly key: string;
	readonly title: string;
	readonly subtitle: string;
	readonly overview: IAtlasInspectorOverviewSection;
	readonly worktree: IAtlasInspectorWorktreeSection;
	readonly result: IAtlasInspectorResultSection;
	readonly artifacts: IAtlasInspectorArtifactSection;
	readonly memory: IAtlasInspectorMemorySection;
	readonly activity: IAtlasInspectorActivitySection;
	readonly transcript: IAtlasInspectorTranscriptSection;
	readonly provenance: IAtlasInspectorProvenanceSection;
}

interface IInspectorContext {
	readonly key: string;
	readonly selection: INavigationSelection;
	readonly entity: AtlasModel.ISelectedEntity;
	readonly swarm: AtlasModel.ISwarmState | undefined;
	readonly task: AtlasModel.ITaskState | undefined;
	readonly objective: AtlasModel.IObjectiveState | undefined;
	readonly agent: AtlasModel.IAgentState | undefined;
	readonly gate: AtlasModel.IReviewGateState | undefined;
	readonly merge: AtlasModel.IMergeEntry | undefined;
	readonly rootTaskId: string | undefined;
	readonly taskId: string | undefined;
	readonly dispatchId: string | undefined;
	readonly reviewTargetKind: ReviewTargetKind | undefined;
}

export function createLoadingAtlasInspectorModel(
	selection: INavigationSelection,
	state: IAtlasInspectorStateSnapshot,
): IAtlasInspectorModel | undefined {
	const context = resolveInspectorContext(selection, state);
	if (!context) {
		return undefined;
	}

	return {
		key: context.key,
		title: inspectorTitle(context),
		subtitle: inspectorSubtitle(context),
		overview: {
			title: 'Overview',
			state: 'ready',
			message: undefined,
			details: buildOverviewDetails(context, state),
			links: buildOverviewLinks(context),
		},
		worktree: loadingSection('Worktree', { entries: Object.freeze([]) }),
		result: { ...loadingSection('Result'), packet: undefined },
		artifacts: { ...loadingSection('Artifacts'), dispatchId: context.dispatchId, inventory: Object.freeze([]), preview: undefined },
		memory: { ...loadingSection('Memory'), scopeLabel: undefined, records: Object.freeze([]) },
		activity: { ...loadingSection('Activity'), entries: Object.freeze([]) },
		transcript: { ...loadingSection('Transcript'), snapshot: undefined },
		provenance: { ...loadingSection('Provenance'), entries: Object.freeze([]) },
	};
}

export async function buildAtlasInspectorModel(
	selection: INavigationSelection,
	state: IAtlasInspectorStateSnapshot,
	harnessService: IHarnessService,
): Promise<IAtlasInspectorModel | undefined> {
	const context = resolveInspectorContext(selection, state);
	if (!context) {
		return undefined;
	}

	const [
		worktree,
		result,
		artifacts,
		memory,
		activity,
		transcript,
		provenance,
	] = await Promise.all([
		loadWorktreeSection(context, harnessService),
		loadResultSection(context, harnessService),
		loadArtifactSection(context, harnessService),
		loadMemorySection(context, harnessService),
		loadActivitySection(context, harnessService),
		loadTranscriptSection(context, harnessService),
		loadProvenanceSection(context, harnessService),
	]);

	return {
		key: context.key,
		title: inspectorTitle(context),
		subtitle: inspectorSubtitle(context),
		overview: {
			title: 'Overview',
			state: 'ready',
			message: undefined,
			details: buildOverviewDetails(context, state),
			links: buildOverviewLinks(context),
		},
		worktree,
		result,
		artifacts,
		memory,
		activity,
		transcript,
		provenance,
	};
}

function resolveInspectorContext(
	selection: INavigationSelection,
	state: IAtlasInspectorStateSnapshot,
): IInspectorContext | undefined {
	const entity = selection.entity;
	if (!entity) {
		return undefined;
	}

	if (entity.kind === EntityKind.Swarm) {
		const swarm = state.swarms.find(candidate => candidate.swarmId === entity.id);
		if (!swarm) {
			return undefined;
		}
		const objective = swarm.objectiveId
			? state.objectives.find(candidate => candidate.objectiveId === swarm.objectiveId)
			: undefined;
		return {
			key: `swarm:${swarm.swarmId}`,
			selection,
			entity,
			swarm,
			task: state.tasks.find(candidate => candidate.taskId === swarm.rootTaskId),
			objective,
			agent: undefined,
			gate: undefined,
			merge: undefined,
			rootTaskId: swarm.rootTaskId,
			taskId: swarm.rootTaskId,
			dispatchId: undefined,
			reviewTargetKind: undefined,
		};
	}

	if (entity.kind === EntityKind.Task) {
		const task = state.tasks.find(candidate => candidate.taskId === entity.id);
		if (!task) {
			return undefined;
		}
		const swarm = state.swarms.find(candidate => candidate.taskIds.includes(task.taskId));
		const objective = swarm?.objectiveId
			? state.objectives.find(candidate => candidate.objectiveId === swarm.objectiveId)
			: undefined;
		return {
			key: `task:${task.taskId}`,
			selection,
			entity,
			swarm,
			task,
			objective,
			agent: task.dispatchId ? state.fleet.agents.find(candidate => candidate.dispatchId === task.dispatchId) : undefined,
			gate: task.dispatchId ? state.reviewGates.find(candidate => candidate.dispatchId === task.dispatchId) : undefined,
			merge: task.dispatchId ? state.mergeQueue.find(candidate => candidate.dispatchId === task.dispatchId) : undefined,
			rootTaskId: swarm?.rootTaskId ?? task.taskId,
			taskId: task.taskId,
			dispatchId: task.dispatchId,
			reviewTargetKind: undefined,
		};
	}

	if (entity.kind === EntityKind.Agent) {
		const agent = state.fleet.agents.find(candidate => candidate.dispatchId === entity.id);
		if (!agent) {
			return undefined;
		}
		const swarm = state.swarms.find(candidate => candidate.taskIds.includes(agent.taskId));
		const task = state.tasks.find(candidate => candidate.taskId === agent.taskId);
		const objective = swarm?.objectiveId
			? state.objectives.find(candidate => candidate.objectiveId === swarm.objectiveId)
			: undefined;
		return {
			key: `agent:${agent.dispatchId}`,
			selection,
			entity,
			swarm,
			task,
			objective,
			agent,
			gate: state.reviewGates.find(candidate => candidate.dispatchId === agent.dispatchId),
			merge: state.mergeQueue.find(candidate => candidate.dispatchId === agent.dispatchId),
			rootTaskId: swarm?.rootTaskId ?? task?.taskId ?? agent.taskId,
			taskId: agent.taskId,
			dispatchId: agent.dispatchId,
			reviewTargetKind: undefined,
		};
	}

	if (entity.kind === EntityKind.Review) {
		const gate = state.reviewGates.find(candidate => candidate.dispatchId === entity.id);
		const merge = state.mergeQueue.find(candidate => candidate.dispatchId === entity.id);
		const taskId = gate?.taskId ?? merge?.taskId;
		if (!taskId) {
			return undefined;
		}
		const swarm = state.swarms.find(candidate => candidate.taskIds.includes(taskId));
		const task = state.tasks.find(candidate => candidate.taskId === taskId);
		const objective = swarm?.objectiveId
			? state.objectives.find(candidate => candidate.objectiveId === swarm.objectiveId)
			: undefined;
		return {
			key: `review:${entity.reviewTargetKind}:${entity.id}`,
			selection,
			entity,
			swarm,
			task,
			objective,
			agent: state.fleet.agents.find(candidate => candidate.dispatchId === entity.id),
			gate,
			merge,
			rootTaskId: swarm?.rootTaskId ?? taskId,
			taskId,
			dispatchId: entity.id,
			reviewTargetKind: entity.reviewTargetKind,
		};
	}

	return undefined;
}

function buildOverviewDetails(
	context: IInspectorContext,
	state: IAtlasInspectorStateSnapshot,
): readonly IAtlasInspectorDetail[] {
	const details: IAtlasInspectorDetail[] = [
		detail('Selection', selectionLabel(context), entityAttention(context)),
		detail('Swarm', context.swarm?.swarmId ?? 'Unmapped', context.swarm?.attentionLevel),
		detail('Task', context.taskId ?? '—', context.task?.attentionLevel),
		detail('Dispatch', context.dispatchId ?? 'Dispatch-scoped data unavailable', context.agent?.attentionLevel),
		detail('Health', formatStateLabel(state.health.mode), state.health.attentionLevel),
	];

	if (context.objective) {
		details.push(detail('Objective', `${context.objective.objectiveId} • ${context.objective.problemStatement}`, context.objective.attentionLevel));
	}

	if (context.agent) {
		details.push(detail('Agent status', formatStateLabel(context.agent.status), context.agent.attentionLevel));
	}

	if (context.gate) {
		details.push(detail('Gate', formatStateLabel(context.gate.reviewState), context.gate.attentionLevel));
	}

	if (context.merge) {
		details.push(detail('Merge', formatStateLabel(context.merge.status), context.merge.attentionLevel));
	}

	return Object.freeze(details);
}

function buildOverviewLinks(context: IInspectorContext): readonly IAtlasInspectorLink[] {
	const links: IAtlasInspectorLink[] = [];
	if (context.swarm) {
		links.push(entityLink(`swarm:${context.swarm.swarmId}`, 'Open swarm', { kind: EntityKind.Swarm, id: context.swarm.swarmId }));
	}
	if (context.taskId) {
		links.push(entityLink(`task:${context.taskId}`, 'Open task', { kind: EntityKind.Task, id: context.taskId }));
	}
	if (context.dispatchId) {
		links.push(entityLink(`agent:${context.dispatchId}`, 'Open agent', { kind: EntityKind.Agent, id: context.dispatchId }));
	}
	if (context.reviewTargetKind && context.dispatchId) {
		links.push(entityLink(
			`review:${context.reviewTargetKind}:${context.dispatchId}`,
			context.reviewTargetKind === ReviewTargetKind.Gate ? 'Open gate' : 'Open merge',
			{ kind: EntityKind.Review, id: context.dispatchId, reviewTargetKind: context.reviewTargetKind },
		));
	}
	links.push(sectionLink(`section:${NavigationSection.Fleet}`, 'Open Fleet', NavigationSection.Fleet));
	return Object.freeze(links);
}

async function loadWorktreeSection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorWorktreeSection> {
	try {
		const states = context.dispatchId
			? compact([await harnessService.getWorktreeState(context.dispatchId)])
			: context.rootTaskId
				? await harnessService.getWorktreeStates(context.rootTaskId)
				: Object.freeze([]);
		if (states.length === 0) {
			return emptySection('Worktree', context.dispatchId
				? 'No worktree state is currently available for this dispatch.'
				: context.rootTaskId
					? 'No rooted worktree state is currently available for this task tree.'
					: 'Worktree state is not available for this selection.', {
				entries: Object.freeze([]),
			});
		}
		return {
			title: 'Worktree',
			state: 'ready',
			message: undefined,
			entries: Object.freeze(states.map(state => ({
				dispatchId: state.dispatchId,
				taskId: state.taskId,
				objectiveId: state.objectiveId,
				worktreePath: state.worktreePath,
				branch: state.branch,
				baseRef: state.baseRef,
				headSha: state.headSha,
				workingTreeClean: state.workingTreeClean,
				mergeReady: state.mergeReady,
				updatedAt: state.updatedAt,
				attentionLevel: state.attentionLevel,
			}))),
		};
	} catch (error) {
		return errorSection('Worktree', asError(error).message, { entries: Object.freeze([]) });
	}
}

async function loadResultSection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorResultSection> {
	if (!context.dispatchId) {
		return emptySection('Result', 'Result inspection is dispatch-scoped. Select an agent or review target for result truth.', { packet: undefined });
	}
	try {
		const packet = await harnessService.getResultPacket(context.dispatchId);
		if (!packet) {
			return emptySection('Result', 'No result packet is currently available for this dispatch.', { packet: undefined });
		}
		return {
			title: 'Result',
			state: 'ready',
			message: undefined,
			packet,
		};
	} catch (error) {
		return errorSection('Result', asError(error).message, { packet: undefined });
	}
}

async function loadArtifactSection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorArtifactSection> {
	if (!context.dispatchId) {
		return emptySection('Artifacts', 'Artifact inspection is dispatch-scoped. Select an agent or review target for artifact truth.', {
			dispatchId: undefined,
			inventory: Object.freeze([]),
			preview: undefined,
		});
	}
	try {
		const inventory = await harnessService.getArtifacts(context.dispatchId);
		if (!inventory || inventory.artifacts.length === 0) {
			return emptySection('Artifacts', 'No artifact inventory is currently available for this dispatch.', {
				dispatchId: context.dispatchId,
				inventory: Object.freeze([]),
				preview: undefined,
			});
		}
		const first = inventory.artifacts[0];
		const preview = await harnessService.getArtifactPreview(context.dispatchId, first.artifactPath);
		return {
			title: 'Artifacts',
			state: 'ready',
			message: preview?.textPreview ? 'Showing the first available text preview for this dispatch.' : undefined,
			dispatchId: context.dispatchId,
			inventory: Object.freeze(inventory.artifacts.map(artifact => ({
				artifactPath: artifact.artifactPath,
				kind: artifact.kind,
				sizeBytes: artifact.sizeBytes,
			}))),
			preview,
		};
	} catch (error) {
		return errorSection('Artifacts', asError(error).message, {
			dispatchId: context.dispatchId,
			inventory: Object.freeze([]),
			preview: undefined,
		});
	}
}

async function loadMemorySection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorMemorySection> {
	const scopeLabel = context.entity.kind === EntityKind.Task || context.entity.kind === EntityKind.Agent || context.entity.kind === EntityKind.Review
		? (context.taskId ? `Task ${context.taskId}` : undefined)
		: (context.rootTaskId ? `Root task ${context.rootTaskId}` : undefined);
	try {
		const records = context.entity.kind === EntityKind.Task || context.entity.kind === EntityKind.Agent || context.entity.kind === EntityKind.Review
			? (context.taskId ? await harnessService.getTaskMemoryRecords(context.taskId) : Object.freeze([]))
			: (context.rootTaskId ? await harnessService.getMemoryRecords(context.rootTaskId) : Object.freeze([]));
		if (records.length === 0) {
			return emptySection('Memory', 'No memory records are currently available for this selection.', {
				scopeLabel,
				records: Object.freeze([]),
			});
		}
		return {
			title: 'Memory',
			state: 'ready',
			message: undefined,
			scopeLabel,
			records: Object.freeze(records.map(record => ({
				recordId: record.header.record_id,
				memoryType: formatStateLabel(record.header.memory_type),
				scope: formatStateLabel(record.header.scope),
				lifecycle: formatStateLabel(record.header.lifecycle),
				createdByRole: record.header.created_by_role,
				createdAt: record.header.created_at,
				summary: summarizeMemoryRecord(record),
			}))),
		};
	} catch (error) {
		return errorSection('Memory', asError(error).message, {
			scopeLabel,
			records: Object.freeze([]),
		});
	}
}

async function loadActivitySection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorActivitySection> {
	if (!context.dispatchId) {
		return emptySection('Activity', 'Activity is dispatch-scoped. Atlas does not invent swarm-global activity history.', {
			entries: Object.freeze([]),
		});
	}
	try {
		const entries = await harnessService.getAgentActivity(context.dispatchId);
		if (entries.length === 0) {
			return emptySection('Activity', 'No recent activity is currently available for this dispatch.', {
				entries: Object.freeze([]),
			});
		}
		return {
			title: 'Activity',
			state: 'ready',
			message: undefined,
			entries: Object.freeze(entries.map(entry => ({
				timestamp: entry.timestamp,
				kind: formatStateLabel(entry.kind),
				summary: entry.summary,
				tool: entry.tool,
				filePath: entry.filePath,
				durationMs: entry.durationMs,
			}))),
		};
	} catch (error) {
		return errorSection('Activity', asError(error).message, { entries: Object.freeze([]) });
	}
}

async function loadTranscriptSection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorTranscriptSection> {
	if (!context.dispatchId) {
		return emptySection('Transcript', 'Transcript inspection is dispatch-scoped. Atlas does not invent rooted transcript replay.', {
			snapshot: undefined,
		});
	}
	try {
		const snapshot = await harnessService.getTranscript(context.dispatchId);
		if (!snapshot || !snapshot.available) {
			return emptySection('Transcript', 'No bounded transcript snapshot is currently available for this dispatch.', {
				snapshot,
			});
		}
		return {
			title: 'Transcript',
			state: 'ready',
			message: undefined,
			snapshot,
		};
	} catch (error) {
		return errorSection('Transcript', asError(error).message, { snapshot: undefined });
	}
}

async function loadProvenanceSection(context: IInspectorContext, harnessService: IHarnessService): Promise<IAtlasInspectorProvenanceSection> {
	if (!context.reviewTargetKind || !context.dispatchId) {
		return emptySection('Provenance', 'Provenance is review-target scoped. Select a gate or merge target for bounded audit history.', {
			entries: Object.freeze([]),
		});
	}
	try {
		const allEntries = await harnessService.getReviewProvenance(context.dispatchId);
		const entries = filterProvenanceEntries(allEntries, context.reviewTargetKind);
		if (entries.length === 0) {
			return emptySection('Provenance', 'No provenance entries are currently available for this review target.', {
				entries: Object.freeze([]),
			});
		}
		return {
			title: 'Provenance',
			state: 'ready',
			message: undefined,
			entries: Object.freeze(entries),
		};
	} catch (error) {
		return errorSection('Provenance', asError(error).message, { entries: Object.freeze([]) });
	}
}

function filterProvenanceEntries(
	entries: readonly IReviewProvenanceEntry[],
	targetKind: ReviewTargetKind,
): readonly IReviewProvenanceEntry[] {
	return Object.freeze(entries.filter(entry => {
		if (targetKind === ReviewTargetKind.Gate) {
			return entry.method === 'review.gate_verdict' || entry.method === 'review.authorize_promotion';
		}
		return entry.method === 'review.enqueue_merge';
	}));
}

function summarizeMemoryRecord(record: AtlasModel.IWireMemoryRecord): string {
	switch (record.body.memory_type) {
		case 'decision':
			return record.body.body.decision_text;
		case 'invariant':
			return record.body.body.invariant_text;
		case 'finding':
			return record.body.body.finding_text;
		case 'failure_pattern':
			return record.body.body.pattern_text;
		case 'procedure':
			return record.body.body.procedure_text;
		case 'open_question':
			return record.body.body.question_text;
		default:
			return record.header.record_id;
	}
}

function selectionLabel(context: IInspectorContext): string {
	switch (context.entity.kind) {
		case EntityKind.Swarm:
			return 'Swarm';
		case EntityKind.Task:
			return 'Task';
		case EntityKind.Agent:
			return 'Agent';
		case EntityKind.Review:
			return context.reviewTargetKind === ReviewTargetKind.Merge ? 'Review merge target' : 'Review gate target';
		default:
			return context.entity.kind;
	}
}

function entityAttention(context: IInspectorContext): AttentionLevel | undefined {
	switch (context.entity.kind) {
		case EntityKind.Swarm:
			return context.swarm?.attentionLevel;
		case EntityKind.Task:
			return context.task?.attentionLevel;
		case EntityKind.Agent:
			return context.agent?.attentionLevel;
		case EntityKind.Review:
			return context.reviewTargetKind === ReviewTargetKind.Merge ? context.merge?.attentionLevel : context.gate?.attentionLevel;
		default:
			return undefined;
	}
}

function inspectorTitle(context: IInspectorContext): string {
	if (context.entity.kind === EntityKind.Swarm) {
		return context.swarm?.objectiveProblemStatement ?? context.swarm?.swarmId ?? context.key;
	}
	if (context.entity.kind === EntityKind.Task) {
		return context.task?.summary || context.task?.taskId || context.key;
	}
	if (context.entity.kind === EntityKind.Agent) {
		return context.agent?.roleId ?? context.dispatchId ?? context.key;
	}
	return context.reviewTargetKind === ReviewTargetKind.Merge
		? basename(context.merge?.worktreePath ?? '') || context.merge?.candidateBranch || context.dispatchId || context.key
		: context.gate?.roleId ?? context.dispatchId ?? context.key;
}

function inspectorSubtitle(context: IInspectorContext): string {
	switch (context.entity.kind) {
		case EntityKind.Swarm:
			return `Inspector for rooted swarm ${context.swarm?.rootTaskId ?? context.key}`;
		case EntityKind.Task:
			return `Inspector for task ${context.taskId ?? context.key}`;
		case EntityKind.Agent:
			return `Inspector for dispatch ${context.dispatchId ?? context.key}`;
		case EntityKind.Review:
			return context.reviewTargetKind === ReviewTargetKind.Merge
				? `Inspector for merge target ${context.dispatchId ?? context.key}`
				: `Inspector for review gate ${context.dispatchId ?? context.key}`;
		default:
			return 'Inspector';
	}
}

function formatStateLabel(value: string): string {
	return value.replace(/_/g, ' ');
}

function loadingSection(title: string): IAtlasInspectorSectionBase;
function loadingSection<T extends object>(title: string, extra: T): IAtlasInspectorSectionBase & T;
function loadingSection<T extends object>(title: string, extra?: T): IAtlasInspectorSectionBase | (IAtlasInspectorSectionBase & T) {
	const base: IAtlasInspectorSectionBase = {
		title,
		state: 'loading',
		message: 'Loading…',
	};
	return extra ? { ...base, ...extra } : base;
}

function emptySection(title: string, message: string): IAtlasInspectorSectionBase;
function emptySection<T extends object>(title: string, message: string, extra: T): IAtlasInspectorSectionBase & T;
function emptySection<T extends object>(title: string, message: string, extra?: T): IAtlasInspectorSectionBase | (IAtlasInspectorSectionBase & T) {
	const base: IAtlasInspectorSectionBase = {
		title,
		state: 'empty',
		message,
	};
	return extra ? { ...base, ...extra } : base;
}

function errorSection(title: string, message: string): IAtlasInspectorSectionBase;
function errorSection<T extends object>(title: string, message: string, extra: T): IAtlasInspectorSectionBase & T;
function errorSection<T extends object>(title: string, message: string, extra?: T): IAtlasInspectorSectionBase | (IAtlasInspectorSectionBase & T) {
	const base: IAtlasInspectorSectionBase = {
		title,
		state: 'error',
		message,
	};
	return extra ? { ...base, ...extra } : base;
}

function detail(label: string, value: string, attentionLevel: AttentionLevel | undefined = undefined): IAtlasInspectorDetail {
	return { label, value, attentionLevel };
}

function entityLink(id: string, label: string, target: AtlasModel.ISelectedEntity): IAtlasInspectorLink {
	return { kind: 'entity', id, label, target };
}

function sectionLink(id: string, label: string, section: NavigationSection): IAtlasInspectorLink {
	return { kind: 'section', id, label, section };
}

function compact<T>(values: readonly (T | undefined)[]): readonly T[] {
	return Object.freeze(values.filter((value): value is T => value !== undefined));
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
