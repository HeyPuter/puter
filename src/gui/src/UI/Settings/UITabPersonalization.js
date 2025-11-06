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

// About
export default {
    id: 'personalization',
    title_i18n_key: 'personalization',
    icon: 'palette-outline.svg',
    html: () => {
        return `
            <h1>${i18n('personalization')}</h1>
            <div class="settings-card">
                <strong>${i18n('background')}</strong>
                <div style="flex-grow:1;">
                    <button class="button change-background" style="float:right;">${i18n('change')}</button>
                </div>
            </div>
            <div class="settings-card">
                <strong>${i18n('ui_colors')}</strong>
                <div style="flex-grow:1;">
                    <button class="button change-ui-colors" style="float:right;">${i18n('change')}</button>
                </div>
            </div>
            <div class="settings-card">
                <strong style="flex-grow:1;">${i18n('clock_visibility')}</strong>
                <select class="change-clock-visible" style="margin-left: 10px; max-width: 300px;">
                    <option value="auto">${i18n('clock_visible_auto')}</option>
                    <option value="hide">${i18n('clock_visible_hide')}</option>
                    <option value="show">${i18n('clock_visible_show')}</option>
                </select>
            </div>
            `;
    },
    init: ($el_window) => {
        $el_window.find('.change-ui-colors').on('click', function (e) {
            UIWindowThemeDialog({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });
        $el_window.find('.change-background').on('click', function (e) {
            UIWindowDesktopBGSettings({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.on('change', 'select.change-clock-visible', function(e){
            window.change_clock_visible(this.value);
        });

        window.change_clock_visible();
    },
};
