/*
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

import { AdvancedBase } from "@heyputer/putility";
import Placeholder from "../util/Placeholder.js";
import UIWindow from "./UIWindow.js";

export default def(class UIElement extends AdvancedBase {
    static ID = 'ui.UIElement';
    static TAG_NAME = 'div';

    /**
     * Default behavior of UIWindow with no options creates a
     * transparent rectangle at the bottom of the window. These
     * default options will be used to prevent that behavior.
     */
    static DEFAULT_WINDOW_OPTIONS = {
        height: 'auto',
        body_css: {
            width: 'initial',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
            padding: '20px',
        },
    };
    
    // === START :: Helpful convenience library ===
    static el = (...a) => {
        let parent, descriptor; {
            let next = a[0];
            if ( next instanceof HTMLElement ) {
                parent = next;
                a.shift(); next = a[0];
            }
            if ( typeof next === 'string' ) {
                descriptor = next;
                a.shift(); next = a[0];
            }
        }

        descriptor = descriptor ?? 'div';

        let parts = descriptor.split(/(?=[.#])/);
        if ( descriptor.match(/^[.#]/) ) {
            parts.unshift('div');
        }
        parts = parts.map(str => str.trim());

        const el = document.createElement(parts.shift());
        parent && parent.appendChild(el);
        for ( const part of parts ) {
            if ( part.startsWith('.') ) {
                el.classList.add(part.slice(1));
            } else if ( part.startWith('#') ) {
                el.id = part;
            }
        }
        
        const attrs = {};
        for ( const a_or_c of a ) {
            if ( typeof a_or_c === 'string' ) {
                el.innerText += a_or_c;
            }
            else if ( a_or_c instanceof HTMLElement ) {
                el.appendChild(a_or_c);
            } if ( Array.isArray(a_or_c) ) {
                for ( const child of a_or_c ) {
                    el.appendChild(child);
                }
            } else {
                Object.assign(attrs, a_or_c);
            }
        }
        if ( attrs.text ) {
            el.innerText = attrs.text;
        }
        ;['style', 'src'].forEach(attrprop => {
            if ( ! attrs.hasOwnProperty(attrprop) ) return;
            el.setAttribute(attrprop, attrs[attrprop]);
        })
        return el;
    };
    // === END :: Helpful convenient library ===

    constructor ({
        windowOptions,
        tagName,
        css,
        values,
    } = {}) {
        super();

        this.windowOptions = {
            ...(this.constructor.DEFAULT_WINDOW_OPTIONS ?? {}),
            ...(this.constructor.WINDOW_OPTIONS ?? {}),
            ...(windowOptions ?? {}),
        };

        this.tagName = tagName ?? this.constructor.TAG_NAME;
        this.css = css ?? this.constructor.CSS;
        this.values = {
            ...(this.constructor.VALUES ?? {}),
            ...(values ?? {}),
        };
        this.root = document.createElement(this.tagName);

        if ( this.css ) {
            const style = document.createElement('style');
            style.dataset.classname = 
            style.textContent = this.constructor.CSS;
            document.head.appendChild(style);
        }
        if ( ! this.constructor.LAZY_RENDER ) {
            this.make(this);
        }
    }
    
    reinitialize () {
        this.root = document.createElement(this.tagName);
        this.make(this);
        return this.root;
    }
    
    async open_as_window (options = {}) {
        const placeholder = Placeholder();
        let win;
        this.close = () => $(win).close();
        win = await UIWindow({
            ...this.windowOptions,
            ...options,
            body_content: placeholder.html,
        });
        
        placeholder.replaceWith(this.root);
    }
});
