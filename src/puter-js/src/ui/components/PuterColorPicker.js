/**
 * <puter-color-picker> - Modal color picker dialog.
 *
 * Attributes: default-color, message
 * Events: response (detail = hex color string or null on cancel)
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily, defaultButtonCSS } from '../PuterDefaultStyles.js';

const PRESET_COLORS = [
    '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
    '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
    '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
    '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
    '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
    '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
    '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
    '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
];

class PuterColorPicker extends PuterWebComponent {
    #currentColor = '#3b82f6';

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
            .picker-body {
                background-color: rgba(231, 238, 245, .95);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                border: none;
                border-radius: 8px;
                padding: 24px;
                box-shadow: 0px 0px 15px #00000066;
                font-family: ${defaultFontFamily};
                color: #414650;
                width: 350px;
                max-width: calc(100vw - 32px);
                box-sizing: border-box;
            }
            .header {
                display: flex;
                align-items: center;
                gap: 14px;
                margin-bottom: 20px;
            }
            .preview {
                width: 56px;
                height: 56px;
                border-radius: 4px;
                border: 1px solid #b9b9b9;
                background: var(--current-color, #3b82f6);
                flex-shrink: 0;
                transition: background 0.15s ease;
            }
            .header-info {
                flex: 1;
                min-width: 0;
            }
            .header-label {
                font-size: 12px;
                color: #666666;
                margin-bottom: 4px;
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .hex-input {
                width: 100%;
                padding: 8px;
                font-family: ui-monospace, "SF Mono", Menlo, monospace;
                font-size: 14px;
                border: 1px solid #b9b9b9;
                border-radius: 4px;
                color: #414650;
                box-sizing: border-box;
                outline: none;
                text-transform: uppercase;
                transition: border-color 0.15s ease;
            }
            .hex-input:focus {
                border: 2px solid #01a0fd;
                padding: 7px;
            }
            .native-color-row {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 18px;
                padding: 10px 12px;
                background: rgba(255, 255, 255, 0.5);
                border: 1px solid #b9b9b9;
                border-radius: 4px;
            }
            .native-color-row label {
                font-size: 13px;
                color: #666666;
                cursor: pointer;
                flex: 1;
            }
            input[type="color"] {
                width: 36px;
                height: 36px;
                padding: 0;
                border: 1px solid #b9b9b9;
                border-radius: 4px;
                cursor: pointer;
                background: transparent;
            }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
            input[type="color"]::-webkit-color-swatch { border: none; border-radius: 2px; }
            .swatches {
                display: grid;
                grid-template-columns: repeat(10, 1fr);
                gap: 5px;
                margin-bottom: 20px;
            }
            .swatch {
                aspect-ratio: 1;
                border-radius: 3px;
                cursor: pointer;
                border: 1px solid rgba(0, 0, 0, 0.06);
                transition: transform 0.1s ease;
            }
            .swatch:hover {
                transform: scale(1.15);
                z-index: 1;
            }
            .swatch.selected {
                outline: 2px solid #01a0fd;
                outline-offset: 2px;
            }
            .buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            ${defaultButtonCSS}
            .btn-cancel {
                /* uses base .btn styles */
            }
            .btn-ok {
                border-color: #088ef0;
                background: linear-gradient(#34a5f8, #088ef0);
                color: white;
                min-width: 90px;
            }
            .btn-ok:active {
                background-color: #2798eb;
                border-color: #2798eb;
                color: #bedef5;
            }
            @media (max-width: 480px) {
                .picker-body {
                    width: 100%;
                    padding: 20px;
                }
                .swatches {
                    grid-template-columns: repeat(8, 1fr);
                }
                .btn {
                    padding: 0 20px;
                    font-size: 16px;
                    height: 40px;
                    line-height: 40px;
                    flex: 1;
                }
            }
            :host(.puter-theme-dark) .picker-body {
                background-color: rgba(40, 44, 52, .95);
                color: #e6e6e6;
                box-shadow: 0px 0px 15px #000000aa;
            }
            :host(.puter-theme-dark) .preview {
                border-color: #555;
            }
            :host(.puter-theme-dark) .header-label {
                color: #aaa;
            }
            :host(.puter-theme-dark) .hex-input {
                background-color: #1f1f1f;
                border-color: #555;
                color: #e6e6e6;
            }
            :host(.puter-theme-dark) .native-color-row {
                background: rgba(255, 255, 255, 0.05);
                border-color: #555;
            }
            :host(.puter-theme-dark) .native-color-row label {
                color: #aaa;
            }
            :host(.puter-theme-dark) input[type="color"] {
                border-color: #555;
            }
            :host(.puter-theme-dark) .swatch {
                border-color: rgba(255, 255, 255, 0.1);
            }
            :host(.puter-theme-dark) .btn {
                color: #e6e6e6;
                border-color: #555;
                background: linear-gradient(#4a4a4a, #3a3a3a);
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 8%), 0 1px 2px rgb(0 0 0 / 25%);
            }
            :host(.puter-theme-dark) .btn:active {
                background-color: #333;
                border-color: #444;
                color: #999;
            }
        `;
    }

    render () {
        const defaultColor = this.getAttribute('default-color') || '#3b82f6';
        this.#currentColor = this._normalizeHex(defaultColor);

        const swatches = PRESET_COLORS.map(c =>
            `<div class="swatch${c.toLowerCase() === this.#currentColor.toLowerCase() ? ' selected' : ''}"
                  data-color="${c}" style="background: ${c}"></div>`).join('');

        return `
            <dialog>
                <div class="picker-body" style="--current-color: ${this.#currentColor}">
                    <div class="header">
                        <div class="preview"></div>
                        <div class="header-info">
                            <div class="header-label">Hex</div>
                            <input class="hex-input" type="text" value="${this.#currentColor.toUpperCase()}" maxlength="7">
                        </div>
                    </div>
                    <div class="native-color-row">
                        <label for="native-color">Pick any color</label>
                        <input id="native-color" type="color" value="${this.#currentColor}">
                    </div>
                    <div class="swatches">${swatches}</div>
                    <div class="buttons">
                        <button class="btn btn-cancel">Cancel</button>
                        <button class="btn btn-ok">Select</button>
                    </div>
                </div>
            </dialog>`;
    }

    onReady () {
        const dialog = this.$('dialog');
        const hexInput = this.$('.hex-input');
        const nativeColor = this.$('input[type="color"]');
        const okBtn = this.$('.btn-ok');
        const cancelBtn = this.$('.btn-cancel');

        // Swatch clicks
        this.$$('.swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                this._setColor(sw.dataset.color);
            });
        });

        // Hex input
        hexInput.addEventListener('input', (e) => {
            const val = this._normalizeHex(e.target.value);
            if ( val ) this._setColor(val, { fromHexInput: true });
        });

        // Native color picker
        nativeColor.addEventListener('input', (e) => {
            this._setColor(e.target.value, { fromNative: true });
        });

        okBtn.addEventListener('click', () => {
            this.emitEvent('response', this.#currentColor);
            this.close();
        });

        cancelBtn.addEventListener('click', () => {
            this.emitEvent('response', null);
            this.close();
        });

        dialog.addEventListener('click', (e) => {
            if ( e.target === dialog ) {
                this.emitEvent('response', null);
                this.close();
            }
        });

        // Escape to cancel
        dialog.addEventListener('cancel', (e) => {
            this.emitEvent('response', null);
        });
    }

    _setColor (color, opts = {}) {
        const hex = this._normalizeHex(color);
        if ( ! hex ) return;
        this.#currentColor = hex;

        // Update preview
        const body = this.$('.picker-body');
        if ( body ) body.style.setProperty('--current-color', hex);

        // Update hex input (unless edit came from there)
        if ( ! opts.fromHexInput ) {
            const hexInput = this.$('.hex-input');
            if ( hexInput ) hexInput.value = hex.toUpperCase();
        }

        // Update native picker (unless edit came from there)
        if ( ! opts.fromNative ) {
            const native = this.$('input[type="color"]');
            if ( native ) native.value = hex;
        }

        // Update swatch selection
        this.$$('.swatch').forEach(sw => {
            sw.classList.toggle('selected', sw.dataset.color.toLowerCase() === hex.toLowerCase());
        });
    }

    _normalizeHex (str) {
        if ( ! str ) return null;
        str = str.trim();
        if ( str[0] !== '#' ) str = `#${ str}`;
        // Expand shorthand
        if ( /^#[0-9a-f]{3}$/i.test(str) ) {
            str = `#${ str[1] }${str[1] }${str[2] }${str[2] }${str[3] }${str[3]}`;
        }
        return /^#[0-9a-f]{6}$/i.test(str) ? str.toLowerCase() : null;
    }
}

export default PuterColorPicker;
