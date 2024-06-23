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
                    <button class="button change-background" style="float:right;">${i18n('change_desktop_background')}</button>
                </div>
            </div>
            <div class="settings-card">
                <strong>${i18n('ui_colors')}</strong>
                <div style="flex-grow:1;">
                    <button class="button change-ui-colors" style="float:right;">${i18n('change_ui_colors')}</button>
                </div>
            </div>
            <div class="settings-card" style="display: block; height: auto;">
                <strong>${i18n('menubar_style')}</strong>
                <div style="flex-grow:1;">
                    <div>
                        <input type="radio" name="menubar_style" class="menubar_style" value="system" id="menubar_style_system">
                        <label style="display:inline;" for="menubar_style_system">${i18n('menubar_style_system')}</label>
                    </div>

                    <div>
                        <input type="radio" name="menubar_style" class="menubar_style" value="desktop" id="menubar_style_desktop">
                        <label style="display:inline;" for="menubar_style_desktop">${i18n('menubar_style_desktop')}</label>
                    </div>

                    <div>
                        <input type="radio" name="menubar_style" class="menubar_style" value="window" id="menubar_style_window">
                        <label style="display:inline;" for="menubar_style_window">${i18n('menubar_style_window')}</label>
                    </div>
                </div>
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

        if(window.menubar_style === 'system' || !window.menubar_style){
            $el_window.find('#menubar_style_system').prop('checked', true);
        }else if(window.menubar_style === 'desktop'){
            $el_window.find('#menubar_style_desktop').prop('checked', true);
        }
        else if(window.menubar_style === 'window'){
            $el_window.find('#menubar_style_window').prop('checked', true);
        }

        $el_window.find('.menubar_style').on('change', function (e) {
            const value = $(this).val();
            if(value === 'system' || value === 'desktop' || value === 'window'){
                // apply the new style
                if(value === 'desktop')
                    $('body').addClass('menubar-style-desktop');
                else
                    $('body').removeClass('menubar-style-desktop');
                puter.kv.set('menubar_style', value);
                window.menubar_style = value;
            }else{
                console.error('Invalid menubar style value');
            }
        })
    },
};
