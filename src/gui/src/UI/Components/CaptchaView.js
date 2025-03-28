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
 * CaptchaView - A component for displaying and handling captcha challenges
 * 
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.container - The container element to attach the captcha to
 * @param {Function} options.onReady - Callback when the captcha is ready
 * @param {Function} options.onError - Callback for handling errors
 * @param {boolean} options.required - Whether captcha is required (will not display if false)
 * @param {Function} options.onRequiredChange - Callback when the required status changes
 * @returns {Object} - Methods to interact with the captcha
 */
function CaptchaView(options = {}) {
    // Internal state
    const state = {
        token: null,
        image: null,
        answer: '',
        loading: false,
        error: null,
        container: options.container || document.createElement('div'),
        required: options.required !== undefined ? options.required : true, // Default to required
        initialized: false
    };

    // Create the initial DOM structure
    const init = () => {
        const container = state.container;
        container.classList.add('captcha-view-container');
        container.style.marginTop = '20px';
        container.style.marginBottom = '20px';
        
        // Add container CSS
        container.style.display = state.required ? 'flex' : 'none';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        
        state.initialized = true;
        
        // Render the initial HTML
        render();
        
        // Only fetch captcha if required
        if (state.required) {
            refresh();
        }
    };

    // Set whether captcha is required
    const setRequired = (required) => {
        if (state.required === required) return; // No change
        
        state.required = required;
        
        if (state.initialized) {
            // Update display
            state.container.style.display = required ? 'flex' : 'none';
            
            // If becoming required and no captcha loaded, fetch one
            if (required && !state.token) {
                refresh();
            }
            
            // Notify of change if callback provided
            if (typeof options.onRequiredChange === 'function') {
                options.onRequiredChange(required);
            }
        }
    };

    // Render the captcha HTML
    const render = () => {
        const container = state.container;
        
        // Clear the container
        container.innerHTML = '';
        
        // Label
        const label = document.createElement('label');
        label.textContent = i18n('captcha_verification');
        label.setAttribute('for', `captcha-input-${Date.now()}`);
        container.appendChild(label);
        
        // Captcha wrapper
        const captchaWrapper = document.createElement('div');
        captchaWrapper.classList.add('captcha-wrapper');
        captchaWrapper.style.display = 'flex';
        captchaWrapper.style.flexDirection = 'column';
        captchaWrapper.style.gap = '10px';
        container.appendChild(captchaWrapper);
        
        // Captcha image and refresh button container
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.alignItems = 'center';
        imageContainer.style.justifyContent = 'space-between';
        imageContainer.style.gap = '10px';
        imageContainer.style.border = '1px solid #ced7e1';
        imageContainer.style.borderRadius = '4px';
        imageContainer.style.padding = '10px';
        captchaWrapper.appendChild(imageContainer);
        
        // Captcha image
        const imageElement = document.createElement('div');
        imageElement.classList.add('captcha-image');
        
        if (state.loading) {
            imageElement.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:50px;"><span style="font-size:14px;">Loading captcha...</span></div>';
        } else if (state.error) {
            imageElement.innerHTML = `<div style="color:red;padding:10px;">${state.error}</div>`;
        } else if (state.image) {
            imageElement.innerHTML = state.image;
            // Make SVG responsive
            const svgElement = imageElement.querySelector('svg');
            if (svgElement) {
                svgElement.style.width = '100%';
                svgElement.style.height = 'auto';
            }
        } else {
            imageElement.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:50px;"><span style="font-size:14px;">No captcha loaded</span></div>';
        }
        imageContainer.appendChild(imageElement);
        
        // Refresh button
        const refreshButton = document.createElement('button');
        refreshButton.classList.add('button', 'button-small');
        refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
        refreshButton.setAttribute('title', i18n('refresh_captcha'));
        refreshButton.style.minWidth = '30px';
        refreshButton.style.height = '30px';
        refreshButton.setAttribute('type', 'button');
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            refresh();
        });
        imageContainer.appendChild(refreshButton);
        
        // Input field
        const inputField = document.createElement('input');
        inputField.id = `captcha-input-${Date.now()}`;
        inputField.classList.add('captcha-input');
        inputField.type = 'text';
        inputField.placeholder = i18n('enter_captcha_text');
        inputField.setAttribute('autocomplete', 'off');
        inputField.setAttribute('spellcheck', 'false');
        inputField.setAttribute('autocorrect', 'off');
        inputField.setAttribute('autocapitalize', 'off');
        inputField.value = state.answer || '';
        inputField.addEventListener('input', (e) => {
            state.answer = e.target.value;
        });
        
        // Prevent Enter key from triggering refresh and allow it to submit the form
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Don't prevent default here - let Enter bubble up to the form
                // Just make sure we don't refresh the captcha
                e.stopPropagation();
            }
        });
        
        captchaWrapper.appendChild(inputField);
        
        // Helper text
        const helperText = document.createElement('div');
        helperText.classList.add('captcha-helper-text');
        helperText.style.fontSize = '12px';
        helperText.style.color = '#666';
        helperText.textContent = i18n('captcha_case_sensitive');
        captchaWrapper.appendChild(helperText);
    };

    // Fetch a new captcha
    const refresh = async () => {
        // Skip if not required
        if (!state.required) {
            return;
        }
        
        try {
            state.loading = true;
            state.error = null;
            render();
            
            const response = await fetch(window.gui_origin + '/api/captcha/generate');
            
            if (!response.ok) {
                throw new Error(`Failed to load captcha: ${response.status}`);
            }
            
            const data = await response.json();
            
            state.token = data.token;
            state.image = data.image;
            state.loading = false;
            
            render();
            
            if (typeof options.onReady === 'function') {
                options.onReady();
            }
        } catch (error) {
            state.loading = false;
            state.error = error.message || 'Failed to load captcha';
            
            render();
            
            if (typeof options.onError === 'function') {
                options.onError(error);
            }
        }
    };

    // Public API
    const api = {
        /**
         * Get the current captcha token
         * @returns {string} The captcha token
         */
        getToken: () => state.token,
        
        /**
         * Get the current captcha answer
         * @returns {string} The user's answer
         */
        getAnswer: () => state.answer,
        
        /**
         * Reset the captcha - clear answer and get a new challenge
         */
        reset: () => {
            state.answer = '';
            refresh();
        },
        
        /**
         * Get the container element
         * @returns {HTMLElement} The container element
         */
        getElement: () => state.container,
        
        /**
         * Check if captcha is required
         * @returns {boolean} Whether captcha is required
         */
        isRequired: () => state.required,
        
        /**
         * Set whether captcha is required
         * @param {boolean} required - Whether captcha is required
         */
        setRequired: setRequired
    };
    
    // Set initial required state from options
    if (options.required !== undefined) {
        state.required = options.required;
    }
    
    // Initialize the component
    init();
    
    return api;
}

export default CaptchaView; 