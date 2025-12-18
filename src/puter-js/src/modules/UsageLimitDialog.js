class UsageLimitDialog extends (globalThis.HTMLElement || Object) {
    constructor (message) {
        super();
        this.message = message || 'You have reached your usage limit for this account.';
        
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
                background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .icon-container svg {
                width: 32px;
                height: 32px;
                color: #f57c00;
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
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2>Low Balance</h2>
                <p class="message">${this.message}</p>
                <div class="buttons">
                    <button class="button button-secondary" id="close-btn">Close</button>
                    <button class="button button-primary" id="upgrade-btn">Upgrade Now</button>
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
            window.open('https://puter.com/dashboard', '_blank');
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

