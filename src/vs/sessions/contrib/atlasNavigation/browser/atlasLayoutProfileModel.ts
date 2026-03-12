/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { AtlasLayoutProfile } from '../../../common/model/layout.js';

export interface IAtlasLayoutProfileOption {
	readonly profile: AtlasModel.AtlasLayoutProfile;
	readonly label: string;
	readonly description: string;
	readonly selected: boolean;
}

export interface IAtlasLayoutProfileModel {
	readonly profile: AtlasModel.AtlasLayoutProfile;
	readonly frameClassName: string;
	readonly options: readonly IAtlasLayoutProfileOption[];
}

interface IAtlasLayoutProfileDescriptor {
	readonly profile: AtlasModel.AtlasLayoutProfile;
	readonly label: string;
	readonly description: string;
}

const PROFILE_DESCRIPTORS: readonly IAtlasLayoutProfileDescriptor[] = Object.freeze([
	{
		profile: AtlasLayoutProfile.Operator,
		label: localize2('atlasLayoutProfile.operator', 'Operator').value,
		description: localize2('atlasLayoutProfile.operatorDescription', 'Balanced supervision with navigation, center stage, and inspector visible.').value,
	},
	{
		profile: AtlasLayoutProfile.Execution,
		label: localize2('atlasLayoutProfile.execution', 'Execution').value,
		description: localize2('atlasLayoutProfile.executionDescription', 'Emphasize task and agent execution detail without discarding inspector context.').value,
	},
	{
		profile: AtlasLayoutProfile.Review,
		label: localize2('atlasLayoutProfile.review', 'Review').value,
		description: localize2('atlasLayoutProfile.reviewDescription', 'Bias the shell toward review workspaces and supporting inspector evidence.').value,
	},
	{
		profile: AtlasLayoutProfile.Fleet,
		label: localize2('atlasLayoutProfile.fleet', 'Fleet').value,
		description: localize2('atlasLayoutProfile.fleetDescription', 'Bias the shell toward fleet scanning and operational overview.').value,
	},
]);

export function buildAtlasLayoutProfileModel(profile: AtlasModel.AtlasLayoutProfile): IAtlasLayoutProfileModel {
	return {
		profile,
		frameClassName: `atlas-layout-profile-${profile}`,
		options: Object.freeze(PROFILE_DESCRIPTORS.map(descriptor => ({
			profile: descriptor.profile,
			label: descriptor.label,
			description: descriptor.description,
			selected: descriptor.profile === profile,
		}))),
	};
}
