import { Component } from "../../util/Component.js";

export default class QRCodeView extends Component {
    static PROPERTIES = {
        value: {
            description: 'The text to encode in the QR code',
        }
    }

    static CSS = /*css*/`
        .qr-code {
            width: 100%;
            display: flex;
            justify-content: center;
            flex-direction: column;
            align-items: center;
        }
        .qr-code img {
            width: 150px;
            margin-bottom: 20px;
        }
    `

    create_template ({ template }) {
        $(template).html(`
            <div class="qr-code opt-qr-code">
            </div>
        `);
    }

    on_ready ({ listen }) {
        console.log('QRCodeView on_ready called');
        listen('value', value => {
            console.log('got value', value);
            // $(this.dom_).find('.qr-code').empty();
            new QRCode($(this.dom_).find('.qr-code').get(0), {
                text: value,
                currectLevel: QRCode.CorrectLevel.H,
            });
        });
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_qr_code ) {
    window.__component_qr_code = true;

    customElements.define('c-qr-code', QRCodeView);
}
