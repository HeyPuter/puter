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

import UIWindow from './UIWindow.js';
import Placeholder from '../util/Placeholder.js';

const QR_CODE_CSS = `
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
    .qr-code .has-enlarge-option {
        cursor: -moz-zoom-in;
        cursor: -webkit-zoom-in;
        cursor: zoom-in;
    }
`;

let css_injected = false;
const inject_css_once = () => {
    if ( css_injected ) return;
    css_injected = true;
    $('<style/>').text(QR_CODE_CSS).appendTo('head');
};

function UIQRCode (options) {
    options = options ?? {};
    const value = options.value;
    const size = options.size ?? 150;
    const enlarge_option = options.enlarge_option ?? true;

    inject_css_once();

    window.global_element_id++;
    const id = `qr-code-${window.global_element_id}`;

    const $el = $(`<div id="${id}" class="qr-code"></div>`);
    const el = $el.get(0);

    if ( value ) {
        new QRCode(el, {
            text: value,
            width: size,
            height: size,
            currectLevel: QRCode.CorrectLevel.H,
        });

        if ( enlarge_option ) {
            const $img = $el.find('img');
            $img.addClass('has-enlarge-option');
            $img.on('click', () => UIQRCode.open_enlarged(value));
        }
    }

    if ( options.appendTo ) {
        if ( options.appendTo && options.appendTo.$ === 'placeholder' ) {
            options.appendTo.replaceWith(el);
        } else {
            $(options.appendTo).append(el);
        }
    }

    // Compatibility shim: Component-based containers (e.g. Flexer) call
    // `.attach(parent)` on their children. Returning a plain DOM element with
    // an `attach` method lets this work without making UIQRCode a Component.
    el.attach = function (destination) {
        if ( destination instanceof HTMLElement || destination instanceof ShadowRoot ) {
            destination.appendChild(el);
            return;
        }
        if ( destination && destination.$ === 'placeholder' ) {
            destination.replaceWith(el);
            return;
        }
        throw new Error(`Unknown destination type: ${destination}`);
    };

    return el;
}

UIQRCode.open_enlarged = async (value) => {
    const placeholder = Placeholder();

    await UIWindow({
        title: i18n('enlarged_qr_code'),
        backdrop: true,
        dominant: true,
        width: 550,
        height: 'auto',
        body_content: placeholder.html,
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
            padding: '20px',
        },
    });

    UIQRCode({
        value,
        size: 400,
        enlarge_option: false,
        appendTo: placeholder,
    });
};

export default UIQRCode;
