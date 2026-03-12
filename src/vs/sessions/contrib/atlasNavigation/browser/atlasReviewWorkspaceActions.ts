/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-import-patterns -- Phase 6 review workspace helpers are sessions-only contrib logic wired directly to the sessions harness service. */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { ReviewDecision } from '../../../common/model/wire.js';
import { EntityKind, ReviewTargetKind, type IReviewSelectedEntity } from '../../../common/model/selection.js';
import { HarnessConnectionState, type IHarnessConnectionInfo, type IHarnessService } from '../../../services/harness/common/harnessService.js';
import type { HarnessCapability, HarnessSupportedWriteMethod } from '../../../services/harness/common/harnessTypes.js';

export const enum ReviewWorkspaceActionId {
	RecordGo = 'record-go',
	RecordNoGo = 'record-no-go',
	AuthorizePromotion = 'authorize-promotion',
	EnqueueMerge = 'enqueue-merge',
}

export interface IReviewWorkspaceUiState {
	readonly targetKey: string | undefined;
	readonly pendingAction: ReviewWorkspaceActionId | undefined;
	readonly errorMessage: string | undefined;
}

const EMPTY_UI_STATE: IReviewWorkspaceUiState = {
	targetKey: undefined,
	pendingAction: undefined,
	errorMessage: undefined,
};

const REQUIRED_CAPABILITY_BY_WRITE_METHOD: Readonly<Record<HarnessSupportedWriteMethod, HarnessCapability>> = Object.freeze({
	'control.pause': 'control',
	'control.cancel': 'control',
	'dispatch.submit': 'dispatch',
	'objective.submit': 'dispatch',
	'review.gate_verdict': 'review',
	'review.authorize_promotion': 'merge',
	'review.enqueue_merge': 'merge',
});

export function reviewTargetKey(entity: IReviewSelectedEntity | undefined): string | undefined {
	return entity ? `${entity.reviewTargetKind}:${entity.id}` : undefined;
}

export function unavailableReasonForWriteMethod(
	connection: IHarnessConnectionInfo,
	method: HarnessSupportedWriteMethod,
): string | undefined {
	if (connection.supportedWriteMethods.includes(method)) {
		return undefined;
	}

	if (connection.mode !== 'daemon' || connection.state !== HarnessConnectionState.Connected) {
		return 'Harness daemon required; Atlas is in read-only mode.';
	}

	const requiredCapability = REQUIRED_CAPABILITY_BY_WRITE_METHOD[method];
	if (requiredCapability && !connection.grantedCapabilities.includes(requiredCapability)) {
		return `Current harness daemon does not grant ${requiredCapability} capability for ${method}.`;
	}

	return `Current harness daemon does not expose ${method}.`;
}

export class AtlasReviewWorkspaceActionController extends Disposable {

	private readonly _uiState = observableValue<IReviewWorkspaceUiState>(this, EMPTY_UI_STATE);
	readonly uiState = this._uiState;

	constructor(
		private readonly harnessService: IHarnessService,
	) {
		super();
	}

	setSelection(entity: AtlasModel.ISelectedEntity | undefined): void {
		const target = entity?.kind === EntityKind.Review ? entity : undefined;
		const nextTargetKey = reviewTargetKey(target);
		const current = this._uiState.get();
		if (current.targetKey === nextTargetKey) {
			return;
		}

		this._uiState.set({
			targetKey: nextTargetKey,
			pendingAction: undefined,
			errorMessage: undefined,
		}, undefined, undefined);
	}

	clearError(): void {
		const current = this._uiState.get();
		if (!current.errorMessage) {
			return;
		}
		this._uiState.set({
			...current,
			errorMessage: undefined,
		}, undefined, undefined);
	}

	async runAction(action: ReviewWorkspaceActionId, entity: IReviewSelectedEntity): Promise<boolean> {
		const incompatibleTargetReason = unavailableReasonForActionTarget(action, entity);
		if (incompatibleTargetReason) {
			this._uiState.set({
				targetKey: reviewTargetKey(entity),
				pendingAction: undefined,
				errorMessage: incompatibleTargetReason,
			}, undefined, undefined);
			return false;
		}

		const method = actionMethod(action);
		const connection = this.harnessService.connectionState.get();
		const unsupportedReason = unavailableReasonForWriteMethod(connection, method);
		if (unsupportedReason) {
			this._uiState.set({
				targetKey: reviewTargetKey(entity),
				pendingAction: undefined,
				errorMessage: unsupportedReason,
			}, undefined, undefined);
			return false;
		}

		this._uiState.set({
			targetKey: reviewTargetKey(entity),
			pendingAction: action,
			errorMessage: undefined,
		}, undefined, undefined);

		try {
			switch (action) {
				case ReviewWorkspaceActionId.RecordGo:
					await this.harnessService.recordGateVerdict(entity.id, ReviewDecision.Go, 'axiom-judge');
					break;
				case ReviewWorkspaceActionId.RecordNoGo:
					await this.harnessService.recordGateVerdict(entity.id, ReviewDecision.NoGo, 'axiom-judge');
					break;
				case ReviewWorkspaceActionId.AuthorizePromotion:
					await this.harnessService.authorizePromotion(entity.id, 'axiom-planner');
					break;
				case ReviewWorkspaceActionId.EnqueueMerge:
					await this.harnessService.enqueueForMerge(entity.id);
					break;
			}

			this._uiState.set({
				targetKey: reviewTargetKey(entity),
				pendingAction: undefined,
				errorMessage: undefined,
			}, undefined, undefined);
			return true;
		} catch (error) {
			this._uiState.set({
				targetKey: reviewTargetKey(entity),
				pendingAction: undefined,
				errorMessage: error instanceof Error ? error.message : String(error),
			}, undefined, undefined);
			return false;
		}
	}
}

function actionMethod(action: ReviewWorkspaceActionId): HarnessSupportedWriteMethod {
	switch (action) {
		case ReviewWorkspaceActionId.RecordGo:
		case ReviewWorkspaceActionId.RecordNoGo:
			return 'review.gate_verdict';
		case ReviewWorkspaceActionId.AuthorizePromotion:
			return 'review.authorize_promotion';
		case ReviewWorkspaceActionId.EnqueueMerge:
			return 'review.enqueue_merge';
	}
}

function unavailableReasonForActionTarget(
	action: ReviewWorkspaceActionId,
	entity: IReviewSelectedEntity,
): string | undefined {
	switch (action) {
		case ReviewWorkspaceActionId.RecordGo:
		case ReviewWorkspaceActionId.RecordNoGo:
			return entity.reviewTargetKind === ReviewTargetKind.Gate
				? undefined
				: 'Select a review gate target to record a verdict.';
		case ReviewWorkspaceActionId.AuthorizePromotion:
			return entity.reviewTargetKind === ReviewTargetKind.Gate
				? undefined
				: 'Select a review gate target to authorize promotion.';
		case ReviewWorkspaceActionId.EnqueueMerge:
			return undefined;
	}
}
