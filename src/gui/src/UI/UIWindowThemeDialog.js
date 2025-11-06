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
import { UIColorPickerWidget, hslaToHex8 } from './UIColorPickerWidget.js';
import UIWindow from './UIWindow.js';

const UIWindowThemeDialog = async function UIWindowThemeDialog (options) {
    options = options ?? {};
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    // Get current theme values and convert to hex8 for the color picker
    const currentHue = svc_theme.get('hue');
    const currentSat = svc_theme.get('sat');
    const currentLig = svc_theme.get('lig');
    const currentAlpha = svc_theme.get('alpha');
    const initialColor = hslaToHex8(currentHue, currentSat, currentLig, currentAlpha);

    let h = '';
    h += '<div class="theme-dialog-content" style="display: flex; flex-direction: column; gap: 10pt;">';
    h += `<button class="button button-secondary reset-colors-btn">${i18n('reset_colors')}</button>`;
    h += '<div class="color-picker-container" style="padding: 0; margin-bottom: 10px;">';
    h += '<div class="picker"></div>';
    h += '</div>';
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('ui_colors'),
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        is_resizable: false,
        is_droppable: false,
        has_head: true,
        stay_on_top: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        show_in_taskbar: false,
        window_class: 'window-alert',
        dominant: true,
        width: 350,
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '20px',
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,
        onAppend: function(window) {
            // Initialize the color picker widget
            const colorPickerWidget = UIColorPickerWidget($(window).find('.picker'), {
                default: initialColor,
                onColorChange: (color) => {
                    // Convert color to HSLA format for theme service
                    const hsla = colorPickerWidget.getHSLA();
                    const state = {
                        hue: hsla.h,
                        sat: hsla.s,
                        lig: hsla.l,
                        alpha: hsla.a,
                        light_text: hsla.l < 60 ? true : false,
                    };
                    svc_theme.apply(state);
                },
            });

            // Store widget reference on window for reset functionality
            $(window).data('colorPickerWidget', colorPickerWidget);
        },
    });

    // Reset button handler
    $(el_window).find('.reset-colors-btn').on('click', function () {
        svc_theme.reset();
        // Update color picker to reflect reset values
        const colorPickerWidget = $(el_window).data('colorPickerWidget');
        if (colorPickerWidget) {
            const resetHue = svc_theme.get('hue');
            const resetSat = svc_theme.get('sat');
            const resetLig = svc_theme.get('lig');
            const resetAlpha = svc_theme.get('alpha');
            const resetColor = hslaToHex8(resetHue, resetSat, resetLig, resetAlpha);
            colorPickerWidget.setColor(resetColor);
        }
    });

    return {};
};

export default UIWindowThemeDialog;
