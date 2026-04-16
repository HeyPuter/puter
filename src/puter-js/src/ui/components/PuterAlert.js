/**
 * <puter-alert> - Modal alert dialog with customizable buttons and types.
 *
 * Attributes: message, type (error|warning|info|success|confirm)
 * Properties: buttons (array of {label, value, type}), options
 * Events: response (detail = button value)
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

const ALERT_ICONS = {
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>`,
    confirm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
};

const ICON_COLORS = {
    error: '#D32F2F',
    warning: '#FFA000',
    info: '#1976D2',
    success: '#388E3C',
    confirm: '#555555',
};

const ICON_BG = {
    error: 'linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%)',
    warning: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)',
    info: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
    success: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)',
    confirm: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)',
};

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
                background: var(--puter-backdrop);
            }
            .alert-body {
                background: var(--puter-color-bg);
                backdrop-filter: var(--puter-backdrop-blur);
                border: 1px solid var(--puter-color-border);
                border-radius: var(--puter-border-radius-lg);
                padding: 32px;
                box-shadow: var(--puter-shadow);
                font-family: var(--puter-font-family);
                color: var(--puter-color-text);
                width: 350px;
                max-width: calc(100vw - 32px);
                box-sizing: border-box;
                text-align: center;
            }
            @media (max-width: 480px) {
                .alert-body {
                    width: 100%;
                    padding: 24px 20px;
                }
                button {
                    padding: 14px 24px;
                    font-size: 16px;
                }
            }
            .icon-container {
                width: 64px;
                height: 64px;
                margin: 0 auto 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .icon-container svg {
                width: 32px;
                height: 32px;
            }
            .message {
                font-size: var(--puter-font-size-md);
                line-height: 1.5;
                color: var(--puter-color-text);
                text-shadow: 1px 1px rgba(255, 255, 255, 0.32);
                margin-bottom: 20px;
            }
            .buttons {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            button {
                width: 100%;
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
            .btn-primary {
                background: var(--puter-color-primary-gradient);
                color: var(--puter-color-text-on-primary);
            }
            .btn-primary:hover {
                background: var(--puter-color-primary-gradient-hover);
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            }
            .btn-danger {
                background: var(--puter-color-danger-gradient);
                color: var(--puter-color-text-on-primary);
            }
            .btn-danger:hover {
                box-shadow: 0 4px 12px rgba(211, 47, 47, 0.3);
            }
            .btn-success {
                background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);
                color: var(--puter-color-text-on-primary);
            }
            .btn-warning {
                background: linear-gradient(135deg, #ffb74d 0%, #ffa000 100%);
                color: #333;
            }
            .btn-info {
                background: linear-gradient(135deg, #42a5f5 0%, #1976d2 100%);
                color: var(--puter-color-text-on-primary);
            }
            .btn-default {
                background: var(--puter-color-button-default-bg);
                color: var(--puter-color-button-default-text);
            }
            .btn-default:hover {
                background: linear-gradient(135deg, #e8e8e8 0%, #d5d5d5 100%);
            }
        `;
    }

    getDefaultStyles () {
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
            .icon-container {
                width: 64px;
                margin: 10px auto 20px;
                display: block;
                text-align: center;
            }
            .icon-container svg {
                width: 64px;
                height: 64px;
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
        const buttons = this.#buttons || [{ label: 'OK', value: true, type: 'primary' }];

        let iconHTML = '';
        if ( type && ALERT_ICONS[type] ) {
            if ( this.getTheme() === 'default' ) {
                // Default theme: show SVG icon directly without gradient container
                iconHTML = `
                    <div class="icon-container" style="color: ${ICON_COLORS[type]}">
                        ${ALERT_ICONS[type]}
                    </div>`;
            } else {
                iconHTML = `
                    <div class="icon-container" style="background: ${ICON_BG[type]}; color: ${ICON_COLORS[type]}">
                        ${ALERT_ICONS[type]}
                    </div>`;
            }
        }

        const buttonsHTML = buttons.map((btn, i) => {
            const btnType = btn.type || ( i === buttons.length - 1 ? 'primary' : 'default' );
            const value = btn.value !== undefined ? btn.value : btn.label;
            return `<button class="btn-${btnType}" data-value="${this._escapeAttr(String(value))}">${this._escapeHTML(btn.label)}</button>`;
        }).join('');

        return `
            <dialog>
                <div class="alert-body">
                    ${iconHTML}
                    <div class="message">${this._escapeHTML(message)}</div>
                    <div class="buttons">${buttonsHTML}</div>
                </div>
            </dialog>`;
    }

    onReady () {
        const dialog = this.$('dialog');
        const buttons = this.#buttons || [{ label: 'OK', value: true, type: 'primary' }];

        // Button clicks
        this.$$('button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const raw = btn.dataset.value;
                // Try to match back to original value
                const match = buttons.find(b => String(b.value !== undefined ? b.value : b.label) === raw);
                this.emitEvent('response', match ? (match.value !== undefined ? match.value : match.label) : raw);
                this.close();
            });
        });

        // Close on backdrop click
        dialog.addEventListener('click', (e) => {
            if ( e.target === dialog ) {
                this.emitEvent('response', undefined);
                this.close();
            }
        });

        // Auto-focus last button (primary)
        const allBtns = this.$$('button');
        if ( allBtns.length > 0 ) {
            allBtns[allBtns.length - 1].focus();
        }
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr (str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export default PuterAlert;
