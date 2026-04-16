/**
 * <puter-spinner> - Full-page loading overlay with spinner.
 *
 * Attributes: text (optional loading message)
 * Methods: open(), close()
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

class PuterSpinner extends PuterWebComponent {
    getDefaultStyles () {
        return `
            .overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(2px);
                -webkit-backdrop-filter: blur(2px);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                font-family: ${defaultFontFamily};
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            :host(.visible) .overlay {
                opacity: 1;
            }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #e0e0e0;
                border-top-color: #088ef0;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            .text {
                margin-top: 16px;
                font-size: 14px;
                color: #666666;
                text-align: center;
                padding: 0 20px;
                max-width: 90vw;
            }
            @media (max-width: 480px) {
                .spinner {
                    width: 48px;
                    height: 48px;
                    border-width: 4px;
                }
                .text {
                    font-size: 16px;
                }
            }
        `;
    }

    getStyles () {
        return `
            .overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(2px);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                font-family: var(--puter-font-family);
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            :host(.visible) .overlay {
                opacity: 1;
            }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #e0e0e0;
                border-top-color: var(--puter-color-primary);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            .text {
                margin-top: 16px;
                font-size: var(--puter-font-size-base);
                color: var(--puter-color-text-secondary);
                text-align: center;
                padding: 0 20px;
                max-width: 90vw;
            }
            @media (max-width: 480px) {
                .spinner {
                    width: 48px;
                    height: 48px;
                    border-width: 4px;
                }
                .text {
                    font-size: 16px;
                }
            }
        `;
    }

    render () {
        const text = this.getAttribute('text') || '';
        return `
            <div class="overlay">
                <div class="spinner"></div>
                ${text ? `<div class="text">${this._escapeHTML(text)}</div>` : ''}
            </div>`;
    }

    onReady () {
        requestAnimationFrame(() => {
            this.classList.add('visible');
        });
    }

    open () {
        this.classList.add('visible');
    }

    close () {
        this.classList.remove('visible');
        setTimeout(() => this.remove(), 200);
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

export default PuterSpinner;
