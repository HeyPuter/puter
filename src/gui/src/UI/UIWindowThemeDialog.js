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
import UIComponentWindow from './UIComponentWindow.js';
import Flexer from './Components/Flexer.js';
import Slider from './Components/Slider.js';

const UIWindowThemeDialog = async function UIWindowThemeDialog (options) {
    options = options ?? {};
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    let state = {};

    const slider_ch = (e) => {
        state[e.meta.name] = e.target.value;
        if (e.meta.name === 'lig') {
            state.light_text = e.target.value < 60 ? true : false;
        }
        svc_theme.apply(state);
    };

    const hue_slider = new Slider({
        label: i18n('hue'),
        name: 'hue', min: 0, max: 360,
        value: svc_theme.get('hue'),
        on_change: slider_ch,
    });
    const sat_slider = new Slider({
        label: i18n('saturation'),
        name: 'sat', min: 0, max: 100,
        value: svc_theme.get('sat'),
        on_change: slider_ch,
    });
    const lig_slider = new Slider({
        label: i18n('lightness'),
        name: 'lig', min: 0, max: 100,
        value: svc_theme.get('lig'),
        on_change: slider_ch,
    });
    const alpha_slider = new Slider({
        label: i18n('transparency'),
        name: 'alpha', min: 0, max: 1, step: 0.01,
        value: svc_theme.get('alpha'),
        on_change: slider_ch,
    });

    const resetButton = $(`<button class="button button-secondary">${i18n('reset_colors')}</button>`);
    resetButton.on('click', () => {
        svc_theme.reset();
        state = {};
        hue_slider.set('value', svc_theme.get('hue'));
        sat_slider.set('value', svc_theme.get('sat'));
        lig_slider.set('value', svc_theme.get('lig'));
        alpha_slider.set('value', svc_theme.get('alpha'));
    });
    
    const component = new Flexer({
        children: [
            { dom: resetButton[0] },
            hue_slider,
            sat_slider,
            lig_slider,
            alpha_slider,
        ],
        gap: '10pt',
    });

    const w = await UIComponentWindow({
        title: i18n('ui_colors'),
        component,
        icon: null,
        uid: null,
        is_dir: false,
        message: 'message',
        // body_icon: options.body_icon,
        // backdrop: options.backdrop ?? false,
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
        body_content: '',
        width: 350,
        // parent_uuid: options.parent_uuid,
        // ...options.window_options,
        window_css:{
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '20px',
            // 'background-color': `hsla(
            //     var(--primary-hue),
            //     calc(max(var(--primary-saturation) - 15%, 0%)),
            //     calc(min(100%,var(--primary-lightness) + 20%)), .91)`,
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'blur(3px)',
            
        },
        ...options.window_options,
    });

    return {};
}

export default UIWindowThemeDialog;
