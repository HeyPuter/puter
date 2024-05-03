import { Component } from "../../util/Component.js";

/**
 * Display a list of checkboxes for the user to confirm.
 */
export default class ConfirmationsView extends Component {
    static PROPERTIES = {
        confirmations: {
            description: 'The list of confirmations to display',
        },
        confirmed: {
            description: 'True iff all confirmations are checked',
        },
    }

    static CSS = /*css*/`
        .confirmations {
            display: flex;
            flex-direction: column;
        }
        .looks-good {
            margin-top: 20px;
            color: hsl(220, 25%, 31%);
            font-size: 20px;
            font-weight: 700;
            display: none;
        }
    `

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="confirmations">
                ${
                    this.get('confirmations').map((confirmation, index) => {
                        return /*html*/`
                            <div>
                                <input type="checkbox" id="confirmation-${index}" name="confirmation-${index}">
                                <label for="confirmation-${index}">${confirmation}</label>
                            </div>
                        `;
                    }).join('')
                }
                <span class="looks-good">Looks good!</span>
            </div>
        `);
    }

    on_ready ({ listen }) {
        // update `confirmed` property when checkboxes are checked
        $(this.dom_).find('input').on('change', () => {
            this.set('confirmed', $(this.dom_).find('input').toArray().every(input => input.checked));
            if ( this.get('confirmed') ) {
                $(this.dom_).find('.looks-good').show();
            } else {
                $(this.dom_).find('.looks-good').hide();
            }
        });
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_confirmationsView ) {
    window.__component_confirmationsView = true;

    customElements.define('c-confirmations-view', ConfirmationsView);
}
