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
 * Display a list of checkboxes for the user to confirm.
 */
export default def(class ConfirmationsView extends Component {
    static ID = 'ui.component.ConfirmationsView';

    static PROPERTIES = {
        confirmations: {
            description: 'The list of confirmations to display',
        },
        confirmed: {
            description: 'True iff all confirmations are checked',
        },
    };

    static CSS = /*css*/`
        .confirmations {
            display: flex;
            flex-direction: column;
        }
        .looks-good {
            margin-top: 20px;
            color: hsl(220, 25%, 31%);
            font-size: 20px;
            font-weight: 700;
            display: none;
        }
    `;

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="confirmations">
                ${
                    this.get('confirmations').map((confirmation, index) => {
                        return /*html*/`
                            <div>
                                <input type="checkbox" id="confirmation-${index}" name="confirmation-${index}">
                                <label for="confirmation-${index}">${confirmation}</label>
                            </div>
                        `;
                    }).join('')
                }
                <span class="looks-good">${i18n('looks_good')}</span>
            </div>
        `);
    }

    on_ready ({ listen }) {
        // update `confirmed` property when checkboxes are checked
        $(this.dom_).find('input').on('change', () => {
            this.set('confirmed', $(this.dom_).find('input').toArray().every(input => input.checked));
            if ( this.get('confirmed') ) {
                $(this.dom_).find('.looks-good').show();
            } else {
                $(this.dom_).find('.looks-good').hide();
            }
        });
    }
});
