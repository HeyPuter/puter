/**
 * <puter-prompt> - Modal prompt dialog with text input.
 *
 * Attributes: message, placeholder, default-value
 * Properties: options
 * Events: response (detail = input value or false on cancel)
 */

import PuterWebComponent from '../PuterWebComponent.js';

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
                background: var(--puter-backdrop);
            }
            .prompt-body {
                background: var(--puter-color-bg);
                backdrop-filter: var(--puter-backdrop-blur);
                border: 1px solid var(--puter-color-border);
                border-radius: var(--puter-border-radius-lg);
                padding: 32px;
                box-shadow: var(--puter-shadow);
                font-family: var(--puter-font-family);
                color: var(--puter-color-text);
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
                    font-size: 16px; /* prevent iOS zoom on focus */
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
                font-size: var(--puter-font-size-md);
                line-height: 1.5;
                color: var(--puter-color-text);
                text-shadow: 1px 1px rgba(255, 255, 255, 0.32);
                text-align: left;
            }
            .input-container {
                margin-top: 20px;
            }
            input[type="text"] {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--puter-color-input-border);
                border-radius: var(--puter-border-radius-sm);
                color: #393f46;
                font-size: var(--puter-font-size-base);
                font-family: var(--puter-font-family);
                box-sizing: border-box;
                outline: none;
                transition: border-color 0.15s;
            }
            input[type="text"]:focus {
                border: 2px solid var(--puter-color-input-border-focus);
                padding: 7px;
            }
            .buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                margin-top: 20px;
            }
            button {
                padding: 10px 24px;
                border-radius: var(--puter-border-radius);
                font-size: var(--puter-font-size-base);
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
                font-family: var(--puter-font-family);
            }
            button:focus-visible {
                outline: 2px solid var(--puter-color-input-border-focus);
                outline-offset: 2px;
            }
            .btn-cancel {
                background: var(--puter-color-button-default-bg);
                color: var(--puter-color-button-default-text);
            }
            .btn-cancel:hover {
                background: linear-gradient(135deg, #e8e8e8 0%, #d5d5d5 100%);
            }
            .btn-ok {
                background: var(--puter-color-primary-gradient);
                color: var(--puter-color-text-on-primary);
                min-width: 110px;
            }
            .btn-ok:hover {
                background: var(--puter-color-primary-gradient-hover);
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
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
