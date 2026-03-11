/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { DisablementReason, IUpdateService, State } from '../common/update.js';

export class DisabledUpdateService extends Disposable implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	private readonly _onStateChange = this._register(new Emitter<State>());
	readonly onStateChange = this._onStateChange.event;
	readonly state = State.Disabled(DisablementReason.ManuallyDisabled);

	async checkForUpdates(_explicit: boolean): Promise<void> { }

	async downloadUpdate(_explicit: boolean): Promise<void> { }

	async applyUpdate(): Promise<void> { }

	async quitAndInstall(): Promise<void> { }

	async isLatestVersion(): Promise<boolean | undefined> {
		return undefined;
	}

	async _applySpecificUpdate(_packagePath: string): Promise<void> { }

	async setInternalOrg(_internalOrg: string | undefined): Promise<void> { }
}
