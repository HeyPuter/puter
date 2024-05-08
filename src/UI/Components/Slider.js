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
import { Component } from "../../util/Component.js";

/**
 * Slider: A labeled slider input.
 */
export default class Slider extends Component {
    static PROPERTIES = {
        name: { value: null },
        label: { value: null },
        min: { value: 0 },
        max: { value: 100 },
        value: { value: null },
        step: { value: 1 },
        on_change: { value: null },
    };

    static RENDER_MODE = Component.NO_SHADOW;

    static CSS = /*css*/`
        .slider-label {
            color: var(--primary-color);
        }

        .slider-input {
            --webkit-appearance: none;
            width: 100%;
            height: 25px;
            background: #d3d3d3;
            outline: none;
            opacity: 0.7;
            --webkit-transition: .2s;
            transition: opacity .2s;
        }
        
        .slider-input:hover {
            opacity: 1;
        }
        
        .slider-input::-webkit-slider-thumb {
            --webkit-appearance: none;
            appearance: none;
            width: 25px;
            height: 25px;
            background: #04AA6D;
            cursor: pointer;
        }
        
        .slider-input::-moz-range-thumb {
            width: 25px;
            height: 25px;
            background: #04AA6D;
            cursor: pointer;
        }
    `;

    create_template ({ template }) {
        const min = this.get('min');
        const max = this.get('max');
        const value = this.get('value') ?? min;
        const step = this.get('step') ?? 1;
        const label = this.get('label') ?? this.get('name');

        $(template).html(/*html*/`
            <div class="slider">
                <label class="slider-label">${html_encode(label)}</label>
                <input class="slider-input" type="range" min="${min}" max="${max}" value="${value}" step="${step}">
            </div>
        `);
    }

    on_ready ({ listen }) {
        const input = this.dom_.querySelector('.slider-input');

        input.addEventListener('input', e => {
            const on_change = this.get('on_change');
            if (on_change) {
                const name = this.get('name');
                const label = this.get('label') ?? name;
                e.meta = { name, label };
                on_change(e);
            }
        });

        listen('value', value => {
            input.value = value;
        });
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_slider ) {
    window.__component_slider = true;

    customElements.define('c-slider', Slider);
}