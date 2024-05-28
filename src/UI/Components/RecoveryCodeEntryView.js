const Component = use('util.Component');

export default def(class RecoveryCodeEntryView extends Component {
    static ID = 'ui.component.RecoveryCodeEntryView';
    static PROPERTIES = {
        value: {},
        length: { value: 8 },
        error: {},
    }

    static CSS = /*css*/`
        fieldset {
            display: flex;
        }
        .recovery-code-input {
            flex-grow: 1;
            box-sizing: border-box;
            height: 50px;
            font-size: 25px;
            text-align: center;
            border-radius: 0.5rem;
            font-family: 'Courier New', Courier, monospace;
        }

        /* TODO: I'd rather not duplicate this */
        .error {
            display: none;
            color: red;
            border: 1px solid red;
            border-radius: 4px;
            padding: 9px;
            margin-bottom: 15px;
            text-align: center;
            font-size: 13px;
        }
        .error-message {
            display: none;
            color: rgb(215 2 2);
            font-size: 14px;
            margin-top: 10px;
            margin-bottom: 10px;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid rgb(215 2 2);
            text-align: center;
        }
    `;

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="recovery-code-entry">
                <form>
                    <div class="error"></div>
                    <fieldset name="recovery-code" style="border: none; padding:0;" data-recovery-code-form>
                        <input type="text" class="recovery-code-input" placeholder="${i18n('login2fa_recovery_placeholder')}" maxlength="${this.get('length')}" required>
                    </fieldset>
                </form>
            </div>
        `);
    }

    on_focus () {
        $(this.dom_).find('input').focus();
    }

    on_ready ({ listen }) {
        listen('error', (error) => {
            if ( ! error ) return $(this.dom_).find('.error').hide();
            $(this.dom_).find('.error').text(error).show();
        });

        listen('value', (value) => {
            // clear input
            if ( value === undefined ) {
                $(this.dom_).find('input').val('');
            }
        });

        const input = $(this.dom_).find('input');
        input.on('input', () => {
            if ( input.val().length === this.get('length') ) {
                this.set('value', input.val());
            }
        });
    }
});
