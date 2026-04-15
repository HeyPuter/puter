/**
 * <puter-font-picker> - Modal font picker dialog with curated web-safe fonts.
 *
 * Attributes: default-font
 * Events: response (detail = { fontFamily: string } or null on cancel)
 */

import PuterWebComponent from '../PuterWebComponent.js';

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
                background: var(--puter-backdrop);
            }
            .picker-body {
                background: #ffffff;
                border: 1px solid rgba(0, 0, 0, 0.06);
                border-radius: 16px;
                padding: 24px;
                box-shadow:
                    0 1px 2px rgba(0, 0, 0, 0.04),
                    0 16px 48px rgba(0, 0, 0, 0.12);
                font-family: var(--puter-font-family);
                color: #1a1a1a;
                width: 480px;
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
                font-size: 16px;
                font-weight: 600;
                flex: 1;
            }
            .search {
                width: 100%;
                padding: 10px 14px;
                font-size: 14px;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 8px;
                outline: none;
                box-sizing: border-box;
                font-family: inherit;
                margin-bottom: 14px;
                transition: border-color 0.15s ease;
            }
            .search:focus {
                border-color: var(--puter-color-input-border-focus);
            }
            .font-list {
                flex: 1;
                overflow-y: auto;
                border: 1px solid rgba(0, 0, 0, 0.06);
                border-radius: 10px;
                padding: 4px;
                margin-bottom: 16px;
                min-height: 280px;
                max-height: 380px;
            }
            .category-label {
                padding: 10px 12px 4px;
                font-size: 11px;
                font-weight: 600;
                color: #999;
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .font-item {
                padding: 10px 14px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                color: #1a1a1a;
                display: flex;
                align-items: baseline;
                gap: 12px;
                transition: background 0.08s ease;
            }
            .font-item:hover {
                background: rgba(0, 0, 0, 0.04);
            }
            .font-item.selected {
                background: var(--puter-color-input-border-focus);
                color: white;
            }
            .font-item.selected .font-name-label {
                color: rgba(255, 255, 255, 0.7);
            }
            .font-name-label {
                font-family: var(--puter-font-family);
                font-size: 12px;
                color: #888;
                flex-shrink: 0;
                margin-left: auto;
            }
            .preview {
                padding: 14px;
                background: rgba(0, 0, 0, 0.03);
                border-radius: 8px;
                font-size: 24px;
                margin-bottom: 16px;
                min-height: 40px;
                color: #1a1a1a;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            button.btn {
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                border: none;
                font-family: inherit;
                transition: all 0.15s ease;
            }
            .btn-cancel {
                background: rgba(0, 0, 0, 0.05);
                color: #444;
            }
            .btn-cancel:hover { background: rgba(0, 0, 0, 0.08); }
            .btn-ok {
                background: var(--puter-color-primary-gradient);
                color: white;
                min-width: 90px;
            }
            .btn-ok:hover { box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); }
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
                button.btn {
                    padding: 14px 20px;
                    font-size: 16px;
                    flex: 1;
                }
            }
            @media (prefers-color-scheme: dark) {
                .picker-body {
                    background: #1f1f23;
                    color: #f5f5f7;
                    border-color: rgba(255, 255, 255, 0.08);
                }
                .search, .font-list {
                    background: rgba(255, 255, 255, 0.04);
                    border-color: rgba(255, 255, 255, 0.1);
                    color: #f5f5f7;
                }
                .font-item { color: #f5f5f7; }
                .font-item:hover { background: rgba(255, 255, 255, 0.06); }
                .preview {
                    background: rgba(255, 255, 255, 0.04);
                    color: #f5f5f7;
                }
                .btn-cancel {
                    background: rgba(255, 255, 255, 0.08);
                    color: #f5f5f7;
                }
            }
        `;
    }

    render () {
        const defaultFont = this.getAttribute('default-font') || 'System UI';
        this.#selected = SYSTEM_FONTS.find(f =>
            f.name.toLowerCase() === defaultFont.toLowerCase() ||
            f.family.toLowerCase().includes(defaultFont.toLowerCase())) || SYSTEM_FONTS[0];

        return `
            <dialog>
                <div class="picker-body">
                    <div class="header">
                        <div class="title">Choose Font</div>
                    </div>
                    <input class="search" type="text" placeholder="Search fonts...">
                    <div class="preview" style="font-family: ${this.#selected.family}">The quick brown fox</div>
                    <div class="font-list">
                        ${this._renderFontList(SYSTEM_FONTS)}
                    </div>
                    <div class="buttons">
                        <button class="btn btn-cancel">Cancel</button>
                        <button class="btn btn-ok">Select</button>
                    </div>
                </div>
            </dialog>`;
    }

    _renderFontList (fonts) {
        // Group by category
        const byCategory = {};
        fonts.forEach(f => {
            (byCategory[f.category] = byCategory[f.category] || []).push(f);
        });

        return Object.entries(byCategory).map(([cat, fontList]) => `
            <div class="category-label">${this._escapeHTML(cat)}</div>
            ${fontList.map(f => `
                <div class="font-item${f.name === this.#selected.name ? ' selected' : ''}"
                     data-name="${this._escapeAttr(f.name)}"
                     style="font-family: ${f.family}">
                    ${this._escapeHTML(f.name)}
                    <span class="font-name-label">${this._escapeHTML(cat)}</span>
                </div>
            `).join('')}
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
