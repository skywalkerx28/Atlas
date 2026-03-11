/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mixin } from '../../../base/common/objects.js';
import { ITelemetryAppender, validateTelemetryData } from './telemetryUtils.js';

export interface ITelemetryItem {
	name: string;
	baseData?: {
		name: string;
		properties?: Record<string, string>;
		measurements?: Record<string, number>;
	};
}

export interface ITelemetryUnloadState {
	readonly reason?: string;
}

// Minimal client contract used by the rest of the telemetry stack and by tests.
export interface IAppInsightsCore {
	pluginVersionString: string;
	track(item: ITelemetryItem): void;
	unload(isAsync: boolean, unloadComplete: (unloadState: ITelemetryUnloadState) => void): void;
}

class NullAppInsightsCore implements IAppInsightsCore {
	pluginVersionString = 'atlas';

	track(_item: ITelemetryItem): void { }

	unload(_isAsync: boolean, unloadComplete: (unloadState: ITelemetryUnloadState) => void): void {
		unloadComplete({});
	}
}

async function getClient(_instrumentationKey: string): Promise<IAppInsightsCore> {
	return new NullAppInsightsCore();
}

// TODO @lramos15 maybe make more in line with src/vs/platform/telemetry/browser/appInsightsAppender.ts with caching support
export abstract class AbstractOneDataSystemAppender implements ITelemetryAppender {

	protected _aiCoreOrKey: IAppInsightsCore | string | undefined;
	private _asyncAiCore: Promise<IAppInsightsCore> | null;
	protected readonly endPointUrl = '';
	protected readonly endPointHealthUrl = '';

	constructor(
		_isInternalTelemetry: boolean,
		private _eventPrefix: string,
		private _defaultData: { [key: string]: unknown } | null,
		iKeyOrClientFactory: string | (() => IAppInsightsCore), // allow factory function for testing
	) {
		if (!this._defaultData) {
			this._defaultData = {};
		}

		if (typeof iKeyOrClientFactory === 'function') {
			this._aiCoreOrKey = iKeyOrClientFactory();
		} else {
			this._aiCoreOrKey = iKeyOrClientFactory;
		}
		this._asyncAiCore = null;
	}

	private _withAIClient(callback: (aiCore: IAppInsightsCore) => void): void {
		if (!this._aiCoreOrKey) {
			return;
		}

		if (typeof this._aiCoreOrKey !== 'string') {
			callback(this._aiCoreOrKey);
			return;
		}

		if (!this._asyncAiCore) {
			this._asyncAiCore = getClient(this._aiCoreOrKey);
		}

		this._asyncAiCore.then(
			(aiClient) => {
				callback(aiClient);
			},
			() => { }
		);
	}

	log(eventName: string, data?: unknown): void {
		if (!this._aiCoreOrKey) {
			return;
		}
		data = mixin(data, this._defaultData);
		const validatedData = validateTelemetryData(data);
		const name = this._eventPrefix + '/' + eventName;

		try {
			this._withAIClient((aiClient) => {
				aiClient.pluginVersionString = validatedData?.properties.version ?? 'Unknown';
				aiClient.track({
					name,
					baseData: { name, properties: validatedData?.properties, measurements: validatedData?.measurements }
				});
			});
		} catch { }
	}

	flush(): Promise<void> {
		if (this._aiCoreOrKey) {
			return new Promise(resolve => {
				this._withAIClient((aiClient) => {
					aiClient.unload(true, () => {
						this._aiCoreOrKey = undefined;
						resolve(undefined);
					});
				});
			});
		}
		return Promise.resolve(undefined);
	}
}
