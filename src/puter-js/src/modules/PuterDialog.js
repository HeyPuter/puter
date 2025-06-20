class PuterDialog extends (globalThis.HTMLElement || Object) { // It will fall back to only extending Object in environments without a DOM
    /**
     * Detects if the current page is loaded using the file:// protocol.
     * @returns {boolean} True if using file:// protocol, false otherwise.
     */
    isUsingFileProtocol = ()=>{
        return window.location.protocol === 'file:';
    }
    
    
    constructor(resolve, reject) {
        super();
        this.reject = reject;
        this.resolve = resolve;
        this.popupLaunched = false; // Track if popup was successfully launched

        /**
         * Detects if there's a recent user activation that would allow popup opening
         * @returns {boolean} True if user activation is available, false otherwise.
         */
        this.hasUserActivation = () => {
            // Modern browsers support navigator.userActivation
            if (navigator.userActivation) {
                return navigator.userActivation.hasBeenActive && navigator.userActivation.isActive;
            }
            
            // Fallback: try to detect user activation by attempting to open a popup
            // This is a bit hacky but works as a fallback
            try {
                const testPopup = window.open('', '_blank', 'width=1,height=1,left=-1000,top=-1000');
                if (testPopup) {
                    testPopup.close();
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }

        /**
         * Launches the authentication popup window
         * @returns {Window|null} The popup window reference or null if failed
         */
        this.launchPopup = () => {
            try {
                let w = 600;
                let h = 400;
                let title = 'Puter';
                var left = (screen.width/2)-(w/2);
                var top = (screen.height/2)-(h/2);
                const popup = window.open(
                    puter.defaultGUIOrigin + '/?embedded_in_popup=true&request_auth=true' + (window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''), 
                    title, 
                    'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left
                );
                return popup;
            } catch (e) {
                console.error('Failed to open popup:', e);
                return null;
            }
        }

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
            background-image: url('data:image/webp;base64,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');
            background-repeat: no-repeat;
            background-position: center center;
            background-size: 100% 100%;
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
            color: #404048;
            box-sizing: border-box;
        }
        
        dialog .buttons{
            display: flex;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
            margin-top: 20px;
            text-align: center;
            margin-bottom: 20px;
        }
        
        .launch-auth-popup-footnote{
            font-size: 11px;
            color: #666;
            margin-top: 10px;
            /* footer at the bottom */
            position: absolute;
            left: 0;
            right: 0;
            bottom: 10px;
            text-align: center;
            margin: 0 10px;
        }
        
        dialog .close-btn{
            position: absolute;
            right: 15px;
            top: 10px;
            font-size: 17px;
            color: #8a8a8a;
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
            -webkit-box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
            box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
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
            margin-left: 10px; 
            width: 200px; 
            font-weight: 500; 
            font-size: 15px;
        }
        dialog .button-auth{
            margin-bottom: 10px;
        }
        dialog a, dialog a:visited{
            color: rgb(0 69 238);
            text-decoration: none;
        }
        dialog a:hover{
            text-decoration: underline;
        }
        
        @media (max-width:480px)  { 
            .puter-dialog-content{
                padding: 50px 20px;
            }
            dialog .buttons{
                flex-direction: column-reverse;
            }
            dialog p.about{
                padding: 10px 0;
            }
            dialog .button-auth{
                width: 100% !important;
                margin:0 !important;
                margin-bottom: 10px !important;
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
        </style>`;
        // Error message for unsupported protocol
        if(window.location.protocol === 'file:'){
            h += `<dialog>
                    <div class="puter-dialog-content" style="padding: 20px 40px; background:white !important; font-size: 15px;">
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
        }else{
            h += `<dialog>
                <div class="puter-dialog-content">
                    <span class="close-btn">&#x2715</span>
                    <a href="https://puter.com" target="_blank" style="border:none; outline:none; display: block; width: 70px; height: 70px; margin: 0 auto; border-radius: 4px;"><img style="display: block; width: 70px; height: 70px; margin: 0 auto; border-radius: 4px;" src="data:image/png;base64,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"/></a>
                    <p class="about">This website uses Puter to bring you safe, secure, and private AI and Cloud features.</p>
                    <div class="buttons">
                        <button class="button button-auth" id="launch-auth-popup-cancel">Cancel</button>
                        <button class="button button-primary button-auth" id="launch-auth-popup" style="margin-left:10px;">Continue</button>
                    </div>
                    <p style="text-align: center; margin-top: -15px; font-size: 14px;">Powered by <a href="https://developer.puter.com/?utm_source=sdk-splash" target="_blank">Puter</a></p>
                    <p class="launch-auth-popup-footnote">By clicking 'Continue' you agree to Puter's <a href="https://puter.com/terms" target="_blank">Terms of Service</a> and <a href="https://puter.com/privacy" target="_blank">Privacy Policy</a>.</p>
                </div>
            </dialog>`;
        }


        this.shadowRoot.innerHTML = h;

        // Event listener for the 'message' event
        this.messageListener = async (event) => {
            if (event.data.msg === 'puter.token') {
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
                if(puter.onAuth && typeof puter.onAuth === 'function'){
                    puter.getUser().then((user) => {
                        puter.onAuth(user)
                    });
                }

                puter.puterAuthState.isPromptOpen = false;
                // Resolve or reject any waiting promises.
                if (puter.puterAuthState.resolver) {
                    if (puter.puterAuthState.authGranted) {
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
        if (puter.puterAuthState.resolver) {
            puter.puterAuthState.resolver.reject(new Error('User cancelled the authentication'));
            puter.puterAuthState.resolver = null;
        }
    };

    connectedCallback() {
        // Add event listener to the button
        this.shadowRoot.querySelector('#launch-auth-popup')?.addEventListener('click', ()=>{
            let w = 600;
            let h = 400;
            let title = 'Puter';
            var left = (screen.width/2)-(w/2);
            var top = (screen.height/2)-(h/2);
            window.open(puter.defaultGUIOrigin + '/?embedded_in_popup=true&request_auth=true' + (window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''), 
            title, 
            'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);
        })

        // Add the event listener to the window object
        window.addEventListener('message', this.messageListener);    

        // Add event listeners for cancel and close buttons
        this.shadowRoot.querySelector('#launch-auth-popup-cancel')?.addEventListener('click', this.cancelListener);
        this.shadowRoot.querySelector('.close-btn')?.addEventListener('click',this.cancelListener);
    }

    open() {
        if(this.hasUserActivation()){
            let w = 600;
            let h = 400;
            let title = 'Puter';
            var left = (screen.width/2)-(w/2);
            var top = (screen.height/2)-(h/2);
            window.open(puter.defaultGUIOrigin + '/?embedded_in_popup=true&request_auth=true' + (window.crossOriginIsolated ? '&cross_origin_isolated=true' : ''), 
            title, 
            'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);
        }
        else{
            this.shadowRoot.querySelector('dialog').showModal();
        }
    }

    close() {
        this.shadowRoot.querySelector('dialog').close();
    }
}
if (PuterDialog.__proto__  === globalThis.HTMLElement)
    customElements.define('puter-dialog', PuterDialog);

export default PuterDialog;
