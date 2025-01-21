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

export default def(class StepView extends Component {
    static ID = 'ui.component.StepView';

    static PROPERTIES = {
        children: {},
        done: { value: false },
        position: { value: 0 },
    }

    static CSS = `
        #wrapper {
            display: none;
            height: 100%;
        }
        * { -webkit-font-smoothing: antialiased;}
    `;

    create_template ({ template }) {
        $(template).html(`
            <div id="wrapper">
                <slot name="inside"></slot>
            </div>
        `);
    }

    on_focus () {
        this.children[this.get('position')].focus();
    }

    on_ready ({ listen }) {
        for ( const child of this.get('children') ) {
            child.setAttribute('slot', 'inside');
            child.attach(this);
            $(child).hide();
        }

        // show the first child
        $(this.children[0]).show();

        // listen for changes to the current step
        listen('position', position => {
            // hide all children
            for ( const child of this.children ) {
                $(child).hide();
            }

            // show the child at the current position
            $(this.children[position]).show();
            this.children[position].focus();
        });

        // now that we're ready, show the wrapper
        $(this.dom_).find('#wrapper').show();
    }
    
    add_child (child) {
        const children = this.get('children');
        let pos = children.length;
        child.setAttribute('slot', 'inside');
        $(child).hide();
        child.attach(this);
        
        return pos;
    }
    
    display (child) {
        const pos = this.add_child(child);
        this.goto(pos);
    }

    back () {
        if ( this.get('position') === 0 ) return;
        this.set('position', this.get('position') - 1);
    }

    next () {
        if ( this.get('position') === this.children.length - 1 ) {
            this.set('done', true);
            return;
        }
        this.set('position', this.get('position') + 1);
    }
    
    goto (pos) {
        this.set('position', pos);
    }
});
