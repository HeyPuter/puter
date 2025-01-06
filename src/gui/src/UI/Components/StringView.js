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
 * A simple component that displays a string in the
 * specified style.
 */
export default def(class StringView extends Component {
    static ID = 'ui.component.StringView';

    static PROPERTIES = {
        text: { value: '' },
        heading: { value: 0 },
        no_html_encode: { value: false },
    }

    static CSS = /*css*/`
        h2 {
            margin: 0;
            color: hsl(220, 25%, 31%);
        }
        span {
            color: #3b4863;
        }
    `;

    create_template ({ template }) {
        $(template).html(`<span></span>`);
    }

    on_ready ({ listen }) {
        // TODO: listener composition, to avoid this
        const either = ({ heading, text }) => {
            const wrapper_nodeName = heading ? 'h' + heading : 'span';
            $(this.dom_).find('span').html(`<${wrapper_nodeName}>${
                this.get('no_html_encode') ? text : html_encode(text)
            }</${wrapper_nodeName}>`);
        };
        listen('heading', heading => {
            either({ heading, text: this.get('text') });
        });
        listen('text', text => {
            either({ heading: this.get('heading'), text });
        });
    }
});
