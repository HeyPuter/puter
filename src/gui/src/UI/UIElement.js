import { AdvancedBase } from "@heyputer/putility";
import Placeholder from "../util/Placeholder.js";
import UIWindow from "./UIWindow.js";

export default def(class UIElement extends AdvancedBase {
    static ID = 'ui.UIElement';
    static TAG_NAME = 'div';
    
    // === START :: Helpful convenience library ===
    static el = (parent, descriptor, stuff = {}) => {
        descriptor = descriptor ?? 'div';

        const parts = descriptor.split(/(?=[.#])/);
        if ( descriptor.match(/^[.#]/) ) {
            parts.unshift('div');
        }
        parts = parts.map(str => str.trim());

        const el = document.createElement(parts.shift());
        parent && parent.appendChild(el);
        if ( className ) {
            for ( const part of parts ) {
                if ( part.startWith('.') ) {
                    el.classList.add(part.slice(1));
                } else if ( part.startWith('#') ) {
                    el.id = part;
                }
            }
        }
        if ( stuff.text ) {
            el.innerText = stuff.text;
        }
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
        this.make(this);
    }
    
    async open_as_window (options = {}) {
        const placeholder = Placeholder();
        console.log('window options?', this.windowOptions);
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
