/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

// About
export default {
    id: 'clock',
    title_i18n_key: 'clock',
    icon: 'clock.svg',
    html: () => {
        return `
            <h1>${i18n('clock')}</h1>
            <div style="display: flex;align-items: center">
                <span>${i18n('visibility')}:</span>
                <select class="change-clock-visible" style="margin-left: 10px;flex: 1">
                    <option value="auto">${i18n('clock_visible_auto')}</option>
                    <option value="hide">${i18n('clock_visible_hide')}</option>
                    <option value="show">${i18n('clock_visible_show')}</option>
                </select>
            </div>`;
    },
    init: ($el_window) => {
        $el_window.on('change', 'select.change-clock-visible', function(e){
            window.change_clock_visible(this.value);
        });

        window.change_clock_visible();
    },
};
