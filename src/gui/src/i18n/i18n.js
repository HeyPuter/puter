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

import translations from './translations/translations.js';

window.listSupportedLanguages = () => Object.keys(translations).map(lang => translations[lang]);

const variables = {
    docs: "https://docs.puter.com/",
    terms: "https://puter.com/terms",
    privacy: "https://puter.com/privacy"
};

function ReplacePlaceholders(str) {
    str = str.replace(/{{link=(.*?)}}(.*?){{\/link}}/g, (_, key, text) => `<a href="${variables[key]}" target="_blank">${text}</a>`);
    str = str.replace(/{{(.*?)}}/g, (_, key) => variables[key]);
    return str;
}

window.i18n = function (key, replacements = [], encode_html = true) {
    if(Array.isArray(replacements) === false){
        replacements = [replacements];
    }

    let language = translations[window.locale] ?? translations['en'];
    let str = language.dictionary[key] ?? translations['en'].dictionary[key];
    
    if (!str) {
        str = key;
    }
    str = ReplacePlaceholders(str);
    if ( encode_html ) {
        str = html_encode(str);
        // html_encode doesn't render line breaks
        str = str.replace(/\n/g, '<br />');
    }
    // replace %% occurrences with the values in replacements
    // %% is for simple text replacements
    // %strong% is for <strong> tags
    // e.g. "Hello, %strong%" => "Hello, <strong>World</strong>"
    // e.g. "Hello, %%" => "Hello, World"
    // e.g. "Hello, %strong%, %%!" => "Hello, <strong>World</strong>, Universe!"
    for (let i = 0; i < replacements.length; i++) {
        // sanitize the replacement
        replacements[i] = encode_html ? html_encode(replacements[i]) : replacements[i];
        // find first occurrence of %strong%
        let index = str.indexOf('%strong%');
        // find first occurrence of %%
        let index2 = str.indexOf('%%');
        // decide which one to replace
        if (index === -1 && index2 === -1) {
            break;
        } else if (index === -1) {
            str = str.replace('%%', replacements[i]);
        } else if (index2 === -1) {
            str = str.replace('%strong%', '<strong>' + replacements[i] + '</strong>');
        } else if (index < index2) {
            str = str.replace('%strong%', '<strong>' + replacements[i] + '</strong>');
        } else {
            str = str.replace('%%', replacements[i]);
        }
    }
    return str;
}

export default {};