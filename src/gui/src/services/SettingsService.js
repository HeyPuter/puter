/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import { Service } from "../definitions.js";

import AboutTab from '../UI/Settings/UITabAbout.js';
import UsageTab from '../UI/Settings/UITabUsage.js';
import AccountTab from '../UI/Settings/UITabAccount.js';
import SecurityTab from '../UI/Settings/UITabSecurity.js';
import PersonalizationTab from '../UI/Settings/UITabPersonalization.js';
import LanguageTag from '../UI/Settings/UITabLanguage.js';
import UIElement from "../UI/UIElement.js";
const TSettingsTab = use('ui.traits.TSettingsTab');

export class SettingsService extends Service {
    #tabs = [];
    async _init () {
        ;[
            UsageTab,
            AccountTab,
            SecurityTab,
            PersonalizationTab,
            LanguageTag,
            AboutTab,
        ].forEach(tab => {
            this.register_tab(tab);
        });
    }
    get_tabs () {
        return this.#tabs;
    }
    register_tab (tab) {
        if ( tab instanceof UIElement ) {
            const ui_element = tab;
            tab = {
                ...ui_element.as(TSettingsTab).get_metadata(),
                reinitialize () {
                    ui_element.reinitialize();
                },
                get dom () {
                    return ui_element.root;
                },
            };
        }
        this.#tabs.push(tab);
    }
}
