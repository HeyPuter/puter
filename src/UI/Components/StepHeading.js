import { Component } from "../../util/Component.js";

/**
 * StepHeading renders a heading with a leading symbol.
 * The leading symbol is styled inside a cricle and is
 * optimized for single-digit numbers.
 */
export default class StepHeading extends Component {
    static PROPERTIES = {
        symbol: {
            description: 'The symbol to display',
            value: '1',
        },
        text: {
            description: 'The heading to display',
            value: 'Heading',
        },
    }

    static CSS = /*css*/`
        .heading {
            display: flex;
            align-items: center;
        }

        .circle {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 25px;
            height: 25px;
            border-radius: 50%;
            background-color: #3e5362;
            color: #FFFFFF;
            font-size: 15px;
            font-weight: 700;
        }

        .text {
            margin-left: 10px;
            font-size: 18px;
            color: hsl(220, 25%, 31%);
            font-weight: 500;
        }
    `

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="heading">
                <div class="circle">
                    ${html_encode(this.get('symbol'))}
                </div>
                <div class="text">
                    ${html_encode(this.get('text'))}
                </div>
            </div>
        `);
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_stepHeading ) {
    window.__component_stepHeading = true;

    customElements.define('c-step-heading', StepHeading);
}
