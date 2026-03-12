/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum AtlasLayoutProfile {
	Operator = 'operator',
	Execution = 'execution',
	Review = 'review',
	Fleet = 'fleet',
}

export const ATLAS_LAYOUT_PROFILE_VALUES = Object.freeze([
	AtlasLayoutProfile.Operator,
	AtlasLayoutProfile.Execution,
	AtlasLayoutProfile.Review,
	AtlasLayoutProfile.Fleet,
]);

export function isAtlasLayoutProfile(value: string | undefined): value is AtlasLayoutProfile {
	return typeof value === 'string' && ATLAS_LAYOUT_PROFILE_VALUES.includes(value as AtlasLayoutProfile);
}
