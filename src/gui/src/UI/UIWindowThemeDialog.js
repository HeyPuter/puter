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
import UIWindow from './UIWindow.js';

const UIWindowThemeDialog = async function UIWindowThemeDialog (options) {
    options = options ?? {};
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    let state = {};

    let h = '';
    h += '<div class="theme-dialog-content" style="display: flex; flex-direction: column; gap: 10pt;">';
        h += `<button class="button button-secondary reset-colors-btn">${i18n('reset_colors')}</button>`;
        h += `<div class="slider-container" style="display: flex; flex-direction: column; gap: 5px;">`;
            h += `<label style="font-weight: 500; color: #5f626d;">${i18n('hue')}</label>`;
            h += `<input type="range" class="theme-slider" id="hue-slider" name="hue" min="0" max="360" value="${svc_theme.get('hue')}" style="width: 100%;">`;
        h += `</div>`;
        h += `<div class="slider-container" style="display: flex; flex-direction: column; gap: 5px;">`;
            h += `<label style="font-weight: 500; color: #5f626d;">${i18n('saturation')}</label>`;
            h += `<input type="range" class="theme-slider" id="sat-slider" name="sat" min="0" max="100" value="${svc_theme.get('sat')}" style="width: 100%;">`;
        h += `</div>`;
        h += `<div class="slider-container" style="display: flex; flex-direction: column; gap: 5px;">`;
            h += `<label style="font-weight: 500; color: #5f626d;">${i18n('lightness')}</label>`;
            h += `<input type="range" class="theme-slider" id="lig-slider" name="lig" min="0" max="100" value="${svc_theme.get('lig')}" style="width: 100%;">`;
        h += `</div>`;
        h += `<div class="slider-container" style="display: flex; flex-direction: column; gap: 5px;">`;
            h += `<label style="font-weight: 500; color: #5f626d;">${i18n('transparency')}</label>`;
            h += `<input type="range" class="theme-slider" id="alpha-slider" name="alpha" min="0" max="1" step="0.01" value="${svc_theme.get('alpha')}" style="width: 100%;">`;
        h += `</div>`;
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
        draggable_body: true,
        allow_context_menu: false,
        show_in_taskbar: false,
        window_class: 'window-alert',
        dominant: true,
        width: 350,
        window_css:{
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
    });

    // Event handlers
    $(el_window).find('.theme-slider').on('input', function(e) {
        const name = $(this).attr('name');
        const value = parseFloat($(this).val());
        state[name] = value;
        if (name === 'lig') {
            state.light_text = value < 60 ? true : false;
        }
        svc_theme.apply(state);
    });

    $(el_window).find('.reset-colors-btn').on('click', function() {
        svc_theme.reset();
        state = {};
        $(el_window).find('#hue-slider').val(svc_theme.get('hue'));
        $(el_window).find('#sat-slider').val(svc_theme.get('sat'));
        $(el_window).find('#lig-slider').val(svc_theme.get('lig'));
        $(el_window).find('#alpha-slider').val(svc_theme.get('alpha'));
    });

    return {};
}

export default UIWindowThemeDialog;
