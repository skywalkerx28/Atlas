/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';
import { ReviewDecision, WireIntegrationState, WirePromotionState, WireReviewState } from './wire.js';

export interface IAdvisoryReviewEntry {
	readonly taskId: string;
	readonly state: string;
	readonly decision: string;
	readonly score: number;
	readonly confidence: number;
	readonly failedChecks: number;
	readonly risksCount: number;
	readonly touchedSurface: number;
	readonly issueCount: number;
	readonly resultPacketCount: number;
	readonly summary: string;
	readonly updatedAt: number;
}

export interface IReviewGateState {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly roleId: string;
	readonly candidateBranch: string;
	readonly baseRef: string;
	readonly baseHeadSha: string;
	readonly mergeBaseSha: string;
	readonly reviewedHeadSha: string;
	readonly commitShas: readonly string[];
	readonly workingTreeClean: boolean;
	readonly reviewState: WireReviewState;
	readonly judgeDecision: ReviewDecision | undefined;
	readonly reviewedByRole: string | undefined;
	readonly reviewedAt: number | undefined;
	readonly promotionState: WirePromotionState;
	readonly promotionAuthorizedAt: number | undefined;
	readonly promotionAuthorizedByRole: string | undefined;
	readonly integrationState: WireIntegrationState;
	readonly mergedSha: string | undefined;
	readonly mergeExecutorId: string | undefined;
	readonly stateReason: string | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export const enum MergeExecutionStatus {
	Pending = 'pending',
	MergeStarted = 'merge_started',
	Merged = 'merged',
	MergeBlocked = 'merge_blocked',
	Abandoned = 'abandoned',
}

export interface IMergeEntry {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly worktreePath: string;
	readonly candidateBranch: string;
	readonly baseRef: string;
	readonly baseHeadSha: string;
	readonly mergeBaseSha: string;
	readonly reviewedHeadSha: string;
	readonly priority: number;
	readonly status: MergeExecutionStatus;
	readonly mergeSha: string | undefined;
	readonly conflictDetails: string | undefined;
	readonly affectedPaths: readonly string[] | undefined;
	readonly judgeDecision: ReviewDecision | undefined;
	readonly reviewedByRole: string | undefined;
	readonly reviewedAt: number | undefined;
	readonly promotionAuthorizedAt: number | undefined;
	readonly promotionAuthorizedByRole: string | undefined;
	readonly mergeExecutorId: string | undefined;
	readonly mergedAt: number | undefined;
	readonly blockedReason: string | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly enqueuedAt: number;
}

export const enum ReviewPhase {
	PreExecution = 'pre_execution',
	InFlight = 'in_flight',
	PostExecution = 'post_execution',
}

export interface IDiffStats {
	readonly filesChanged: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface ITestResults {
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly coveragePercent: number | undefined;
}
