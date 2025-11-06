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

import changeLanguage from '../../i18n/i18nChangeLanguage.js';

// About
export default {
    id: 'language',
    title_i18n_key: 'language',
    icon: 'language.svg',
    html: () => {
        const available_languages = window.listSupportedLanguages();
        const languageItems = available_languages.map(lang => `
            <div class="language-item ${window.locale === lang.code ? 'active': ''}" data-lang="${lang.code}" data-english-name="${html_encode(lang.english_name)}">
                ${html_encode(lang.name)}
                <img class="checkmark" src="${window.icons['checkmark.svg']}">
            </div>
        `).join('');

        return `
            <h1 class="settings-section-header">${i18n('language')}</h1>
            <div class="search-container">
                <input type="text" class="search search-language" placeholder="${i18n('search')}">
            </div>
            <div class="language-list">
                ${languageItems}
            </div>
        `;
    },
    init: ($el_window) => {
        $el_window.on('click', '.language-item', function(){
            const $this = $(this);
            const lang = $this.attr('data-lang');
            changeLanguage(lang);
            $this.siblings().removeClass('active');
            $this.addClass('active');
            // make sure all other language items are visible
            $this.closest('.language-list').find('.language-item').show();
        });

        $el_window.on('input', '.search-language', function(){
            const $this = $(this);
            const search = $this.val().toLowerCase();
            const $container = $this.closest('.settings').find('.settings-content-container');
            const $content = $container.find('.settings-content.active');
            const $list = $content.find('.language-list');
            const $items = $list.find('.language-item');
            $items.each(function(){
                const $item = $(this);
                const lang = $item.attr('data-lang');
                const name = $item.text().toLowerCase();
                const english_name = $item.attr('data-english-name').toLowerCase();
                if(name.includes(search) || lang.includes(search) || english_name.includes(search)){
                    $item.show();
                }else{
                    $item.hide();
                }
            })
        });
    },
    on_show: ($content) => {
        // Focus on search
        $content.find('.search').first().focus();
        // make sure all language items are visible
        $content.find('.language-item').show();
        // empty search
        $content.find('.search').val('');
    },
};
