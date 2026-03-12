/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';
import { AtlasLayoutProfile } from './model/layout.js';
import { NavigationSection } from './model/selection.js';

//#region < --- Chat Bar --- >

export const ActiveChatBarContext = new RawContextKey<string>('activeChatBar', '', localize('activeChatBar', "The identifier of the active chat bar panel"));
export const ChatBarFocusContext = new RawContextKey<boolean>('chatBarFocus', false, localize('chatBarFocus', "Whether the chat bar has keyboard focus"));
export const ChatBarVisibleContext = new RawContextKey<boolean>('chatBarVisible', false, localize('chatBarVisible', "Whether the chat bar is visible"));

//#endregion

//#region < --- Welcome --- >

export const SessionsWelcomeVisibleContext = new RawContextKey<boolean>('sessionsWelcomeVisible', false, localize('sessionsWelcomeVisible', "Whether the sessions welcome overlay is visible"));

//#endregion

//#region < --- Atlas Navigation --- >

export const AtlasSelectedEntityKindContext = new RawContextKey<string>('atlas.selectedEntityKind', '', localize('atlasSelectedEntityKind', "The selected Atlas entity kind in the sessions window"));
export const AtlasSelectedSectionContext = new RawContextKey<string>('atlas.selectedSection', NavigationSection.Tasks, localize('atlasSelectedSection', "The selected Atlas navigation section in the sessions window"));
export const AtlasLayoutProfileContext = new RawContextKey<string>('atlas.layoutProfile', AtlasLayoutProfile.Operator, localize('atlasLayoutProfile', "The selected Atlas layout profile in the sessions window"));

//#endregion
