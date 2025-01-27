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


const Component = use('util.Component');

/**
 * Allows a flex layout of composed components to be
 * treated as a component.
 */
export default def(class Flexer extends Component {
    static ID = 'ui.component.Flexer';

    static PROPERTIES = {
        children: {},
        gap: { value: '20pt' },
    }

    static CSS = `
        :host > div {
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
    `;

    create_template ({ template }) {
        // TODO: The way we handle loading assets doesn't work well
        // with web components, so for now it goes in the template.
        $(template).html(`
            <div><slot name="inside"></slot></div>
        `);
    }

    on_ready ({ listen }) {
        for ( const child of this.get('children') ) {
            child.setAttribute('slot', 'inside');
            child.attach(this);
        }

        listen('gap', gap => {
            $(this.dom_).find('div').first().css('gap', gap);
        });
    }
});
