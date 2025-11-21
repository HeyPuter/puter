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

export default def(class RecoveryCodesView extends Component {
    static ID = 'ui.component.RecoveryCodesView';

    static PROPERTIES = {
        values: {
            description: 'The recovery codes to display',
        },
    };

    static CSS = /*css*/`
        .recovery-codes {
            display: flex;
            flex-direction: column;
            gap: 10px;
            border: 1px solid #ccc;
            padding: 20px;
            margin: 20px auto;
            width: 90%;
            max-width: 600px;
            background-color: #f9f9f9;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .recovery-codes h2 {
            text-align: center;
            font-size: 18px;
            color: #333;
            margin-bottom: 15px;
        }

        .recovery-codes-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: 10px; /* Adds space between grid items */
            padding: 0;
        }

        .recovery-code {
            background-color: #fff;
            border: 1px solid #ddd;
            padding: 10px;
            text-align: center;
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            letter-spacing: 1px;
        }

        .actions {
            flex-direction: row-reverse;
            display: flex;
            gap: 10px;
        }
    `;

    create_template ({ template }) {
        $(template).html(`
            <iframe name="print_frame" width="0" height="0" frameborder="0" src="about:blank"></iframe>
            <div class="recovery-codes">
                <div class="recovery-codes-list">
                </div>
                <div class="actions">
                    <button class="button" data-action="copy">${i18n('copy')}</button>
                    <button class="button" data-action="print">${i18n('print')}</button>
                </div>
            </div>
        `);
    }

    on_ready ({ listen }) {
        listen('values', values => {
            for ( const value of values ) {
                $(this.dom_).find('.recovery-codes-list').append(`
                    <div class="recovery-code">${html_encode(value)}</div>
                `);
            }
        });

        $(this.dom_).find('[data-action="copy"]').on('click', () => {
            const codes = this.get('values').join('\n');
            navigator.clipboard.writeText(codes);
        });

        $(this.dom_).find('[data-action="print"]').on('click', () => {
            const target = $(this.dom_).find('.recovery-codes-list')[0];
            const print_frame = $(this.dom_).find('iframe[name="print_frame"]')[0];
            print_frame.contentWindow.document.body.innerHTML = target.outerHTML;
            print_frame.contentWindow.window.focus();
            print_frame.contentWindow.window.print();
        });
    }
});
