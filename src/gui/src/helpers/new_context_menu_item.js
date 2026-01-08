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

import UIPrompt from '../UI/UIPrompt.js';
import UIAlert from '../UI/UIAlert.js';

/**
 * Returns a context menu item to create a new folder and a variety of file types.
 *
 * @param {string} dirname - The directory path to create the item in
 * @param {HTMLElement} append_to_element - Element to append the new item to
 * @returns {Object} The context menu item object
 */

const new_context_menu_item = function (dirname, append_to_element) {

    const baseItems = [
        // New Folder
        {
            html: i18n('new_folder'),
            icon: `<img src="${html_encode(window.icons['folder.svg'])}" class="ctx-item-icon">`,
            onClick: function () {
                window.create_folder(dirname, append_to_element);
            },
        },
        // divider
        '-',
        // Text Document
        {
            html: i18n('text_document'),
            icon: `<img src="${html_encode(window.icons['file-text.svg'])}" class="ctx-item-icon">`,
            onClick: async function () {
                window.create_file({ dirname: dirname, append_to_element: append_to_element, name: 'New File.txt' });
            },
        },
        // HTML Document
        {
            html: i18n('html_document'),
            icon: `<img src="${html_encode(window.icons['file-html.svg'])}" class="ctx-item-icon">`,
            onClick: async function () {
                window.create_file({ dirname: dirname, append_to_element: append_to_element, name: 'New File.html' });
            },
        },
        // Web Link
        {
            html: 'Web Link',
            icon: `<img src="${html_encode(window.icons['link.svg'])}" class="ctx-item-icon">`,
            onClick: async function () {
                // Prompt user for URL
                const url = await UIPrompt({
                    message: 'Enter the URL for the web link:',
                    placeholder: 'https://example.com',
                    defaultValue: 'https://',
                    validator: (value) => {
                        // Simple URL validation
                        return value.startsWith('http://') || value.startsWith('https://') ?
                            true : 'Please enter a valid URL starting with http:// or https://';
                    },
                });

                if ( url ) {
                    // Extract domain for naming
                    try {
                        const urlObj = new URL(url);
                        const domain = urlObj.hostname;

                        // Extract a simple name from the domain (e.g., "google" from "google.com")
                        let siteName = domain.replace(/^www\./, '');

                        // Further simplify by removing the TLD (.com, .org, etc.)
                        siteName = siteName.split('.')[0];

                        // Capitalize the first letter
                        siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);

                        // Use simple name but keep .weblink extension for the file system
                        let linkName = siteName;
                        let fileName = `${linkName }.weblink`;

                        // Store the URL in a simple JSON object
                        const weblink_content = JSON.stringify({
                            url: url,
                            type: 'weblink',
                            domain: domain,
                            created: Date.now(),
                            modified: Date.now(),
                            version: '2.0',
                            metadata: {
                                originalUrl: url,
                                linkName: linkName,
                                simpleName: siteName,
                            },
                        });

                        // Create the file with standard link icon
                        const item = await window.create_file({
                            dirname: dirname,
                            append_to_element: append_to_element,
                            name: fileName,
                            content: weblink_content,
                            icon: window.icons['link.svg'],
                            type: 'weblink',
                            metadata: JSON.stringify({
                                url: url,
                                domain: domain,
                                timestamp: Date.now(),
                                version: '2.0',
                            }),
                            html_attributes: {
                                'data-weblink': 'true',
                                'data-icon': window.icons['link.svg'],
                                'data-url': url,
                                'data-domain': domain,
                                'data-display-name': linkName,
                                'data-hide-extension': 'true',
                            },
                            force_refresh: true,
                            class: 'weblink-item',
                        });
                    } catch ( error ) {
                        console.error('Error creating web link:', error);
                        UIAlert(`Error creating web link: ${ error.message}`);
                    }
                }
            },
        },
        // JPG Image
        {
            html: i18n('jpeg_image'),
            icon: `<img src="${html_encode(window.icons['file-image.svg'])}" class="ctx-item-icon">`,
            onClick: async function () {
                var canvas = document.createElement('canvas');

                canvas.width = 800;
                canvas.height = 600;

                canvas.toBlob((blob) => {
                    window.create_file({ dirname: dirname, append_to_element: append_to_element, name: 'New Image.jpg', content: blob });
                });
            },
        },
        // Worker
        {
            html: i18n('worker'),
            icon: `<img src="${html_encode(window.icons['file-js.svg'])}" class="ctx-item-icon">`,
            onClick: async function () {
                await window.create_file({
                    dirname: dirname,
                    append_to_element: append_to_element,
                    name: 'New Worker.js',
                    content: `// This is an example application for Puter Workers

router.get('/', ({request}) => {
    return 'Hello World'; // returns a string
});
router.get('/api/hello', ({request}) => {
    return {'msg': 'hello'}; // returns a JSON object    
});
router.get('/*page', ({request, params}) => {
    return new Response(\`Page \${params.page} not found\`, {status: 404});
});
                    `,
                });
            },
        },
    ];

    //Show file_templates on the lower part of "New"
    if ( window.file_templates.length > 0 ) {
        // divider
        baseItems.push('-');

        // User templates
        baseItems.push({
            html: 'User templates',
            icon: `<img src="${html_encode(window.icons['file-template.svg'])}" class="ctx-item-icon">`,
            items: window.file_templates.map(template => ({
                html: template.html,
                icon: `<img src="${html_encode(window.icons[`file-${template.extension}.svg`])}" class="ctx-item-icon">`,
                onClick: async function () {
                    const content = await puter.fs.read(template.path);
                    window.create_file({
                        dirname: dirname,
                        append_to_element: append_to_element,
                        name: template.name,
                        content,
                    });
                },
            })),
        });
    } else {
        // baseItems.push({
        //     html: "No templates found",
        //     icon: `<img src="${html_encode(window.icons['file-template.svg'])}" class="ctx-item-icon">`,
        // });
    }

    //Conditional rendering for the templates
    return {
        html: i18n('new'),
        items: baseItems,
    };
};

export default new_context_menu_item;