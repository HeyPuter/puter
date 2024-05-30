import { Component } from "../../util/Component.js";

export default def(class Glyph extends Component {
    static ID = 'ui.component.Glyph';

    static PROPERTIES = {
        size: {
            value: 24,
        },
        codepoint: {
            value: '✅',
        },
    }

    static CSS = `
        div {
            text-align: center;
        }
    `;

    create_template ({ template }) {
        template.innerHTML = /*html*/`
            <div style="font-size: ${this.get('size')}px;">
                ${this.get('codepoint')}
            </div>
        `;
    }
});
