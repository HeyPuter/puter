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

    let state = {
        hue: svc_theme.get('hue'),
        sat: svc_theme.get('sat'),
        lig: svc_theme.get('lig'),
        alpha: svc_theme.get('alpha'),
        light_text: svc_theme.get('light_text'),
    };

    const h = `
        <div class="theme-dialog-content">
            <div class="theme-presets">
                <button class="theme-preset-btn" data-preset="default">
                    <div class="preset-color" style="background: hsl(211, 51%, 51%);"></div>
                    <span>Default</span>
                </button>
                <button class="theme-preset-btn" data-preset="teal">
                    <div class="preset-color" style="background: hsl(180, 60%, 50%);"></div>
                    <span>Teal</span>
                </button>
                <button class="theme-preset-btn" data-preset="purple">
                    <div class="preset-color" style="background: hsl(270, 60%, 55%);"></div>
                    <span>Purple</span>
                </button>
                <button class="theme-preset-btn" data-preset="forest">
                    <div class="preset-color" style="background: hsl(140, 60%, 50%);"></div>
                    <span>Forest</span>
                </button>
                <button class="theme-preset-btn" data-preset="sunset">
                    <div class="preset-color" style="background: hsl(25, 85%, 60%);"></div>
                    <span>Sunset</span>
                </button>
                <button class="theme-preset-btn" data-preset="rose">
                    <div class="preset-color" style="background: hsl(340, 70%, 60%);"></div>
                    <span>Rose</span>
                </button>
            </div>
            <div class="theme-actions-group">
                <button class="customize-toggle-btn">
                    <span>Customize colors</span>
                    <svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                    </svg>
                </button>
                <button class="button button-secondary reset-colors-btn">${i18n('reset_colors')}</button>
            </div>
            <div class="theme-sliders collapsed">
                <div class="slider-container">
                    <label class="slider-label">
                        <span>${i18n('hue')}</span>
                        <span class="slider-value" id="hue-value">${svc_theme.get('hue')}°</span>
                    </label>
                    <input type="range" class="theme-slider hue-slider" id="hue-slider" name="hue" min="0" max="360" value="${svc_theme.get('hue')}">
                </div>
                <div class="slider-container">
                    <label class="slider-label">
                        <span>${i18n('saturation')}</span>
                        <span class="slider-value" id="sat-value">${svc_theme.get('sat')}%</span>
                    </label>
                    <input type="range" class="theme-slider sat-slider" id="sat-slider" name="sat" min="0" max="100" value="${svc_theme.get('sat')}">
                </div>
                <div class="slider-container">
                    <label class="slider-label">
                        <span>${i18n('lightness')}</span>
                        <span class="slider-value" id="lig-value">${svc_theme.get('lig')}%</span>
                    </label>
                    <input type="range" class="theme-slider lig-slider" id="lig-slider" name="lig" min="0" max="100" value="${svc_theme.get('lig')}">
                </div>
                <div class="slider-container">
                    <label class="slider-label">
                        <span>${i18n('transparency')}</span>
                        <span class="slider-value" id="alpha-value">${Math.round(svc_theme.get('alpha') * 100)}%</span>
                    </label>
                    <input type="range" class="theme-slider alpha-slider" id="alpha-slider" name="alpha" min="0" max="1" step="0.01" value="${svc_theme.get('alpha')}">
                </div>
            </div>
        </div>
    `;

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
        width: 420,
        window_css:{
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '20px',
            'background-color': 'rgb(245 247 249)',
        },
        ...options.window_options,
    });

    // Create a style element for dynamic slider backgrounds
    const styleId = 'theme-slider-dynamic-styles';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }

    // Function to update slider backgrounds based on current state
    const updateSliderBackgrounds = () => {
        const hue = state.hue || 211;
        const sat = state.sat || 51;
        const lig = state.lig || 51;

        // Update saturation slider - from gray to full saturation at current hue
        const satGradient = `linear-gradient(to right, hsl(${hue}, 0%, 50%), hsl(${hue}, 100%, 50%))`;

        // Update lightness slider - from black through current color to white
        const ligGradient = `linear-gradient(to right, hsl(${hue}, ${sat}%, 0%), hsl(${hue}, ${sat}%, 50%), hsl(${hue}, ${sat}%, 100%))`;

        // Update alpha slider - from transparent to current color
        const currentColor = `hsl(${hue}, ${sat}%, ${lig}%)`;
        const alphaGradient = `linear-gradient(to right, transparent, ${currentColor}), repeating-conic-gradient(#e0e0e0 0% 25%, #ffffff 0% 50%) 50% / 12px 12px`;

        // Inject dynamic styles
        styleEl.textContent = `
            .sat-slider::-webkit-slider-runnable-track {
                background: ${satGradient};
            }
            .sat-slider::-moz-range-track {
                background: ${satGradient};
            }
            .lig-slider::-webkit-slider-runnable-track {
                background: ${ligGradient};
            }
            .lig-slider::-moz-range-track {
                background: ${ligGradient};
            }
            .alpha-slider::-webkit-slider-runnable-track {
                background: ${alphaGradient};
            }
            .alpha-slider::-moz-range-track {
                background: ${alphaGradient};
            }
        `;
    };

    // Initialize slider backgrounds
    updateSliderBackgrounds();

    // Theme presets
    const presets = {
        default: { hue: 210, sat: 41.18, lig: 93.33, alpha: 0.8 },
        teal: { hue: 180, sat: 60, lig: 50, alpha: 0.9 },
        purple: { hue: 270, sat: 60, lig: 55, alpha: 0.9 },
        forest: { hue: 140, sat: 60, lig: 50, alpha: 0.9 },
        sunset: { hue: 25, sat: 85, lig: 60, alpha: 0.9 },
        rose: { hue: 340, sat: 70, lig: 60, alpha: 0.9 },
    };

    $(el_window).find('.theme-preset-btn').on('click', function(e) {
        e.preventDefault();
        const presetName = $(this).data('preset');
        const preset = presets[presetName];

        if (!preset) return;

        // Update sliders
        $(el_window).find('#hue-slider').val(preset.hue);
        $(el_window).find('#sat-slider').val(preset.sat);
        $(el_window).find('#lig-slider').val(preset.lig);
        $(el_window).find('#alpha-slider').val(preset.alpha);

        // Update displayed values
        $(el_window).find('#hue-value').text(`${preset.hue}°`);
        $(el_window).find('#sat-value').text(`${preset.sat}%`);
        $(el_window).find('#lig-value').text(`${preset.lig}%`);
        $(el_window).find('#alpha-value').text(`${Math.round(preset.alpha * 100)}%`);

        // Apply theme
        state = {
            hue: preset.hue,
            sat: preset.sat,
            lig: preset.lig,
            alpha: preset.alpha,
            light_text: preset.lig < 70
        };
        svc_theme.apply(state);
        updateSliderBackgrounds();
    });

    // Customize toggle handler
    $(el_window).find('.customize-toggle-btn').on('click', function() {
        const $sliders = $(el_window).find('.theme-sliders');
        const $chevron = $(this).find('.chevron-icon');

        $sliders.toggleClass('collapsed');
        $chevron.toggleClass('rotated');
    });

    $(el_window).find('.theme-slider').on('input', function() {
        const name = $(this).attr('name');
        const value = parseFloat($(this).val());
        state[name] = value;

        if (name === 'lig') {
            state.light_text = value < 70 ? true : false;
        }

        if (name === 'hue') {
            $(el_window).find('#hue-value').text(`${Math.round(value)}°`);
        } else if (name === 'sat') {
            $(el_window).find('#sat-value').text(`${Math.round(value)}%`);
        } else if (name === 'lig') {
            $(el_window).find('#lig-value').text(`${Math.round(value)}%`);
        } else if (name === 'alpha') {
            $(el_window).find('#alpha-value').text(`${Math.round(value * 100)}%`);
        }

        svc_theme.apply(state);
        updateSliderBackgrounds();
    });

    $(el_window).find('.reset-colors-btn').on('click', function() {
        svc_theme.reset();
        state = {
            hue: svc_theme.get('hue'),
            sat: svc_theme.get('sat'),
            lig: svc_theme.get('lig'),
            alpha: svc_theme.get('alpha'),
            light_text: svc_theme.get('light_text'),
        };

        $(el_window).find('#hue-slider').val(state.hue);
        $(el_window).find('#sat-slider').val(state.sat);
        $(el_window).find('#lig-slider').val(state.lig);
        $(el_window).find('#alpha-slider').val(state.alpha);

        $(el_window).find('#hue-value').text(`${state.hue}°`);
        $(el_window).find('#sat-value').text(`${state.sat}%`);
        $(el_window).find('#lig-value').text(`${state.lig}%`);
        $(el_window).find('#alpha-value').text(`${Math.round(state.alpha * 100)}%`);

        updateSliderBackgrounds();
    });

    return {};
}

export default UIWindowThemeDialog;
