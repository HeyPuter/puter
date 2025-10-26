/**
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

import UIWindowThemeDialog from '../UIWindowThemeDialog.js';
import UIWindowDesktopBGSettings from '../UIWindowDesktopBGSettings.js';
import build_settings_card from './helpers/build_settings_card.js';

export default {
    id: 'personalization',
    title_i18n_key: 'personalization',
    icon: 'palette-outline.svg',
    html: () => {
        return `
            <h1 class="settings-section-header">${i18n('personalization')}</h1>
            ${build_settings_card({
                label: i18n('background'),
                control: `<button class="button change-background" aria-label="${i18n('change')} ${i18n('background')}">${i18n('change')}</button>`,
            })}
            ${build_settings_card({
                label: i18n('ui_colors'),
                control: `<button class="button change-ui-colors" aria-label="${i18n('change')} ${i18n('ui_colors')}">${i18n('change')}</button>`,
            })}
            ${build_settings_card({
                label: i18n('clock_visibility'),
                control: `
                    <select class="change-clock-visible">
                        <option value="auto">${i18n('option_auto')}</option>
                        <option value="hide">${i18n('option_hide')}</option>
                        <option value="show">${i18n('option_show')}</option>
                    </select>
                `,
            })}
        `;
    },
    init: ($el_window) => {
        $el_window.find('.change-ui-colors').on('click', function(e) {
            UIWindowThemeDialog({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.change-background').on('click', function(e) {
            UIWindowDesktopBGSettings({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });

        $el_window.on('change', 'select.change-clock-visible', function(e){
            window.change_clock_visible(this.value);
        });

        // Set initial select value
        const currentClockSetting = window.user_preferences?.clock_visible || 'auto';
        $el_window.find('select.change-clock-visible').val(currentClockSetting);

        window.change_clock_visible();
    },
};
