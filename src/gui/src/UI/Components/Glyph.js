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

export default def(class Glyph extends Component {
    static ID = 'ui.component.Glyph';

    static PROPERTIES = {
        size: {
            value: 24,
        },
        codepoint: {
            value: '✅',
        },
    }

    static CSS = `
        div {
            text-align: center;
        }
    `;

    create_template ({ template }) {
        template.innerHTML = /*html*/`
            <div style="font-size: ${this.get('size')}px;">
                ${this.get('codepoint')}
            </div>
        `;
    }
});
