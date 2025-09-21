/**
 * Improved PasswordEntry Component for Puter GUI
 * Features:
 *  - DRY: input styles reused from shared CSS class
 *  - Password strength meter (weak/medium/strong)
 *  - Caps Lock warning
 *  - Accessible show/hide toggle button
 */

const Component = use('util.Component');

export default def(class PasswordEntry extends Component {
    static ID = 'ui.component.PasswordEntry';

    static PROPERTIES = {
        spec: {},
        value: {},
        error: {},
        on_submit: {},
        show_password: {},
    }

    static CSS = /*css*/`
        fieldset {
            display: flex;
            flex-direction: column;
        }

        .error-message {
            display: none;
            color: rgb(215 2 2);
            font-size: 14px;
            margin: 10px 0;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid rgb(215 2 2);
            text-align: center;
        }

        .password-and-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .password-and-toggle input {
            flex-grow: 1;
        }

        .strength-meter {
            height: 6px;
            border-radius: 4px;
            margin-top: 6px;
            background: #eee;
            overflow: hidden;
        }

        .strength-bar {
            height: 100%;
            width: 0%;
            transition: width 0.3s;
        }

        .strength-weak   { background: #e74c3c; }
        .strength-medium { background: #f39c12; }
        .strength-strong { background: #2ecc71; }

        .caps-warning {
            display: none;
            font-size: 12px;
            margin-top: 5px;
            color: #e67e22;
        }
    `;

    create_template ({ template }) {
        $(template).html(/*html*/`
            <form>
                <div class="error-message"></div>
                <div class="password-and-toggle">
                    <input type="password" 
                           class="value-input" 
                           id="password" 
                           placeholder="${i18n('password')}" 
                           aria-label="Password"
                           required>
                    <button type="button" id="toggle-show-password" aria-label="Show or hide password">
                        <img src="${window.icons["eye-open.svg"]}" width="20" height="20">
                    </button>
                </div>
                <div class="strength-meter">
                    <div class="strength-bar"></div>
                </div>
                <div class="caps-warning">⚠️ Caps Lock is ON</div>
            </form>
        `);
    }

    on_focus () {
        $(this.dom_).find('input').focus();
    }

    on_ready ({ listen }) {
        const input = $(this.dom_).find('#password');
        const strengthBar = $(this.dom_).find('.strength-bar');
        const capsWarning = $(this.dom_).find('.caps-warning');
        const errorBox = $(this.dom_).find('.error-message');

        // Show errors
        listen('error', (error) => {
            if (!error) return errorBox.hide();
            errorBox.text(error).show();
        });

        // Reset input value if cleared
        listen('value', (value) => {
            if (value === undefined) input.val('');
        });

        // Input listener
        input.on('input', () => {
            const value = input.val();
            this.set('value', value);
            this.updateStrength(value, strengthBar);
        });

        // Caps Lock detection
        input.on('keyup keydown', (e) => {
            const isCaps = e.getModifierState && e.getModifierState('CapsLock');
            capsWarning.toggle(isCaps);
        });

        // Submit on Enter
        const on_submit = this.get('on_submit');
        if (on_submit) {
            input.on('keyup', (e) => {
                if (e.key === 'Enter') on_submit();
            });
        }

        // Toggle password visibility
        $(this.dom_).find('#toggle-show-password').on('click', () => {
            this.set('show_password', !this.get('show_password'));
            const show_password = this.get('show_password');

            input.attr("type", show_password ? "text" : "password");

            const icon = show_password 
                ? window.icons["eye-closed.svg"] 
                : window.icons["eye-open.svg"];
            $(this.dom_).find("#toggle-show-password img").attr("src", icon);
        });
    }

    updateStrength(value, bar) {
        let strength = 0;
        if (value.length > 5) strength++;
        if (/[A-Z]/.test(value)) strength++;
        if (/[0-9]/.test(value)) strength++;
        if (/[^A-Za-z0-9]/.test(value)) strength++;

        let width = "0%";
        let cls = "";

        if (strength === 1) { width = "33%"; cls = "strength-weak"; }
        if (strength === 2) { width = "66%"; cls = "strength-medium"; }
        if (strength >= 3) { width = "100%"; cls = "strength-strong"; }

        bar.removeClass("strength-weak strength-medium strength-strong")
           .addClass(cls)
           .css("width", width);
    }
});
