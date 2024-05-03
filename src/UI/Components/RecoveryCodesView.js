import { Component } from "../../util/Component.js";

export default class RecoveryCodesView extends Component {
    static PROPERTIES = {
        values: {
            description: 'The recovery codes to display',
        }
    }

    static CSS = /*css*/`
        .recovery-codes {
            border: 1px solid #ccc;
            padding: 20px;
            margin: 20px auto;
            width: 90%;
            max-width: 600px;
            background-color: #f9f9f9;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .recovery-codes h2 {
            text-align: center;
            font-size: 18px;
            color: #333;
            margin-bottom: 15px;
        }

        .recovery-codes-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: 10px; /* Adds space between grid items */
            padding: 0;
        }

        .recovery-code {
            background-color: #fff;
            border: 1px solid #ddd;
            padding: 10px;
            text-align: center;
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            letter-spacing: 1px;
        }
    `


    create_template ({ template }) {
        $(template).html(`
            <div class="recovery-codes">
                <div class="recovery-codes-list">
                </div>
            </div>
        `);
    }

    on_ready ({ listen }) {
        listen('values', values => {
            for ( const value of values ) {
                $(this.dom_).find('.recovery-codes-list').append(`
                    <div class="recovery-code">${html_encode(value)}</div>
                `);
            }
        });
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_recoveryCodesView ) {
    window.__component_recoveryCodesView = true;

    customElements.define('c-recovery-codes-view', RecoveryCodesView);
}
