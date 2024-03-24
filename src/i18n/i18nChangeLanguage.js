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

function ChangeLanguage(lang) {
    window.locale = lang;
    window.mutate_user_preferences({
        language : lang,
    });

    // -------------------------------------------
            // Get all 'i18n' elements and update their text, title, and data name attributes based on the new language
    // -------------------------------------------

    // find all element with the 'i18n' class to replace their values based on the new translation
    var elements = Array.prototype.slice.call(document.getElementsByClassName('i18n'))

    //iterate over all the elements and change attribute values
    elements.forEach(element => {
        if (element.getAttribute('data-i18n-key') !== undefined && element.getAttribute('data-i18n-key') !== null && element.getAttribute('data-i18n-key') !== ""){
            let i18n_key = element.getAttribute('data-i18n-key');
            let i18n_text = i18n(element.getAttribute('data-i18n-key'), false);

            // if there is no translation for this key, do not proceed
            if (i18n_key === i18n_text)
                return;
            
            // update the inner text of the element based on the new translation
            if (element.innerText !== undefined && element.innerText.trim() !== ""){
                element.innerText = html_encode(i18n_text);
            }

            // if there is a "title" attribute, change the attribute value base on the new translation
            if (element.hasAttribute("title")) {
                element.setAttribute("title", html_encode(i18n_text));
            }

            // if there is a "data-name" attribute, change the attribute value base on the new translation
            if (element.hasAttribute("data-name")) {
                element.setAttribute("data-name", html_encode(i18n_text));
            }
        }
    });
}

export default ChangeLanguage;