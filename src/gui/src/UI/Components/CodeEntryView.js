/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const Component = use('util.Component');

export default def(class CodeEntryView extends Component {
    static ID = 'ui.component.CodeEntryView';

    static PROPERTIES = {
        value: {},
        error: {},
        is_checking_code: {},
    };

    static RENDER_MODE = Component.NO_SHADOW;

    static CSS = /*css*/`
        .wrapper {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            color: #3e5362;
        }

        fieldset[name=number-code] {
            display: flex;
            justify-content: space-between;
            gap: 5px;
        }

        .digit-input {
            box-sizing: border-box;
            flex-grow: 1;
            height: 50px;
            font-size: 25px;
            text-align: center;
            border-radius: 0.5rem;
            -moz-appearance: textfield;
            border: 2px solid #9b9b9b;
            color: #485660;
        }

        .digit-input::-webkit-outer-spin-button,
        .digit-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        .confirm-code-hyphen {
            display: inline-block;
            flex-grow: 2;
            text-align: center;
            font-size: 40px;
            font-weight: 300;
        }
    `;

    create_template ({ template }) {
        // TODO: static member for strings
        const submit_btn_txt = i18n('confirm_code_generic_submit');

        $(template).html(/*html*/`
            <div class="wrapper">
                <form>
                    <div class="error"></div>
                    <fieldset name="number-code" style="border: none; padding:0;" data-number-code-form>
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-0' data-number-code-input='0' required />
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-1' data-number-code-input='1' required />
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-2' data-number-code-input='2' required />
                        <span class="confirm-code-hyphen">-</span>
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-3' data-number-code-input='3' required />
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-4' data-number-code-input='4' required />
                        <input class="digit-input" type="number" min='0' max='9' name='number-code-5' data-number-code-input='5' required />
                    </fieldset>
                    <button type="submit" class="button button-block button-primary code-confirm-btn" style="margin-top:10px;" disabled>${
                        submit_btn_txt
                    }</button>
                </form>
            </div>
        `);
    }

    on_focus () {
        $(this.dom_).find('.digit-input').first().focus();
    }

    on_ready ({ listen }) {
        listen('error', (error) => {
            if ( ! error ) return $(this.dom_).find('.error').hide();
            $(this.dom_).find('.error').text(error).show();
        });

        listen('value', value => {
            // clear the inputs
            if ( value === undefined ) {
                $(this.dom_).find('.digit-input').val('');
                return;
            }
        });

        listen('is_checking_code', (is_checking_code, { old_value }) => {
            if ( old_value === is_checking_code ) return;
            if ( old_value === undefined ) return;

            const $button = $(this.dom_).find('.code-confirm-btn');

            if ( is_checking_code ) {
                // set animation
                $button.prop('disabled', true);
                $button.html('<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>');
                return;
            }

            const submit_btn_txt = i18n('confirm_code_generic_try_again');
            $button.html(submit_btn_txt);
            $button.prop('disabled', false);
        });

        const that = this;
        $(this.dom_).find('.code-confirm-btn').on('click submit', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const $button = $(this);

            $button.prop('disabled', true);
            $button.closest('.error').hide();

            that.set('is_checking_code', true);

            // force update to trigger the listener
            that.set('value', that.get('value'));
        });

        // Elements
        const numberCodeForm = this.dom_.querySelector('[data-number-code-form]');
        const numberCodeInputs = [...numberCodeForm.querySelectorAll('[data-number-code-input]')];

        // Event listeners
        numberCodeForm.addEventListener('input', ({ target }) => {
            const inputLength = target.value.length || 0;
            let currentIndex = Number(target.dataset.numberCodeInput);
            if ( inputLength === 2 ) {
                const inputValues = target.value.split('');
                target.value = inputValues[0];
            }
            else if ( inputLength > 1 ) {
                const inputValues = target.value.split('');

                inputValues.forEach((value, valueIndex) => {
                    const nextValueIndex = currentIndex + valueIndex;

                    if ( nextValueIndex >= numberCodeInputs.length ) {
                        return;
                    }

                    numberCodeInputs[nextValueIndex].value = value;
                });
                currentIndex += inputValues.length - 2;
            }

            const nextIndex = currentIndex + 1;

            if ( nextIndex < numberCodeInputs.length ) {
                numberCodeInputs[nextIndex].focus();
            }

            // Concatenate all inputs into one string to create the final code
            let current_code = '';
            for ( let i = 0; i < numberCodeInputs.length; i++ ) {
                current_code += numberCodeInputs[i].value;
            }

            const submit_btn_txt = i18n('confirm_code_generic_submit');
            $(this.dom_).find('.code-confirm-btn').html(submit_btn_txt);

            // Automatically submit if 6 digits entered
            if ( current_code.length === 6 ) {
                $(this.dom_).find('.code-confirm-btn').prop('disabled', false);
                this.set('value', current_code);
                this.set('is_checking_code', true);
            } else {
                $(this.dom_).find('.code-confirm-btn').prop('disabled', true);
            }
        });

        numberCodeForm.addEventListener('keydown', (e) => {
            const { code, target } = e;

            const currentIndex = Number(target.dataset.numberCodeInput);
            const previousIndex = currentIndex - 1;
            const nextIndex = currentIndex + 1;

            const hasPreviousIndex = previousIndex >= 0;
            const hasNextIndex = nextIndex <= numberCodeInputs.length - 1;

            switch ( code ) {
            case 'ArrowLeft':
            case 'ArrowUp':
                if ( hasPreviousIndex ) {
                    numberCodeInputs[previousIndex].focus();
                }
                e.preventDefault();
                break;

            case 'ArrowRight':
            case 'ArrowDown':
                if ( hasNextIndex ) {
                    numberCodeInputs[nextIndex].focus();
                }
                e.preventDefault();
                break;
            case 'Backspace':
                if ( !e.target.value.length && hasPreviousIndex ) {
                    numberCodeInputs[previousIndex].value = null;
                    numberCodeInputs[previousIndex].focus();
                }
                break;
            default:
                break;
            }
        });
    }
});
