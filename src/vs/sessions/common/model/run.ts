/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';
import { ActivityEventKind, HandoffType } from './wire.js';

export interface IRunDiffStat {
	readonly linesAdded: number;
	readonly linesRemoved: number;
}

export interface IToolCall {
	readonly tool: string;
	readonly summary: string;
	readonly startedAt: number;
	readonly completedAt: number | undefined;
	readonly durationMs: number | undefined;
	readonly exitCode: number | undefined;
	readonly payload: unknown;
}

export interface ITranscriptEntry {
	readonly timestamp: number;
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly roleId: string;
	readonly handoffType: HandoffType | undefined;
	readonly kind: ActivityEventKind;
	readonly summary: string;
	readonly tool: string | undefined;
	readonly filePath: string | undefined;
	readonly diffStat: IRunDiffStat | undefined;
	readonly command: string | undefined;
	readonly exitCode: number | undefined;
	readonly durationMs: number | undefined;
	readonly raw: unknown;
	readonly payload: unknown;
}

export interface IRunState {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly roleId: string;
	readonly handoffType: HandoffType | undefined;
	readonly startedAt: number;
	readonly endedAt: number | undefined;
	readonly durationMs: number | undefined;
	// Derived from token/resource accounting; not a transcript field.
	readonly costSpent: number;
	readonly transcript: readonly ITranscriptEntry[];
	readonly toolCalls: readonly IToolCall[];
	readonly attentionLevel: AttentionLevel;
}
