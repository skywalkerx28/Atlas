/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side Phase 10A tests intentionally exercise the sessions navigation/browser profile model directly. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AtlasLayoutProfile } from '../../../../common/model/layout.js';
import { buildAtlasLayoutProfileModel } from '../../browser/atlasLayoutProfileModel.js';

suite('AtlasLayoutProfileModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('builds the shipped Phase 10A layout profile options in deterministic order', () => {
		const model = buildAtlasLayoutProfileModel(AtlasLayoutProfile.Operator);

		assert.strictEqual(model.profile, AtlasLayoutProfile.Operator);
		assert.strictEqual(model.frameClassName, 'atlas-layout-profile-operator');
		assert.deepStrictEqual(
			model.options.map(option => ({ profile: option.profile, selected: option.selected })),
			[
				{ profile: AtlasLayoutProfile.Operator, selected: true },
				{ profile: AtlasLayoutProfile.Execution, selected: false },
				{ profile: AtlasLayoutProfile.Review, selected: false },
				{ profile: AtlasLayoutProfile.Fleet, selected: false },
			],
		);
	});

	test('updates the selected profile without changing the shipped option set', () => {
		const model = buildAtlasLayoutProfileModel(AtlasLayoutProfile.Review);

		assert.strictEqual(model.frameClassName, 'atlas-layout-profile-review');
		assert.deepStrictEqual(model.options.map(option => option.label), ['Operator', 'Execution', 'Review', 'Fleet']);
		assert.strictEqual(model.options.find(option => option.profile === AtlasLayoutProfile.Review)?.selected, true);
		assert.strictEqual(model.options.find(option => option.profile === AtlasLayoutProfile.Operator)?.selected, false);
	});
});
