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
import UIComponentWindow from "../UIComponentWindow.js";

export default def(class QRCodeView extends Component {
    static ID = 'ui.component.QRCodeView';

    static PROPERTIES = {
        value: {
            description: 'The text to encode in the QR code',
        },
        size: {
            value: 150,
        },
        enlarge_option: {
            value: true,
        }
    }

    static CSS = /*css*/`
        .qr-code {
            width: 100%;
            display: flex;
            justify-content: center;
            flex-direction: column;
            align-items: center;
        }
        .qr-code img {
            margin-bottom: 20px;
        }
        .has-enlarge-option {
            cursor: -moz-zoom-in; 
            cursor: -webkit-zoom-in; 
            cursor: zoom-in
        }
    `

    create_template ({ template }) {
        $(template).html(`
            <div class="qr-code opt-qr-code">
            </div>
        `);
    }

    on_ready ({ listen }) {
        listen('value', value => {
            // $(this.dom_).find('.qr-code').empty();
            new QRCode($(this.dom_).find('.qr-code').get(0), {
                text: value,
                // TODO: dynamic size
                width: this.get('size'),
                height: this.get('size'),
                currectLevel: QRCode.CorrectLevel.H,
            });

            if ( this.get('enlarge_option') ) {
                $(this.dom_).find('.qr-code img').addClass('has-enlarge-option');
                $(this.dom_).find('.qr-code img').on('click', async () => {
                    UIComponentWindow({
                        component: new QRCodeView({
                            value: value,
                            size: 400,
                            enlarge_option: false,
                        }),
                        title: i18n('enlarged_qr_code'),
                        backdrop: true,
                        dominant: true,
                        width: 550,
                        height: 'auto',
                        body_css: {
                            width: 'initial',
                            height: '100%',
                            'background-color': 'rgb(245 247 249)',
                            'backdrop-filter': 'blur(3px)',
                            padding: '20px',
                        },
                    })
                });
            }
        });
    }
});
