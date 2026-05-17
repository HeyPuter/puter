class PuterDialog extends (globalThis.HTMLElement || Object) { // It will fall back to only extending Object in environments without a DOM
    // Similar to `#messageID` in Auth.js. We start at an arbitrary high number to avoid
    // collisions.
    static messageID = Math.floor(Number.MAX_SAFE_INTEGER / 2);

    /**
     * Detects if the current page is loaded using the file:// protocol.
     * @returns {boolean} True if using file:// protocol, false otherwise.
     */
    isUsingFileProtocol = () => {
        return window.location.protocol === 'file:';
    };

    #messageID;

    constructor (resolve, reject) {
        super();
        this.reject = reject;
        this.resolve = resolve;
        this.popupLaunched = false; // Track if popup was successfully launched
        this.#messageID = this.constructor.messageID++;

        /**
         * Detects if there's a recent user activation that would allow popup opening
         * @returns {boolean} True if user activation is available, false otherwise.
         */
        this.hasUserActivation = () => {
            // Modern browsers support navigator.userActivation
            if ( navigator.userActivation ) {
                return navigator.userActivation.hasBeenActive && navigator.userActivation.isActive;
            }

            // Fallback: try to detect user activation by attempting to open a popup
            // This is a bit hacky but works as a fallback
            try {
                const testPopup = window.open('', '_blank', 'width=1,height=1,left=-1000,top=-1000');
                if ( testPopup ) {
                    testPopup.close();
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        };

        /**
         * Launches the authentication popup window
         * @returns {Window|null} The popup window reference or null if failed
         */
        this.launchPopup = () => {
            try {
                let w = 600;
                let h = 700;
                let title = 'Puter';
                var left = (screen.width / 2) - (w / 2);
                var top = (screen.height / 2) - (h / 2);
                const popup = window.open(
                    `${puter.defaultGUIOrigin }/?embedded_in_popup=true&request_auth=true${ window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''}`,
                    title,
                    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${ w }, height=${ h }, top=${ top }, left=${ left}`,
                );
                return popup;
            } catch (e) {
                console.error('Failed to open popup:', e);
                return null;
            }
        };

        this.attachShadow({ mode: 'open' });

        let h;
        // Dialog
        h = `
        <style>
        dialog{
            background: transparent; 
            border: none; 
            box-shadow: none; 
            outline: none;
        }
        .puter-dialog-content {
            border: 1px solid #e8e8e8;
            border-radius: 8px;
            padding: 20px;
            background: white;
            box-shadow: 0 0 9px 1px rgb(0 0 0 / 21%);
            padding: 80px 20px;
            -webkit-font-smoothing: antialiased;
            color: #575762;
            position: relative;
            background-color: #fff;
        }
        
        dialog * {
            max-width: 500px;
            font-family: "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
        }
        
        dialog p.about{
            text-align: center;
            font-size: 17px;
            padding: 10px 30px;
            font-weight: 400;
            -webkit-font-smoothing: antialiased;
            color: #1f1f2a;
            box-sizing: border-box;
            max-width: 400px;
        }
        
        dialog .buttons{
            display: flex;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
            margin-top: 20px;
            text-align: center;
            flex-direction: column;
        }
        
        .launch-auth-popup-footnote{
            font-size: 10px;
            color: #666;
            margin-top: 10px;
            /* footer at the bottom */
            position: absolute;
            left: 0;
            right: 0;
            bottom: 20px;
            text-align: center;
            margin: 0 auto; 
            max-width: 215px;
        }
        
        dialog .close-btn{
            position: absolute;
            right: 15px;
            top: 10px;
            font-size: 17px;
            color: #8a8a8a8c;
            cursor: pointer;
        }
        
        dialog .close-btn:hover{
            color: #000;
        }
        
        /* ------------------------------------
        Button
        ------------------------------------*/
        
        dialog .button {
            color: #666666;
            background-color: #eeeeee;
            border-color: #eeeeee;
            font-size: 14px;
            text-decoration: none;
            text-align: center;
            line-height: 40px;
            height: 35px;
            padding: 0 30px;
            margin: 0;
            display: inline-block;
            appearance: none;
            cursor: pointer;
            border: none;
            -webkit-box-sizing: border-box;
            -moz-box-sizing: border-box;
            box-sizing: border-box;
            border-color: #b9b9b9;
            border-style: solid;
            border-width: 1px;
            line-height: 35px;
            background: -webkit-gradient(linear, left top, left bottom, from(#f6f6f6), to(#e1e1e1));
            background: linear-gradient(#f6f6f6, #e1e1e1);
            border-radius: 4px;
            outline: none;
            -webkit-font-smoothing: antialiased;
        }
        
        dialog .button:focus-visible {
            border-color: rgb(118 118 118);
        }
        
        dialog .button:active, dialog .button.active, dialog .button.is-active, dialog .button.has-open-contextmenu {
            text-decoration: none;
            background-color: #eeeeee;
            border-color: #cfcfcf;
            color: #a9a9a9;
            -webkit-transition-duration: 0s;
            transition-duration: 0s;
            -webkit-box-shadow: inset 0 1px 3px rgb(0 0 0 / 20%);
            box-shadow: inset 0px 2px 3px rgb(0 0 0 / 36%), 0px 1px 0px white;
        }
        
        dialog .button.disabled, dialog .button.is-disabled, dialog .button:disabled {
            top: 0 !important;
            background: #EEE !important;
            border: 1px solid #DDD !important;
            text-shadow: 0 1px 1px white !important;
            color: #CCC !important;
            cursor: default !important;
            appearance: none !important;
            pointer-events: none;
        }
        
        dialog .button-action.disabled, dialog .button-action.is-disabled, dialog .button-action:disabled {
            background: #55a975 !important;
            border: 1px solid #60ab7d !important;
            text-shadow: none !important;
            color: #CCC !important;
        }
        
        dialog .button-primary.disabled, dialog .button-primary.is-disabled, dialog .button-primary:disabled {
            background: #8fc2e7 !important;
            border: 1px solid #98adbd !important;
            text-shadow: none !important;
            color: #f5f5f5 !important;
        }
        
        dialog .button-block {
            width: 100%;
        }
        
        dialog .button-primary {
            border-color: #088ef0;
            background: -webkit-gradient(linear, left top, left bottom, from(#34a5f8), to(#088ef0));
            background: linear-gradient(#34a5f8, #088ef0);
            color: white;
        }
        
        dialog .button-danger {
            border-color: #f00808;
            background: -webkit-gradient(linear, left top, left bottom, from(#f83434), to(#f00808));
            background: linear-gradient(#f83434, #f00808);
            color: white;
        }
        
        dialog .button-primary:active, dialog .button-primary.active, dialog .button-primary.is-active, dialog .button-primary-flat:active, dialog .button-primary-flat.active, dialog .button-primary-flat.is-active {
            background-color: #2798eb;
            border-color: #2798eb;
            color: #bedef5;
        }
        
        dialog .button-action {
            border-color: #08bf4e;
            background: -webkit-gradient(linear, left top, left bottom, from(#29d55d), to(#1ccd60));
            background: linear-gradient(#29d55d, #1ccd60);
            color: white;
        }
        
        dialog .button-action:active, dialog .button-action.active, dialog .button-action.is-active, dialog .button-action-flat:active, dialog .button-action-flat.active, dialog .button-action-flat.is-active {
            background-color: #27eb41;
            border-color: #27eb41;
            color: #bef5ca;
        }
        
        dialog .button-giant {
            font-size: 28px;
            height: 70px;
            line-height: 70px;
            padding: 0 70px;
        }
        
        dialog .button-jumbo {
            font-size: 24px;
            height: 60px;
            line-height: 60px;
            padding: 0 60px;
        }
        
        dialog .button-large {
            font-size: 20px;
            height: 50px;
            line-height: 50px;
            padding: 0 50px;
        }
        
        dialog .button-normal {
            font-size: 16px;
            height: 40px;
            line-height: 38px;
            padding: 0 40px;
        }
        
        dialog .button-small {
            height: 30px;
            line-height: 29px;
            padding: 0 30px;
        }
        
        dialog .button-tiny {
            font-size: 9.6px;
            height: 24px;
            line-height: 24px;
            padding: 0 24px;
        }
        
        #launch-auth-popup{
            width: 220px; 
            font-weight: 500; 
            font-size: 15px;
            max-width: 250px;
        }
        dialog .button-auth{
            margin-bottom: 10px;
        }
        dialog .button-auth-cancel{
            background: none !important;
            width: 220px;
            max-width: 250px;
        }
        dialog a, dialog a:visited{
            color: rgb(0 0 0);
            text-decoration: none;
        }
        dialog a:hover{
            text-decoration: underline;
        }
        
        @media (max-width:480px)  {
            .puter-dialog-content{
                padding: 50px 20px;
            }
            dialog p.about{
                padding: 10px 0;
            }
            dialog .button-auth{
                width: 100% !important;
                margin:0 !important;
                margin-bottom: 10px !important;
            }

            dialog .buttons{
                margin-bottom: 20px;
            }
        }
        .error-container h1 {
            color: #e74c3c;
            font-size: 20px;
            text-align: center;
        }

        .puter-dialog-content a:focus{
            outline: none;
        }

        @media (prefers-color-scheme: dark) {
            .puter-dialog-content {
                border: 1px solid #2a2a2e;
                background: #1e1e22;
                background-color: #1e1e22;
                color: #d6d6dc;
                box-shadow: 0 0 9px 1px rgb(0 0 0 / 60%);
            }

            dialog p.about {
                color: #e4e4ea;
            }

            dialog .close-btn {
                color: #8a8a90;
            }

            dialog .close-btn:hover {
                color: #fff;
            }

            .launch-auth-popup-footnote {
                color: #9a9aa0;
            }

            dialog .button {
                color: #d6d6dc;
                background-color: #3a3a40;
                border-color: #4a4a50;
                background: linear-gradient(#3f3f45, #2e2e34);
                -webkit-box-shadow: inset 0px 1px 0px rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 40%);
                box-shadow: inset 0px 1px 0px rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 40%);
            }

            dialog .button:focus-visible {
                border-color: #8a8a90;
            }

            dialog .button:active, dialog .button.active, dialog .button.is-active, dialog .button.has-open-contextmenu {
                background-color: #2a2a30;
                border-color: #1f1f24;
                color: #8a8a90;
                -webkit-box-shadow: inset 0 1px 3px rgb(0 0 0 / 60%);
                box-shadow: inset 0px 2px 3px rgb(0 0 0 / 60%), 0px 1px 0px rgb(255 255 255 / 4%);
            }

            dialog .button.disabled, dialog .button.is-disabled, dialog .button:disabled {
                background: #2a2a30 !important;
                border: 1px solid #34343a !important;
                text-shadow: none !important;
                color: #5a5a60 !important;
            }

            dialog .button-primary.disabled, dialog .button-primary.is-disabled, dialog .button-primary:disabled {
                background: #1f4e74 !important;
                border: 1px solid #2a5a82 !important;
                color: #8aa4bd !important;
            }

            dialog .button-action.disabled, dialog .button-action.is-disabled, dialog .button-action:disabled {
                background: #1f5a3a !important;
                border: 1px solid #2a6a45 !important;
                color: #8abda0 !important;
            }

            dialog a, dialog a:visited {
                color: #6ea8ff;
            }

            .error-container h1 {
                color: #ff7466;
            }
        }
        </style>`;
        // Error message for unsupported protocol
        if ( window.location.protocol === 'file:' ) {
            h += `<dialog>
                    <div class="puter-dialog-content" style="padding: 20px 40px; font-size: 15px;">
                        <span class="close-btn">&#x2715</span>
                        <div class="error-container">
                            <h1>Puter.js Error: Unsupported Protocol</h1>
                            <p>It looks like you've opened this file directly in your browser (using the <code style="font-family: monospace;">file:///</code> protocol) which is not supported by Puter.js for security reasons.</p>
                            <p>To view this content properly, you need to serve it through a web server. Here are some options:</p>
                            <ul>
                                <li>Use a local development server (e.g., Python's built-in server or Node.js http-server)</li>
                                <li>Upload the files to a web hosting service</li>
                                <li>Use a local server application like XAMPP or MAMP</li>
                            </ul>
                            <p class="help-text">If you're not familiar with these options, consider reaching out to your development team or IT support for assistance.</p>
                        </div>
                        <p style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; text-align: center; font-size:13px;">
                            <a href="https://docs.puter.com" target="_blank">Docs</a><span style="margin:10px; color: #CCC;">|</span>
                            <a href="https://github.com/heyPuter/puter/" target="_blank">Github</a><span style="margin:10px; color: #CCC;">|</span>
                            <a href="https://discord.com/invite/PQcx7Teh8u" target="_blank">Discord</a>
                        </p>
                    </div>
                </dialog>`;
        } else {
            h += `<dialog>
                <div class="puter-dialog-content">
                    <span class="close-btn">&#x2715</span>
                    <a href="https://puter.com?utm_source=sdk-splash" target="_blank" style="border:none; outline:none; display: block; width: 70px; height: 70px; margin: 0 auto; border-radius: 4px;"><img style="display: block; width: 40px; height: 40px; margin: 0 auto; border-radius: 8px; background-color: #2210d7; padding: 15px;" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+Cjxzdmcgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnN2Zz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogPGcgY2xhc3M9ImxheWVyIj4KICA8dGl0bGU+TGF5ZXIgMTwvdGl0bGU+CiAgPGcgaWQ9InN2Z18xIiBzdHJva2Utd2lkdGg9IjMiIHRyYW5zZm9ybT0icm90YXRlKDkwIDI0IDIzLjk5OTcpIj4KICAgPHBvbHlsaW5lIGZpbGw9Im5vbmUiIGlkPSJzdmdfMiIgcG9pbnRzPSIzOSAyNCAyNSAyNCAyNSAyOCIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2UtbGluZWNhcD0ic3F1YXJlIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS13aWR0aD0iMyIvPgogICA8cG9seWxpbmUgZmlsbD0ibm9uZSIgaWQ9InN2Z18zIiBwb2ludHM9IjM1Ljg3OSAxMC4xMjEgMzIgMTQgMjUgMTQgMjUgMTgiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLWxpbmVjYXA9InNxdWFyZSIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2Utd2lkdGg9IjMiLz4KICAgPHBhdGggZD0ibTEzLDI2YTEwLjI5LDEwLjI5IDAgMCAxIC03LjIsLTMiIGZpbGw9Im5vbmUiIGlkPSJzdmdfNCIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2UtbGluZWNhcD0ic3F1YXJlIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS13aWR0aD0iMyIvPgogICA8cGF0aCBkPSJtMTcsMzEuNmE1LjgzLDUuODMgMCAwIDEgLTQsLTUuNmE1LjczLDUuNzMgMCAwIDEgMiwtNC40IiBmaWxsPSJub25lIiBpZD0ic3ZnXzUiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLWxpbmVjYXA9InNxdWFyZSIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2Utd2lkdGg9IjMiLz4KICAgPHBhdGggZD0ibTM1Ljg4LDM3Ljg4bC0zLjg4LC0zLjg4bC03LDBsMCwyYTkuOSw5LjkgMCAwIDEgLTEwLDEwYTkuOSw5LjkgMCAwIDEgLTEwLC0xMGE5LjA2LDkuMDYgMCAwIDEgMC42LC0zLjJhNS42Myw1LjYzIDAgMCAxIC0yLjYsLTQuOGE1Ljg5LDUuODkgMCAwIDEgMi44LC01YTkuOTksOS45OSAwIDAgMSAtMi44LC03YTkuOSw5LjkgMCAwIDEgMTAsLTEwbDAuNCwwYTUuODMsNS44MyAwIDAgMSA1LjYsLTRhNS44OSw1Ljg5IDAgMCAxIDYsNiIgZmlsbD0ibm9uZSIgaWQ9InN2Z182IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1saW5lY2FwPSJzcXVhcmUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLXdpZHRoPSIzIi8+CiAgIDxjaXJjbGUgY3g9IjM4IiBjeT0iOCIgZGF0YS1jb2xvcj0iY29sb3ItMiIgZmlsbD0ibm9uZSIgaWQ9InN2Z183IiByPSIzIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1saW5lY2FwPSJzcXVhcmUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLXdpZHRoPSIzIi8+CiAgIDxjaXJjbGUgY3g9IjQyIiBjeT0iMjQiIGRhdGEtY29sb3I9ImNvbG9yLTIiIGZpbGw9Im5vbmUiIGlkPSJzdmdfOCIgcj0iMyIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2UtbGluZWNhcD0ic3F1YXJlIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS13aWR0aD0iMyIvPgogICA8Y2lyY2xlIGN4PSIzOCIgY3k9IjQwIiBkYXRhLWNvbG9yPSJjb2xvci0yIiBmaWxsPSJub25lIiBpZD0ic3ZnXzkiIHI9IjMiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLWxpbmVjYXA9InNxdWFyZSIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2Utd2lkdGg9IjMiLz4KICA8L2c+CiA8L2c+Cjwvc3ZnPg=="/></a>
                    <p class="about">This website uses Puter to bring you safe, secure, and private AI and Cloud features.</p>
                    <div class="buttons">
                        <button class="button button-primary button-auth" id="launch-auth-popup">Continue</button>
                        <button class="button button-auth button-auth-cancel" id="launch-auth-popup-cancel">Cancel</button>
                    </div>
                    <p class="launch-auth-popup-footnote">By clicking 'Continue' you agree to Puter's <a href="https://puter.com/terms" target="_blank">Terms of Service</a> and <a href="https://puter.com/privacy" target="_blank">Privacy Policy</a></p>
                </div>
            </dialog>`;
        }

        this.shadowRoot.innerHTML = h;

        // Event listener for the 'message' event
        this.messageListener = async (event) => {
            if ( event.data.msg === 'puter.token' ) {
                this.close();
                // Set the authToken property
                puter.setAuthToken(event.data.token);
                // update appID
                puter.setAppID(event.data.app_uid);
                // Remove the event listener to avoid memory leaks
                window.removeEventListener('message', this.messageListener);

                puter.puterAuthState.authGranted = true;
                // Resolve the promise
                this.resolve();

                // Call onAuth callback
                if ( puter.onAuth && typeof puter.onAuth === 'function' ) {
                    puter.getUser().then((user) => {
                        puter.onAuth(user);
                    });
                }

                puter.puterAuthState.isPromptOpen = false;
                // Resolve or reject any waiting promises.
                if ( puter.puterAuthState.resolver ) {
                    if ( puter.puterAuthState.authGranted ) {
                        puter.puterAuthState.resolver.resolve();
                    } else {
                        puter.puterAuthState.resolver.reject();
                    }
                    puter.puterAuthState.resolver = null;
                };
            }
        };

    }

    // Optional: Handle dialog cancellation as rejection
    cancelListener = () => {
        this.close();
        window.removeEventListener('message', this.messageListener);
        puter.puterAuthState.authGranted = false;
        puter.puterAuthState.isPromptOpen = false;

        // Reject the promise with an error message indicating user cancellation.
        // This ensures that the calling code's catch block will be triggered.
        this.reject(new Error('User cancelled the authentication'));

        // If there's a resolver set, use it to reject the waiting promise as well.
        if ( puter.puterAuthState.resolver ) {
            puter.puterAuthState.resolver.reject(new Error('User cancelled the authentication'));
            puter.puterAuthState.resolver = null;
        }
    };

    connectedCallback () {
        // Add event listener to the button
        this.shadowRoot.querySelector('#launch-auth-popup')?.addEventListener('click', () => {
            let w = 600;
            let h = 700;
            let title = 'Puter';
            var left = (screen.width / 2) - (w / 2);
            var top = (screen.height / 2) - (h / 2);
            window.open(
                `${puter.defaultGUIOrigin }/?embedded_in_popup=true&request_auth=true&msg_id=${this.#messageID}${ window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''}`,
                title,
                `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${ w }, height=${ h }, top=${ top }, left=${ left}`,
            );
        });

        // Add the event listener to the window object
        window.addEventListener('message', this.messageListener);

        // Add event listeners for cancel and close buttons
        this.shadowRoot.querySelector('#launch-auth-popup-cancel')?.addEventListener('click', this.cancelListener);
        this.shadowRoot.querySelector('.close-btn')?.addEventListener('click', this.cancelListener);
    }

    open () {
        if ( this.hasUserActivation() ) {
            let w = 600;
            let h = 700;
            let title = 'Puter';
            var left = (screen.width / 2) - (w / 2);
            var top = (screen.height / 2) - (h / 2);
            window.open(
                `${puter.defaultGUIOrigin }/?embedded_in_popup=true&request_auth=true&msg_id=${this.#messageID}${ window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''}`,
                title,
                `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${ w }, height=${ h }, top=${ top }, left=${ left}`,
            );
        }
        else {
            this.shadowRoot.querySelector('dialog').showModal();
        }
    }

    close () {
        this.shadowRoot.querySelector('dialog').close();
    }
}
if ( PuterDialog.__proto__ === globalThis.HTMLElement )
{
    customElements.define('puter-dialog', PuterDialog);
}

export default PuterDialog;
