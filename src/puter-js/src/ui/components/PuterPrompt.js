/**
 * <puter-prompt> - Modal prompt dialog with text input.
 *
 * Attributes: message, placeholder, default-value
 * Properties: options
 * Events: response (detail = input value or false on cancel)
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily, defaultButtonCSS } from '../PuterDefaultStyles.js';

class PuterPrompt extends PuterWebComponent {
    #options = null;

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
            .prompt-body {
                background-color: rgba(231, 238, 245, .95);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                border: none;
                border-radius: 8px;
                padding: 32px;
                box-shadow: 0px 0px 15px #00000066;
                font-family: ${defaultFontFamily};
                color: #414650;
                width: 450px;
                max-width: calc(100vw - 32px);
                box-sizing: border-box;
            }
            @media (max-width: 480px) {
                .prompt-body {
                    width: 100%;
                    padding: 24px 20px;
                }
                input[type="text"] {
                    padding: 12px;
                    font-size: 16px;
                }
                input[type="text"]:focus {
                    padding: 11px;
                }
                button {
                    padding: 14px 20px;
                    font-size: 16px;
                }
                .btn-ok {
                    flex: 1;
                }
                .btn-cancel {
                    flex: 1;
                }
            }
            .message {
                font-size: 15px;
                line-height: 1.5;
                color: #414650;
                text-shadow: 1px 1px #ffffff52;
                text-align: left;
            }
            .input-container {
                margin-top: 20px;
            }
            input[type="text"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #b9b9b9;
                border-radius: 4px;
                color: #393f46;
                font-size: 14px;
                font-family: ${defaultFontFamily};
                box-sizing: border-box;
                outline: none;
                transition: border-color 0.15s;
            }
            input[type="text"]:focus {
                border: 2px solid #01a0fd;
                padding: 7px;
            }
            .buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                margin-top: 20px;
            }
            .btn-cancel {
                background: linear-gradient(#f6f6f6, #e1e1e1);
                border: 1px solid #b9b9b9;
                color: #666666;
                border-radius: 4px;
                height: 35px;
                line-height: 35px;
                padding: 0 24px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                font-family: ${defaultFontFamily};
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
            }
            .btn-cancel:active {
                background-color: #eeeeee;
                border-color: #cfcfcf;
                color: #a9a9a9;
                box-shadow: inset 0px 2px 3px rgb(0 0 0 / 36%), 0px 1px 0px white;
            }
            .btn-ok {
                background: linear-gradient(#34a5f8, #088ef0);
                border: 1px solid #088ef0;
                color: white;
                border-radius: 4px;
                height: 35px;
                line-height: 35px;
                padding: 0 24px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                font-family: ${defaultFontFamily};
                min-width: 110px;
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
            }
            .btn-ok:active {
                background-color: #2798eb;
                border-color: #2798eb;
                color: #bedef5;
            }
            button:focus-visible {
                outline: 2px solid #01a0fd;
                outline-offset: 2px;
            }
        `;
    }

    render () {
        const message = this.getAttribute('message') || '';
        const placeholder = this.getAttribute('placeholder') || '';
        const defaultValue = this.getAttribute('default-value') || '';

        return `
            <dialog>
                <div class="prompt-body">
                    <div class="message">${this._escapeHTML(message)}</div>
                    <div class="input-container">
                        <input type="text" class="prompt-input" placeholder="${this._escapeAttr(placeholder)}" value="${this._escapeAttr(defaultValue)}">
                    </div>
                    <div class="buttons">
                        <button class="btn-cancel">Cancel</button>
                        <button class="btn-ok">OK</button>
                    </div>
                </div>
            </dialog>`;
    }

    onReady () {
        const dialog = this.$('dialog');
        const input = this.$('.prompt-input');
        const okBtn = this.$('.btn-ok');
        const cancelBtn = this.$('.btn-cancel');

        // Auto-focus input after brief delay
        setTimeout(() => input.focus(), 30);

        // Enter key submits
        input.addEventListener('keydown', (e) => {
            if ( e.key === 'Enter' ) {
                this.emitEvent('response', input.value);
                this.close();
            } else if ( e.key === 'Escape' ) {
                this.emitEvent('response', false);
                this.close();
            }
        });

        okBtn.addEventListener('click', () => {
            this.emitEvent('response', input.value);
            this.close();
        });

        cancelBtn.addEventListener('click', () => {
            this.emitEvent('response', false);
            this.close();
        });

        // Close on backdrop click
        dialog.addEventListener('click', (e) => {
            if ( e.target === dialog ) {
                this.emitEvent('response', false);
                this.close();
            }
        });
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr (str) {
        if ( ! str ) return '';
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export default PuterPrompt;
