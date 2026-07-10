class UsageLimitDialog extends (globalThis.HTMLElement || Object) {
    constructor (message) {
        super();
        this.message = message || 'You have reached your usage limit for this account.';

        this.attachShadow({ mode: 'open' });

        // NOTE: This dialog deliberately mirrors the design of PuterDialog
        // (the consent dialog) so all puter.js system dialogs stay visually
        // consistent. If you restyle one of them, restyle all three.
        this.shadowRoot.innerHTML = `
        <style>
        dialog {
            background: transparent;
            border: none;
            box-shadow: none;
            outline: none;
            padding: 0;
        }

        dialog::backdrop {
            background: rgba(0, 0, 0, 0.5);
        }

        .puter-dialog-content {
            border: 1px solid #e8e8e8;
            border-radius: 8px;
            padding: 50px 30px 30px;
            background-color: #fff;
            box-shadow: 0 0 9px 1px rgb(0 0 0 / 21%);
            -webkit-font-smoothing: antialiased;
            color: #575762;
            position: relative;
            box-sizing: border-box;
            width: 400px;
            max-width: 90vw;
        }

        dialog, dialog * {
            font-family: "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
        }

        .close-btn {
            position: absolute;
            right: 15px;
            top: 10px;
            font-size: 17px;
            color: #8a8a8a8c;
            cursor: pointer;
        }

        .close-btn:hover {
            color: #000;
        }

        .dialog-icon {
            width: 70px;
            height: 70px;
            margin: 0 auto;
        }

        .dialog-icon svg {
            display: block;
            width: 70px;
            height: 70px;
            padding: 15px;
            border-radius: 8px;
            box-sizing: border-box;
            background-color: #f59e0b;
            color: #fff;
        }

        h2 {
            text-align: center;
            font-size: 19px;
            font-weight: 500;
            color: #1f1f2a;
            margin: 18px 0 0;
        }

        .message {
            text-align: center;
            font-size: 15px;
            font-weight: 400;
            line-height: 1.5;
            color: #575762;
            padding: 10px 10px 0;
            margin: 0;
        }

        .buttons {
            display: flex;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            margin-top: 24px;
        }

        .button {
            color: #666666;
            background: linear-gradient(#f6f6f6, #e1e1e1);
            font-size: 14px;
            text-align: center;
            height: 35px;
            line-height: 35px;
            padding: 0 30px;
            margin: 0;
            display: inline-block;
            appearance: none;
            cursor: pointer;
            border: 1px solid #b9b9b9;
            box-sizing: border-box;
            border-radius: 4px;
            outline: none;
            width: 220px;
            -webkit-font-smoothing: antialiased;
        }

        .button:focus-visible {
            border-color: rgb(118 118 118);
        }

        .button-primary {
            border-color: #088ef0;
            background: linear-gradient(#34a5f8, #088ef0);
            color: #fff;
            font-weight: 500;
            font-size: 15px;
            margin-bottom: 10px;
        }

        .button-primary:active {
            background: #2798eb;
            border-color: #2798eb;
            color: #bedef5;
        }

        .button-cancel {
            background: none;
        }

        @media (max-width: 480px) {
            .puter-dialog-content {
                padding: 50px 20px 25px;
            }
            .button {
                width: 100%;
            }
        }

        @media (prefers-color-scheme: dark) {
            .puter-dialog-content {
                border: 1px solid #2a2a2e;
                background-color: #1e1e22;
                color: #d6d6dc;
                box-shadow: 0 0 9px 1px rgb(0 0 0 / 60%);
            }

            h2 {
                color: #e4e4ea;
            }

            .message {
                color: #b9b9c2;
            }

            .close-btn {
                color: #8a8a90;
            }

            .close-btn:hover {
                color: #fff;
            }

            .button {
                color: #d6d6dc;
                background: linear-gradient(#3f3f45, #2e2e34);
                border-color: #4a4a50;
            }

            .button:focus-visible {
                border-color: #8a8a90;
            }

            .button-primary {
                border-color: #088ef0;
                background: linear-gradient(#34a5f8, #088ef0);
                color: #fff;
            }
        }
        </style>
        <dialog>
            <div class="puter-dialog-content">
                <span class="close-btn">&#x2715;</span>
                <div class="dialog-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2>Low Balance</h2>
                <p class="message">${this.message}</p>
                <div class="buttons">
                    <button class="button button-primary" id="upgrade-btn">Upgrade Now</button>
                    <button class="button button-cancel" id="close-btn">Close</button>
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

        this.shadowRoot.querySelector('#upgrade-btn').addEventListener('click', () => {
            window.open('https://puter.com/dashboard/#home', '_blank');
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
    if ( ! customElements.get('usage-limit-dialog') ) {
        customElements.define('usage-limit-dialog', UsageLimitDialog);
    }
}

/**
 * Shows a usage limit dialog to the user
 * @param {string} message - The message to display
 */
export function showUsageLimitDialog (message) {
    // Only log in non-browser environments
    if ( typeof globalThis.document === 'undefined' ) {
        console.warn('[Puter]', message);
        return;
    }

    // Check if dialog is already shown to prevent duplicates
    if ( document.querySelector('usage-limit-dialog') ) {
        return;
    }

    const dialog = new UsageLimitDialog(message);
    document.body.appendChild(dialog);
    dialog.open();
}

export default UsageLimitDialog;
