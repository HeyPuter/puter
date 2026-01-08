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

/**
 * Creates a reusable color picker widget using iro.ColorPicker
 * @param {HTMLElement|jQuery} container - Container element for the color picker
 * @param {Object} options - Configuration options
 * @param {string} options.default - Default color in hex format (e.g., "#f00" or "#ff0000ff")
 * @param {Object} options.layout - Custom layout configuration for iro.ColorPicker
 * @param {Function} options.onColorChange - Callback function called when color changes
 * @returns {Object} Color picker instance with methods to interact with it
 */
export function UIColorPickerWidget (container, options = {}) {
    // Get the DOM element if it's a jQuery object
    const domElement = container instanceof HTMLElement
        ? container
        : $(container).get(0);

    if ( ! domElement ) {
        throw new Error('Container element is required');
    }

    // Default layout configuration
    const defaultLayout = [
        {
            component: iro.ui.Box,
            options: {
                layoutDirection: 'horizontal',
                width: 265,
                height: 265,
            },
        },
        {
            component: iro.ui.Slider,
            options: {
                sliderType: 'alpha',
                layoutDirection: 'horizontal',
                height: 265,
                width: 265,
            },
        },
        {
            component: iro.ui.Slider,
            options: {
                sliderType: 'hue',
            },
        },
    ];

    // Initialize the color picker
    const colorPicker = new iro.ColorPicker(domElement, {
        layout: options.layout ?? defaultLayout,
        color: options.default ?? '#f00',
    });

    // Set up color change callback if provided
    if ( options.onColorChange ) {
        colorPicker.on('color:change', (color) => {
            options.onColorChange(color);
        });
    }

    return {
        /**
         * Get the current color
         * @returns {Object} iro.Color object
         */
        getColor: () => colorPicker.color,

        /**
         * Get the current color as hex8 string (includes alpha)
         * @returns {string} Color in hex8 format (e.g., "#ff0000ff")
         */
        getHex8String: () => colorPicker.color.hex8String,

        /**
         * Get the current color as hex string (no alpha)
         * @returns {string} Color in hex format (e.g., "#ff0000")
         */
        getHexString: () => colorPicker.color.hexString,

        /**
         * Get the current color as HSLA object
         * @returns {Object} Object with h, s, l, a properties
         */
        getHSLA: () => {
            const color = colorPicker.color;
            return color.hsla;
        },

        /**
         * Set the color
         * @param {string|Object} color - Color in hex format (e.g., "#f00" or "#ff0000ff") or HSLA object
         */
        setColor: (color) => {
            if ( typeof color === 'string' ) {
                // Remove # if present for matching
                const hexValue = color.startsWith('#') ? color.substring(1) : color;

                // Check if it's a hex8 string (8 hex digits)
                if ( /^[0-9a-fA-F]{8}$/.test(hexValue) ) {
                    // It's a hex8 string, set both hex and alpha
                    const hex6 = `#${ hexValue.substring(0, 6)}`; // Get first 6 hex digits
                    const alphaHex = hexValue.substring(6, 8); // Get last 2 hex digits (alpha)
                    colorPicker.color.hexString = hex6;
                    colorPicker.color.alpha = parseInt(alphaHex, 16) / 255;
                } else {
                    // Regular hex string (with or without #)
                    colorPicker.color.hexString = color.startsWith('#') ? color : `#${ color}`;
                }
            } else if ( typeof color === 'object' && color.h !== undefined ) {
                // HSLA object - set properties directly
                colorPicker.color.hue = color.h;
                colorPicker.color.saturation = color.s;
                colorPicker.color.lightness = color.l;
                colorPicker.color.alpha = color.a !== undefined ? color.a : 1;
            }
        },

        /**
         * Add an event listener
         * @param {string} event - Event name (e.g., 'color:change')
         * @param {Function} callback - Callback function
         */
        on: (event, callback) => {
            colorPicker.on(event, callback);
        },

        /**
         * Remove an event listener
         * @param {string} event - Event name
         * @param {Function} callback - Callback function
         */
        off: (event, callback) => {
            colorPicker.off(event, callback);
        },

        /**
         * Get the underlying iro.ColorPicker instance
         * @returns {iro.ColorPicker} The iro.ColorPicker instance
         */
        getPicker: () => colorPicker,
    };
}

/**
 * Converts HSLA values to hex8 string
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @param {number} a - Alpha (0-1)
 * @returns {string} Color in hex8 format
 */
export function hslaToHex8 (h, s, l, a) {
    // Convert HSL to RGB
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if ( h >= 0 && h < 60 ) {
        r = c; g = x; b = 0;
    } else if ( h >= 60 && h < 120 ) {
        r = x; g = c; b = 0;
    } else if ( h >= 120 && h < 180 ) {
        r = 0; g = c; b = x;
    } else if ( h >= 180 && h < 240 ) {
        r = 0; g = x; b = c;
    } else if ( h >= 240 && h < 300 ) {
        r = x; g = 0; b = c;
    } else if ( h >= 300 && h < 360 ) {
        r = c; g = 0; b = x;
    }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    const alpha = Math.round(a * 255);

    return `#${[r, g, b, alpha].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? `0${ hex}` : hex;
    }).join('')}`;
}

/**
 * Converts hex8 string to HSLA object
 * @param {string} hex8 - Color in hex8 format (e.g., "#ff0000ff")
 * @returns {Object} Object with h, s, l, a properties
 */
export function hex8ToHSLA (hex8) {
    // Remove # if present
    hex8 = hex8.replace('#', '');

    // Parse hex values
    const r = parseInt(hex8.substring(0, 2), 16) / 255;
    const g = parseInt(hex8.substring(2, 4), 16) / 255;
    const b = parseInt(hex8.substring(4, 6), 16) / 255;
    const a = parseInt(hex8.substring(6, 8), 16) / 255;

    // Convert RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if ( max === min ) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch ( max ) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
        a: a,
    };
}
