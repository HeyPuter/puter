import UIWindow from './UIWindow.js'
import Placeholder from "../util/Placeholder.js"

/**
 * @typedef {Object} UIComponentWindowOptions
 * @property {Component} A component to render in the window
 */

/**
 * Render a UIWindow that contains an instance of Component
 * @param {UIComponentWindowOptions} options
 */
export default async function UIComponentWindow (options) {
    const placeholder = Placeholder();

    const win = await UIWindow({
        ...options,

        body_content: placeholder.html,
    });

    options.component.attach(placeholder);
    options.component.focus();

    return win;
}
