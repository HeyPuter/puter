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


const Component = use('util.Component');

export default def(class ActionCard extends Component {
    static ID = 'ui.component.ActionCard';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        title: {
            value: 'Title'
        },
        info: {},
        button_text: {},
        button_style: {},
        on_click: {},
        style: {},
    }

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="settings-card ${ this.get('style') ? this.get('style') : '' }">
                <div>
                    <strong style="display: block">${ this.get('title') }</strong>
                    <span style="display: block margin-top: 5px">${
                        this.get('info')
                    }</span>
                </div>
                <div style="flex-grow: 1">
                    <button class="button ${ this.get('button_style') }" style="float: right;">${
                        this.get('button_text')
                    }</button>
                </div>
            </div>
        `);
    }

    on_ready ({ listen }) {
        $(this.dom_).find('button').on('click', this.get('on_click') || (() => {}));
    }
});
