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
 * Returns a context menu item to create a new folder and a variety of file types.
 * 
 * @param {string} dirname - The directory path to create the item in
 * @param {HTMLElement} append_to_element - Element to append the new item to 
 * @returns {Object} The context menu item object
 */

const new_context_menu_item = function(dirname, append_to_element){
    
    const baseItems = [
        // New Folder
        {
            html: i18n('new_folder'),
            icon: `<img src="${html_encode(window.icons['folder.svg'])}" class="ctx-item-icon">`,
            onClick: function() {
                window.create_folder(dirname, append_to_element);
            },
        },
        // divider
        '-',
        // Text Document
        {
            html: i18n('text_document'),
            icon: `<img src="${html_encode(window.icons['file-text.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New File.txt'});
            }
        },
        // HTML Document
        {
            html: i18n('html_document'),
            icon: `<img src="${html_encode(window.icons['file-html.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New File.html'});
            }
        },
        // JPG Image
        {
            html: i18n('jpeg_image'),
            icon: `<img src="${html_encode(window.icons['file-image.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                var canvas = document.createElement("canvas");

                canvas.width = 800;
                canvas.height = 600;

                canvas.toBlob((blob) => {
                    window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New Image.jpg', content: blob});
                });
            }
        },
    ];

    //Show file_templates on the lower part of "New"
    if (window.file_templates.length > 0) {
        // divider
        baseItems.push('-');

        // User templates
        baseItems.push({
            html: "User templates",
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
                }
            }))
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
        items: baseItems
    };
}

export default new_context_menu_item;