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

/**
 * StepHeading renders a heading with a leading symbol.
 * The leading symbol is styled inside a cricle and is
 * optimized for single-digit numbers.
 */
export default def(class StepHeading extends Component {
    static ID = 'ui.component.StepHeading';

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
});
