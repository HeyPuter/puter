/**
 * <puter-font-picker> - Modal font picker dialog with curated web-safe fonts.
 *
 * Attributes: default-font
 * Events: response (detail = { fontFamily: string } or null on cancel)
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily, defaultButtonCSS } from '../PuterDefaultStyles.js';

const SYSTEM_FONTS = [
    // System / sans-serif
    { name: 'System UI', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', category: 'System' },
    { name: 'Arial', family: 'Arial, sans-serif', category: 'Sans Serif' },
    { name: 'Helvetica', family: 'Helvetica, sans-serif', category: 'Sans Serif' },
    { name: 'Verdana', family: 'Verdana, sans-serif', category: 'Sans Serif' },
    { name: 'Tahoma', family: 'Tahoma, sans-serif', category: 'Sans Serif' },
    { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif', category: 'Sans Serif' },
    { name: 'Impact', family: 'Impact, sans-serif', category: 'Sans Serif' },
    // Serif
    { name: 'Times New Roman', family: '"Times New Roman", Times, serif', category: 'Serif' },
    { name: 'Georgia', family: 'Georgia, serif', category: 'Serif' },
    { name: 'Garamond', family: 'Garamond, serif', category: 'Serif' },
    { name: 'Palatino', family: 'Palatino, "Palatino Linotype", serif', category: 'Serif' },
    // Monospace
    { name: 'Courier New', family: '"Courier New", Courier, monospace', category: 'Monospace' },
    { name: 'Consolas', family: 'Consolas, monospace', category: 'Monospace' },
    { name: 'Monaco', family: 'Monaco, monospace', category: 'Monospace' },
    { name: 'SF Mono', family: '"SF Mono", ui-monospace, monospace', category: 'Monospace' },
    // Cursive / display
    { name: 'Brush Script', family: '"Brush Script MT", cursive', category: 'Cursive' },
    { name: 'Comic Sans', family: '"Comic Sans MS", cursive', category: 'Cursive' },
];

class PuterFontPicker extends PuterWebComponent {
    #selected = null;

    getStyles () {
        return `
            dialog {
                background: transparent;
                border: none;
                box-shadow: none;
                outline: none;
                padding: 0;
                max-width: 90vw;
                max-height: 90vh;
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
                display: flex;
                flex-direction: column;
                max-height: 80vh;
            }
            .header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 16px;
            }
            .title {
                font-size: 15px;
                font-weight: 600;
                color: #414650;
                text-shadow: 1px 1px #ffffff52;
                flex: 1;
            }
            .search {
                width: 100%;
                padding: 8px;
                font-size: 14px;
                border: 1px solid #b9b9b9;
                border-radius: 4px;
                outline: none;
                box-sizing: border-box;
                font-family: ${defaultFontFamily};
                margin-bottom: 14px;
                transition: border-color 0.15s ease;
            }
            .search:focus {
                border: 2px solid #01a0fd;
                padding: 7px;
            }
            .font-list {
                height: 200px;
                overflow-y: scroll;
                background-color: white;
                padding: 0 10px;
                margin-bottom: 16px;
                border-radius: 4px;
                border: 1px solid #b9b9b9;
            }
            .font-item {
                padding: 10px;
                border-radius: 2px;
                margin: 10px 0;
                cursor: pointer;
                font-size: 16px;
                color: #414650;
                display: flex;
                align-items: baseline;
                gap: 12px;
                transition: background 0.08s ease;
            }
            .font-item:hover {
                background: rgba(0, 0, 0, 0.04);
            }
            .font-item.selected {
                color: white;
                background-color: #2b62f1;
            }
            .font-item.selected .font-name-label {
                color: rgba(255, 255, 255, 0.7);
            }
            .font-name-label {
                font-family: ${defaultFontFamily};
                font-size: 12px;
                color: #888;
                flex-shrink: 0;
                margin-left: auto;
            }
            .preview {
                padding: 14px;
                background: white;
                border: 1px solid #b9b9b9;
                border-radius: 4px;
                font-size: 24px;
                margin-bottom: 16px;
                min-height: 40px;
                color: #414650;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
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
            .btn-ok:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                box-shadow: none;
            }
            @media (max-width: 480px) {
                .picker-body {
                    width: 100%;
                    padding: 20px;
                    max-height: 90vh;
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
            :host(.puter-theme-dark) .title {
                color: #e6e6e6;
                text-shadow: none;
            }
            :host(.puter-theme-dark) .search {
                background-color: #1f1f1f;
                border-color: #555;
                color: #e6e6e6;
            }
            :host(.puter-theme-dark) .font-list {
                background-color: #1f1f1f;
                border-color: #555;
            }
            :host(.puter-theme-dark) .font-item {
                color: #e6e6e6;
            }
            :host(.puter-theme-dark) .font-item:hover {
                background: rgba(255, 255, 255, 0.06);
            }
            :host(.puter-theme-dark) .font-name-label {
                color: #888;
            }
            :host(.puter-theme-dark) .preview {
                background: #1f1f1f;
                border-color: #555;
                color: #e6e6e6;
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
        const defaultFont = this.getAttribute('default-font') || 'System UI';
        this.#selected = SYSTEM_FONTS.find(f =>
            f.name.toLowerCase() === defaultFont.toLowerCase() ||
            f.family.toLowerCase().includes(defaultFont.toLowerCase())) || SYSTEM_FONTS[0];

        const fontListHTML = this._renderFontList(SYSTEM_FONTS);

        return `
            <dialog>
                <div class="picker-body">
                    <div class="header">
                        <div class="title">Choose Font</div>
                    </div>
                    <input class="search" type="text" placeholder="Search fonts...">
                    <div class="preview" style="font-family: ${this.#selected.family}">The quick brown fox</div>
                    <div class="font-list">
                        ${fontListHTML}
                    </div>
                    <div class="buttons">
                        <button class="btn btn-cancel">Cancel</button>
                        <button class="btn btn-ok">Select</button>
                    </div>
                </div>
            </dialog>`;
    }

    _renderFontList (fonts) {
        return fonts.map(f => `
            <div class="font-item${f.name === this.#selected.name ? ' selected' : ''}"
                 data-name="${this._escapeAttr(f.name)}"
                 style="font-family: ${f.family}">
                ${this._escapeHTML(f.name)}
            </div>
        `).join('');
    }

    onReady () {
        const dialog = this.$('dialog');
        const search = this.$('.search');
        const list = this.$('.font-list');
        const preview = this.$('.preview');
        const okBtn = this.$('.btn-ok');
        const cancelBtn = this.$('.btn-cancel');

        const bindItems = () => {
            this.$$('.font-item').forEach(item => {
                item.addEventListener('click', () => {
                    const font = SYSTEM_FONTS.find(f => f.name === item.dataset.name);
                    if ( ! font ) return;
                    this.#selected = font;
                    this.$$('.font-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    preview.style.fontFamily = font.family;
                });
                item.addEventListener('dblclick', () => {
                    const font = SYSTEM_FONTS.find(f => f.name === item.dataset.name);
                    if ( font ) {
                        this.#selected = font;
                        this.emitEvent('response', { fontFamily: font.family });
                        this.close();
                    }
                });
            });
        };

        bindItems();

        search.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const filtered = SYSTEM_FONTS.filter(f =>
                f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
            list.innerHTML = this._renderFontList(filtered);
            bindItems();
        });

        okBtn.addEventListener('click', () => {
            this.emitEvent('response', { fontFamily: this.#selected.family });
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

export default PuterFontPicker;
