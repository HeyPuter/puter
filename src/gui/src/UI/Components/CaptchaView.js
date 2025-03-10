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
    };

    // Create the initial DOM structure
    const init = () => {
        const container = state.container;
        container.classList.add('captcha-view-container');
        container.style.marginTop = '20px';
        container.style.marginBottom = '20px';
        
        // Add container CSS
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        
        // Render the initial HTML
        render();
        
        // Fetch the first captcha
        refresh();
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
        refreshButton.addEventListener('click', refresh);
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
        getElement: () => state.container
    };
    
    // Initialize the component
    init();
    
    return api;
}

export default CaptchaView; 