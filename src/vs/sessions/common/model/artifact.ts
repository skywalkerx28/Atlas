/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttentionLevel } from './attention.js';

export const enum ArtifactKind {
	ObjectiveSpec = 'objective_spec',
	TaskPacket = 'task_packet',
	ResultPacket = 'result_packet',
	WorkspaceEvent = 'workspace_event',
	ReviewEvidence = 'review_evidence',
	CommitEvidence = 'commit_evidence',
	ArtifactBundle = 'artifact_bundle',
	MemoryRecord = 'memory_record',
	Log = 'log',
	Other = 'other',
}

export interface IArtifactRef {
	readonly artifactPath: string;
	readonly kind: ArtifactKind;
	readonly taskId: string | undefined;
	readonly dispatchId: string | undefined;
	readonly objectiveId: string | undefined;
	readonly summary: string | undefined;
	readonly createdAt: number | undefined;
	readonly attentionLevel: AttentionLevel;
}
