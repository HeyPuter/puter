/**
 * <puter-alert> - Modal alert dialog with customizable buttons and types.
 *
 * Attributes: message, type (error|warning|info|success|confirm), icon
 * Properties: buttons (array of {label, value, type}), options
 *   options.body_icon / options.icon: URL or data-URI for a custom icon
 *     (mirrors the legacy puter.com alert's body_icon option).
 * Events: response (detail = button value)
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';
import { DEFAULT_ALERT_ICONS } from './PuterAlertIcons.js';

class PuterAlert extends PuterWebComponent {
    #buttons = null;
    #options = null;

    get buttons () {
        return this.#buttons;
    }
    set buttons (val) {
        this.#buttons = val;
    }

    get options () {
        return this.#options;
    }
    set options (val) {
        this.#options = val;
    }

    getStyles () {
        return `
            dialog {
                background: transparent;
                border: none;
                box-shadow: none;
                outline: none;
                padding: 0;
                max-width: 90vw;
            }
            dialog::backdrop {
                background: rgba(0, 0, 0, 0.5);
            }
            .alert-body {
                background-color: rgba(231, 238, 245, .95);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                border: none;
                border-radius: 4px;
                padding: 32px;
                box-shadow: 0px 0px 15px #00000066;
                font-family: ${defaultFontFamily};
                color: #414650;
                width: 350px;
                max-width: calc(100vw - 32px);
                box-sizing: border-box;
                text-align: center;
            }
            .alert-icon {
                width: 64px;
                height: 64px;
                margin: 10px auto 20px;
                display: block;
            }
            .message {
                font-size: 15px;
                line-height: 1.5;
                color: #414650;
                text-shadow: 1px 1px #ffffff52;
                text-align: center;
                margin-top: 10px;
                margin-bottom: 20px;
            }
            .message p { margin: 0 0 10px; }
            .message p:last-child { margin-bottom: 0; }
            .buttons {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 10px;
            }
            button {
                width: 100%;
                height: 35px;
                line-height: 35px;
                padding: 0;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 400;
                cursor: pointer;
                font-family: ${defaultFontFamily};
                box-sizing: border-box;
                outline: none;
                color: #666666;
                border: 1px solid #b9b9b9;
                background: linear-gradient(#f6f6f6, #e1e1e1);
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
            }
            button:active {
                background-color: #eeeeee;
                border-color: #cfcfcf;
                color: #a9a9a9;
                box-shadow: inset 0px 2px 3px rgb(0 0 0 / 36%), 0px 1px 0px white;
            }
            button:focus-visible {
                border-color: rgb(118 118 118);
            }
            .btn-primary {
                background: linear-gradient(#34a5f8, #088ef0);
                border: 1px solid #088ef0;
                color: white;
            }
            .btn-primary:active {
                background-color: #2798eb;
                border-color: #2798eb;
                color: #bedef5;
            }
            .btn-danger {
                background: linear-gradient(#ff4e4e, #ff4c4c);
                border: 1px solid #f00808;
                color: white;
            }
            .btn-success {
                background: linear-gradient(#29d55d, #1ccd60);
                border: 1px solid #08bf4e;
                color: white;
            }
            .btn-warning {
                background: linear-gradient(#ffb74d, #ffa000);
                border: 1px solid #ffa000;
                color: #333;
            }
            .btn-info {
                background: linear-gradient(#42a5f5, #1976d2);
                border: 1px solid #1976d2;
                color: white;
            }
            .btn-default {
                color: #666666;
                border: 1px solid #b9b9b9;
                background: linear-gradient(#f6f6f6, #e1e1e1);
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
            }
            @media (max-width: 480px) {
                .alert-body {
                    width: 100%;
                    padding: 24px 20px;
                }
                button {
                    height: 40px;
                    line-height: 40px;
                    font-size: 16px;
                }
            }
        `;
    }

    render () {
        const message = this.getAttribute('message') || '';
        const type = this.#options?.type || this.getAttribute('type') || '';
        const iconSrc = this.#options?.body_icon
            || this.#options?.icon
            || this.getAttribute('icon')
            || DEFAULT_ALERT_ICONS[type]
            || DEFAULT_ALERT_ICONS.info;
        const buttons = this.#buttons || [{ label: 'OK', value: true, type: 'primary' }];

        const iconHTML = `<img class="alert-icon" src="${this._escapeAttr(iconSrc)}" alt="">`;

        const buttonsHTML = buttons.map((btn, i) => {
            const btnType = btn.type || ( i === buttons.length - 1 ? 'primary' : 'default' );
            const value = btn.value !== undefined ? btn.value : btn.label;
            return `<button class="btn-${btnType}" data-value="${this._escapeAttr(String(value))}">${this._escapeHTML(btn.label)}</button>`;
        }).join('');

        return `
            <dialog>
                <div class="alert-body">
                    ${iconHTML}
                    <div class="message">${this._renderMessage(message)}</div>
                    <div class="buttons">${buttonsHTML}</div>
                </div>
            </dialog>`;
    }

    onReady () {
        const dialog = this.$('dialog');
        const buttons = this.#buttons || [{ label: 'OK', value: true, type: 'primary' }];

        this.$$('button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const raw = btn.dataset.value;
                const match = buttons.find(b => String(b.value !== undefined ? b.value : b.label) === raw);
                this.emitEvent('response', match ? (match.value !== undefined ? match.value : match.label) : raw);
                this.close();
            });
        });

        dialog.addEventListener('click', (e) => {
            if ( e.target === dialog ) {
                this.emitEvent('response', undefined);
                this.close();
            }
        });

        const allBtns = this.$$('button');
        if ( allBtns.length > 0 ) {
            allBtns[allBtns.length - 1].focus();
        }
    }

    // Escape the message, then allow the small tag set the legacy alert supports.
    _renderMessage (str) {
        const escaped = this._escapeHTML(str);
        return escaped
            .replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
            .replace(/&lt;p&gt;/g, '<p>').replace(/&lt;\/p&gt;/g, '</p>')
            .replace(/&lt;br\s*\/?&gt;/g, '<br>');
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr (str) {
        return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export default PuterAlert;
