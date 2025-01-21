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
 * A table with a sticky header
 */
export default def(class Table extends Component {
    static ID = 'ui.component.Table';

    static PROPERTIES = {
        headings: { value: [] },
        scale: { value: '2pt' },
        rows: { value: [] },
    }

    static CSS = /*css*/`
        table {
            box-sizing: border-box;
            border-collapse: collapse;
            width: 100%;
        }
        
        thead th {
            box-shadow: 0 1px 4px -2px rgba(0,0,0,0.2);
            backdrop-filter: blur(2px);
            position: sticky;
            z-index: 100;
            padding:
                calc(10 * var(--scale))
                calc(2.5 * var(--scale))
                calc(5 * var(--scale))
                calc(2.5 * var(--scale));
            top: 0;
            background-color: hsla(0, 0%, 100%, 0.8);
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }
        
        thead th:not(:last-of-type) {
            /* we set borders on this span because */
            /* borders fly away from sticky headers */
            border-right: 1px solid #e0e0e0;
        }
        
        tbody > * {
            border-bottom: 1px solid #e0e0e0;
            padding: 0 calc(2.5 * var(--scale));
            vertical-align: middle;
        }
    `;

    create_template ({ template }) {
        $(template).html(`
            <table>
                <thead>
                    <tr class="headings"></tr>
                </thead>
                <tbody>
                    <slot name="rows"></slot>
                </tbody>      
            </table>
        `);
    }

    on_ready ({ listen }) {
        listen('headings', headings => {
            $(this.dom_).find('.headings')
                .html(headings.map(heading => `<th><span>${heading}</span></th>`).join(''))
        });

        listen('scale', scale => {
            $(this.dom_).css('--scale', scale);
        });

        listen('rows', rows => {
            const tbody = $(this.dom_).find('tbody')[0];
            $(tbody).find('[slot=rows]').detach();
            for (const row of rows) {
                row.setAttribute('slot', 'rows');
                row.attach(tbody);
            }
        });
    }
});
