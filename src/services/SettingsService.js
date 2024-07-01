import { Service } from "../definitions.js";

import AboutTab from '../UI/Settings/UITabAbout.js';
import UsageTab from '../UI/Settings/UITabUsage.js';
import AccountTab from '../UI/Settings/UITabAccount.js';
import SecurityTab from '../UI/Settings/UITabSecurity.js';
import PersonalizationTab from '../UI/Settings/UITabPersonalization.js';
import LanguageTag from '../UI/Settings/UITabLanguage.js';
import ClockTab from '../UI/Settings/UITabClock.js';

export class SettingsService extends Service {
    #tabs = [];
    async _init () {
        ;[
            AboutTab,
            UsageTab,
            AccountTab,
            SecurityTab,
            PersonalizationTab,
            LanguageTag,
            ClockTab,
        ].forEach(tab => {
            this.register_tab(tab);
        });
    }
    get_tabs () {
        return this.#tabs;
    }
    register_tab (tab) {
        this.#tabs.push(tab);
    }
}
