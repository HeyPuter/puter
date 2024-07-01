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

window.puter_gui_enabled = true;

/**
 * Initializes and configures the GUI (Graphical User Interface) settings based on the provided options.
 *
 * The function sets global variables in the window object for various settings such as origins and domain names.
 * It also handles loading different resources depending on the environment (development or production).
 *
 * @param {Object} options - Configuration options to initialize the GUI.
 * @param {string} [options.gui_origin='https://puter.com'] - The origin URL for the GUI.
 * @param {string} [options.api_origin='https://api.puter.com'] - The origin URL for the API.
 * @param {number} [options.max_item_name_length=500] - Maximum allowed length for an item name.
 * @param {boolean} [options.require_email_verification_to_publish_website=true] - Flag to decide whether email verification is required to publish a website.
 *
 * @property {string} [options.app_domain] - Extracted domain name from gui_origin. It's derived automatically if not provided.
 * @property {string} [window.gui_env] - The environment in which the GUI is running (e.g., "dev" or "prod").
 *
 * @returns {Promise<void>} Returns a promise that resolves when initialization and resource loading are complete.
 *
 * @example
 * window.gui({
 *     gui_origin: 'https://myapp.com',
 *     api_origin: 'https://myapi.com',
 *     max_item_name_length: 250
 * });
 */

window.gui = async function(options){
    options = options ?? {};
    // app_origin is deprecated, use gui_origin instead
    window.gui_origin = options.gui_origin ?? options.app_origin ?? `https://puter.com`;
    window.app_domain = options.app_domain ?? new URL(window.gui_origin).hostname;
    window.hosting_domain = options.hosting_domain ?? 'puter.site';
    window.api_origin = options.api_origin ?? "https://api.puter.com";
    window.max_item_name_length = options.max_item_name_length ?? 500;
    window.require_email_verification_to_publish_website = options.require_email_verification_to_publish_website ?? true;

    // DEV: Load the initgui.js file if we are in development mode
    if(!window.gui_env || window.gui_env === "dev"){
        await window.loadScript('/sdk/puter.dev.js');
        await window.loadScript(`${options.asset_dir}/initgui.js`, {isModule: true});
    }

    // PROD: load the minified bundles if we are in production mode
    // note: the order of the bundles is important
    // note: Build script will prepend `window.gui_env="prod"` to the top of the file
    else if(window.gui_env === "prod"){
        await window.loadScript('https://js.puter.com/v2/');
        // Load the minified bundles
        await window.loadCSS('/dist/bundle.min.css');
        await window.loadScript('/dist/bundle.min.js');
    }

    // 🚀 Launch the GUI 🚀
    window.initgui(options);
}

/**
* Dynamically loads an external JavaScript file.
* @param {string} url The URL of the external script to load.
* @param {Object} [options] Optional configuration for the script.
* @param {boolean} [options.isModule] Whether the script is a module.
* @param {boolean} [options.defer] Whether the script should be deferred.
* @param {Object} [options.dataAttributes] An object containing data attributes to add to the script element.
* @returns {Promise} A promise that resolves once the script has loaded, or rejects on error.
*/
window.loadScript = async function(url, options = {}) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;

        // Set default script loading behavior
        script.async = true;

        // Handle if it is a module
        if (options.isModule) {
            script.type = 'module';
        }

        // Handle defer attribute
        if (options.defer) {
            script.defer = true;
            script.async = false; // When "defer" is true, "async" should be false as they are mutually exclusive
        }

        // Add arbitrary data attributes
        if (options.dataAttributes && typeof options.dataAttributes === 'object') {
            for (const [key, value] of Object.entries(options.dataAttributes)) {
                script.setAttribute(`data-${key}`, value);
            }
        }

        // Resolve the promise when the script is loaded
        script.onload = () => resolve();

        // Reject the promise if there's an error during load
        script.onerror = (error) => reject(new Error(`Failed to load script at url: ${url}`));

        // Append the script to the body
        document.body.appendChild(script);
    });
};

/**
* Dynamically loads an external CSS file.
* @param {string} url The URL of the external CSS to load.
* @returns {Promise} A promise that resolves once the CSS has loaded, or rejects on error.
*/
window.loadCSS = async function(url) {
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;

        link.onload = () => {
            resolve();
        };

        link.onerror = (error) => {
            reject(new Error(`Failed to load CSS at url: ${url}`));
        };

        document.head.appendChild(link);
    });
}
console.log( "%c⚠️Warning⚠️\n%cPlease refrain from adding or pasting any sort of code here, as doing so could potentially compromise your account. \nYou don't get what you intended anyway, but the hacker will! \n\n%cFor further information please visit https://developer.chrome.com/blog/self-xss",
    "color:red; font-size:2rem; display:block; margin-left:0; margin-bottom: 20px; background: black; width: 100%; margin-top:20px; font-family: 'Helvetica Neue', HelveticaNeue, Helvetica, Arial, sans-serif;",
    "font-size:1rem; font-family: 'Helvetica Neue', HelveticaNeue, Helvetica, Arial, sans-serif;",
    "font-size:0.9rem; font-family: 'Helvetica Neue', HelveticaNeue, Helvetica, Arial, sans-serif;",
);
