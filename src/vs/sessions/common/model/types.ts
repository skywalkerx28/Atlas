/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from './wire.js';
export * from './selection.js';
export * from './attention.js';
export * from './objective.js';
export * from './swarm.js';
export * from './task.js';
export * from './agent.js';
export * from './worktree.js';
export * from './run.js';
export * from './artifact.js';
export * from './review.js';
export * from './policy.js';
export * from './cost.js';
export * from './health.js';

// Sessions service common files cannot import from vs/sessions/common/* directly under the
// current layer rules. Expose the ratified Atlas model as a type-only global namespace so the
// service contracts can depend on the canonical model without introducing a runtime edge.
declare global {
	namespace AtlasModel {
		type EntityKind = import('./selection.js').EntityKind;
		type ISelectedEntity = import('./selection.js').ISelectedEntity;

		type IAgentState = import('./agent.js').IAgentState;
		type IFleetState = import('./agent.js').IFleetState;

		type ICostState = import('./cost.js').ICostState;
		type IHealthState = import('./health.js').IHealthState;

		type IObjectiveState = import('./objective.js').IObjectiveState;
		type IObjectiveSubmitOptions = import('./objective.js').IObjectiveSubmitOptions;

		type ISwarmState = import('./swarm.js').ISwarmState;
		type ITaskState = import('./task.js').ITaskState;
		type ITranscriptEntry = import('./run.js').ITranscriptEntry;
		type IWorktreeState = import('./worktree.js').IWorktreeState;

		type IAdvisoryReviewEntry = import('./review.js').IAdvisoryReviewEntry;
		type IReviewGateState = import('./review.js').IReviewGateState;
		type IMergeEntry = import('./review.js').IMergeEntry;

		type ReviewDecision = import('./wire.js').ReviewDecision;
		type IWireDispatchCommand = import('./wire.js').IWireDispatchCommand;
		type IWireMemoryRecord = import('./wire.js').IWireMemoryRecord;
		type IWireResultPacket = import('./wire.js').IWireResultPacket;
		type IWireTaskPacket = import('./wire.js').IWireTaskPacket;
	}
}
