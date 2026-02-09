class EmailConfirmationDialog extends (globalThis.HTMLElement || Object) {
    constructor (message) {
        super();
        this.message = message || 'Please confirm your email address to use this service.';

        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
        <style>
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

            .dialog-content {
                border: 1px solid #e8e8e8;
                border-radius: 12px;
                padding: 32px;
                background: white;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
                -webkit-font-smoothing: antialiased;
                color: #333;
                position: relative;
                max-width: 420px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }

            .close-btn {
                position: absolute;
                right: 16px;
                top: 12px;
                font-size: 20px;
                color: #999;
                cursor: pointer;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background 0.2s, color 0.2s;
            }

            .close-btn:hover {
                background: #f0f0f0;
                color: #333;
            }

            .icon-container {
                width: 64px;
                height: 64px;
                margin: 0 auto 20px;
                background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .icon-container svg {
                width: 32px;
                height: 32px;
                color: #1976d2;
            }

            h2 {
                margin: 0 0 12px;
                font-size: 20px;
                font-weight: 600;
                text-align: center;
                color: #1a1a1a;
            }

            .message {
                text-align: center;
                font-size: 14px;
                line-height: 1.5;
                color: #666;
                margin-bottom: 24px;
            }

            .buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
            }

            .button {
                padding: 10px 24px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
                font-family: inherit;
            }

            .button-secondary {
                background: #f5f5f5;
                color: #666;
            }

            .button-secondary:hover {
                background: #e8e8e8;
            }

            .button-primary {
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                color: white;
            }

            .button-primary:hover {
                background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            }
        </style>
        <dialog>
            <div class="dialog-content">
                <span class="close-btn">&#x2715;</span>
                <div class="icon-container">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </div>
                <h2>Confirm Your Email</h2>
                <p class="message">${this.message}</p>
                <div class="buttons">
                    <button class="button button-secondary" id="close-btn">Close</button>
                    <button class="button button-primary" id="confirm-email-btn">Go to Puter.com</button>
                </div>
            </div>
        </dialog>
        `;
    }

    connectedCallback () {
        const dialog = this.shadowRoot.querySelector('dialog');

        this.shadowRoot.querySelector('.close-btn').addEventListener('click', () => {
            this.close();
        });

        this.shadowRoot.querySelector('#close-btn').addEventListener('click', () => {
            this.close();
        });

        this.shadowRoot.querySelector('#confirm-email-btn').addEventListener('click', () => {
            window.open('https://puter.com', '_blank');
            this.close();
        });

        // Close on backdrop click
        dialog.addEventListener('click', (e) => {
            if ( e.target === dialog ) {
                this.close();
            }
        });
    }

    open () {
        this.shadowRoot.querySelector('dialog').showModal();
    }

    close () {
        this.shadowRoot.querySelector('dialog').close();
        this.remove();
    }
}

// Only define custom element in environments with DOM support
if ( typeof globalThis.HTMLElement !== 'undefined' && globalThis.customElements ) {
    if ( ! customElements.get('email-confirmation-dialog') ) {
        customElements.define('email-confirmation-dialog', EmailConfirmationDialog);
    }
}

/**
 * Shows an email confirmation dialog to the user.
 * Call only when puter.env === 'web' (caller's responsibility).
 * @param {string} message - The message to display
 */
export function showEmailConfirmationDialog (message) {
    // Only show in browser environments
    if ( typeof globalThis.document === 'undefined' ) {
        return;
    }

    // Check if dialog is already shown to prevent duplicates
    if ( document.querySelector('email-confirmation-dialog') ) {
        return;
    }

    const dialog = new EmailConfirmationDialog(message);
    document.body.appendChild(dialog);
    dialog.open();
}

export default EmailConfirmationDialog;
