/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IAssignmentService } from '../../../../platform/assignment/common/assignment.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export interface IAssignmentFilter {
	exclude(assignment: string): boolean;
	onDidChange: Event<void>;
}

export const IWorkbenchAssignmentService = createDecorator<IWorkbenchAssignmentService>('assignmentService');

export interface IWorkbenchAssignmentService extends IAssignmentService {
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
}

export class WorkbenchAssignmentService extends Disposable implements IWorkbenchAssignmentService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidRefetchAssignments = this._register(new Emitter<void>());
	public readonly onDidRefetchAssignments = this._onDidRefetchAssignments.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('experiments.override')) {
				this._onDidRefetchAssignments.fire();
			}
		}));
	}

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		return this.configurationService.getValue<T>(`experiments.override.${name}`);
	}

	async getCurrentExperiments(): Promise<string[] | undefined> {
		const overrides = this.configurationService.getValue<Record<string, unknown>>('experiments.override');
		if (!overrides || typeof overrides !== 'object') {
			return [];
		}

		return Object.keys(overrides);
	}

	addTelemetryAssignmentFilter(_filter: IAssignmentFilter): void { }
}

registerSingleton(IWorkbenchAssignmentService, WorkbenchAssignmentService, InstantiationType.Delayed);

const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
registry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.enableExperiments': {
			'type': 'boolean',
			'description': localize('workbench.enableExperiments', "Reserved for compatibility. Atlas does not fetch remote experiment assignments."),
			'default': false,
			'scope': ConfigurationScope.APPLICATION,
			'restricted': true
		}
	}
});
