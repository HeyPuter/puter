/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

export default def(class NotifCard extends Component {
    static ID = 'ui.component.NotifCard';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        text: { value: 'no text' },
        style: {},
    }

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="settings-card thin-card ${ this.get('style') ? this.get('style') : '' }">
                <div>
                    ${ this.get('text') }
                </div>
            </div>
        `);
    }
});
