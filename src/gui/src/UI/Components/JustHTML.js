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
 * Allows using an HTML string as a component.
 */
export default def(class JustHTML extends Component {
    static ID = 'ui.component.JustHTML';

    static PROPERTIES = { html: { value: '' } };
    create_template ({ template }) {
        $(template).html(`<span></span>`);
    }
    on_ready ({ listen }) {
        listen('html', html => {
            $(this.dom_).find('span').html(html);
        });
    }

    _set_dom_based_on_render_mode({ property_values }) {
        if ( property_values.no_shadow ) {
            this.dom_ = this;
            return;
        }

        return super._set_dom_based_on_render_mode();
    }
});
