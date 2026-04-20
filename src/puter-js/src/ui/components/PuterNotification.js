/**
 * <puter-notification> - Toast notification with auto-dismiss and stacking.
 *
 * Attributes: title, text, icon, duration (ms, default 5000), round-icon,
 *             type (info|success|warning|error)
 * Events: click, close
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

// Static notification stack manager
const activeNotifications = [];
const NOTIFICATION_GAP = 12;
const NOTIFICATION_TOP = 24;
const NOTIFICATION_RIGHT = 16;

function repositionNotifications () {
    let top = NOTIFICATION_TOP;
    for ( const notif of activeNotifications ) {
        notif.style.top = `${top }px`;
        top += notif.offsetHeight + NOTIFICATION_GAP;
    }
}

const TYPE_ACCENTS = {
    info: { bg: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', color: '#0284c7' },
    success: { bg: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)', color: '#16a34a' },
    warning: { bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', color: '#d97706' },
    error: { bg: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)', color: '#dc2626' },
    default: { bg: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)', color: '#7c3aed' },
};

const TYPE_ICONS = {
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>`,
};

class PuterNotification extends PuterWebComponent {
    getStyles () {
        return `
            :host {
                position: fixed;
                right: ${NOTIFICATION_RIGHT}px;
                z-index: 999999;
                pointer-events: auto;
                transition: top 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.3s ease,
                            transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .notification {
                width: 320px;
                border-radius: 11px;
                min-height: 54px;
                background: #ffffffcd;
                backdrop-filter: blur(5px);
                -webkit-backdrop-filter: blur(5px);
                box-shadow: 0px 0px 17px -9px #000;
                border: 1px solid #d5d5d5;
                margin-bottom: 10px;
                display: flex;
                flex-direction: row;
                font-family: ${defaultFontFamily};
                cursor: pointer;
                position: relative;
            }
            .notification:hover .close-btn {
                display: block;
            }
            .close-btn {
                position: absolute;
                background: white;
                border: none;
                border-radius: 100%;
                top: -6px;
                left: -6px;
                width: 13px;
                height: 13px;
                padding: 2px;
                filter: drop-shadow(0px 0px 0.5px rgb(51, 51, 51));
                display: none;
                cursor: pointer;
                font-size: 9px;
                line-height: 1;
                text-align: center;
                color: #666;
                z-index: 1;
            }
            .close-btn:hover {
                background: #f0f0f0;
                color: #222;
            }
            .icon-area {
                width: 40px;
                margin: 10px 5px 10px 15px;
                border-radius: 50%;
                filter: drop-shadow(0px 0px 0.5px rgb(51, 51, 51));
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .icon-area svg {
                width: 35px;
                height: 35px;
            }
            .icon-area img {
                width: 35px;
                height: 35px;
                object-fit: contain;
                border-radius: 50%;
            }
            :host([round-icon]) .icon-area img {
                border-radius: 50%;
            }
            .content {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                padding: 10px;
                min-width: 0;
            }
            .title {
                font-size: 12px;
                font-weight: 600;
                color: #333;
                line-height: 1.3;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .text {
                font-size: 12px;
                color: #555;
                margin-top: 4px;
                line-height: 1.4;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
            /* Entrance animation */
            :host(.entering) {
                transform: translateX(110%) scale(0.95);
                opacity: 0;
            }
            :host(.visible) {
                transform: translateX(0) scale(1);
                opacity: 1;
            }
            /* Exit animation */
            :host(.exiting) {
                transform: translateX(110%) scale(0.95);
                opacity: 0;
            }
            @media (max-width: 480px) {
                :host {
                    right: 10px;
                    left: 10px;
                }
                .notification {
                    width: auto;
                }
            }
        `;
    }

    render () {
        const title = this.getAttribute('title') || '';
        const text = this.getAttribute('text') || '';
        const icon = this.getAttribute('icon') || '';
        const type = this.getAttribute('type') || 'default';

        let iconHTML;
        if ( icon ) {
            iconHTML = `<div class="icon-area"><img src="${this._escapeAttr(icon)}" alt=""></div>`;
        } else {
            const accent = TYPE_ACCENTS[type] || TYPE_ACCENTS.default;
            const iconSvg = TYPE_ICONS[type] || TYPE_ICONS.default;
            iconHTML = `<div class="icon-area" style="color: ${accent.color}">${iconSvg}</div>`;
        }

        return `
            <div class="notification">
                ${iconHTML}
                <div class="content">
                    ${title ? `<div class="title">${this._escapeHTML(title)}</div>` : ''}
                    ${text ? `<div class="text">${this._escapeHTML(text)}</div>` : ''}
                </div>
                <button class="close-btn" aria-label="Close">\u2715</button>
            </div>`;
    }

    onReady () {
        // Add to stack
        activeNotifications.push(this);
        this.classList.add('entering');

        // Trigger entrance animation
        requestAnimationFrame(() => {
            repositionNotifications();
            requestAnimationFrame(() => {
                this.classList.remove('entering');
                this.classList.add('visible');
            });
        });

        // Close button
        this.$('.close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._dismiss();
        });

        // Click notification
        this.$('.notification').addEventListener('click', () => {
            this.emitEvent('click', {});
        });

        // Auto-dismiss
        const duration = parseInt(this.getAttribute('duration') ?? '5000', 10);
        if ( duration > 0 ) {
            this._dismissTimer = setTimeout(() => this._dismiss(), duration);
        }
    }

    _dismiss () {
        if ( this._dismissed ) return;
        this._dismissed = true;

        if ( this._dismissTimer ) clearTimeout(this._dismissTimer);

        this.classList.remove('visible');
        this.classList.add('exiting');

        setTimeout(() => {
            const idx = activeNotifications.indexOf(this);
            if ( idx !== -1 ) activeNotifications.splice(idx, 1);
            repositionNotifications();
            this.emitEvent('close', {});
            this.remove();
        }, 350);
    }

    disconnectedCallback () {
        if ( this._dismissTimer ) clearTimeout(this._dismissTimer);
        const idx = activeNotifications.indexOf(this);
        if ( idx !== -1 ) activeNotifications.splice(idx, 1);
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

export default PuterNotification;
