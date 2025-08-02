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

import UIWindow from './UIWindow.js'

let fontAvailable = new Set();
const font_list = new Set([
    // Windows 10
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'HoloLens MDL2 Assets', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Historic', 'Segoe UI Emoji', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
    // macOS
    'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS', 'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps', 'Bradley Hand', 'Brush Script MT', 'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New', 'Didot', 'DIN Alternate', 'DIN Condensed', 'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Luminari', 'Marker Felt', 'Menlo', 'Microsoft Sans Serif', 'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET', 'SignPainter', 'Skia', 'Snell Roundhand', 'Tahoma', 'Times', 'Times New Roman', 'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino',
].sort());

// filter through available system fonts
(async () => {
    await document.fonts.ready;

    for (const font of font_list.values()) {
        if (document.fonts.check(`12px "${font}"`)) {
            fontAvailable.add(font);
        }
    }
})();

async function UIWindowFontPicker(options){
    // set sensible defaults
    if(arguments.length > 0){
        // if first argument is a string, then assume it is the default color
        if(window.isString(arguments[0])){
            options = {};
            options.default = arguments[0];
        }
    }
    options = options || {};

    return new Promise(async (resolve) => {
        let h = ``;
        h += `<div>`;
            h += `<div style="padding: 20px; border-bottom: 1px solid #ced7e1; width: 100%; box-sizing: border-box;">`;
                    h += `<div class="font-list" style="margin-bottom: 10px; height: 200px; overflow-y: scroll; background-color: white; padding: 0 10px;">`;
                        fontAvailable.forEach(element => {
                            h += `<p class="font-selector disable-user-select ${options.default === element ? 'font-selector-active' : ''}" style="font-family: '${html_encode(element)}';" data-font-family="${html_encode(element)}">${html_encode(element)}</p>`; // 👉️ one, two, three, four
                        });
                    h += `</div>`;

                    // Select
                    h += `<button class="select-btn button button-primary button-block button-normal">${i18n('select')}</button>`
                h += `</form>`;
            h += `</div>`;
        h += `</div>`;
        
        const el_window = await UIWindow({
            title: i18n('window_title_select_font'),
            app: 'font-picker',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            ...options.window_options,
            width: 350,
            dominant: true,
            on_close: ()=>{
                resolve(false)
            },
            onAppend: function(window){
                let active_font = $(window).find('.font-selector-active');
                if(active_font.length > 0){
                    window.scrollParentToChild($(window).find('.font-list').get(0), active_font.get(0));
                }
            },
            window_class: 'window-login',
            window_css:{
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }    
        })

        $(el_window).find('.select-btn').on('click', function(e){
            resolve({fontFamily: $(el_window).find('.font-selector-active').attr('data-font-family')});
            $(el_window).close();
        })  
        $(el_window).find('.font-selector').on('click', function(e){
            $(el_window).find('.font-selector').removeClass('font-selector-active');
            $(this).addClass('font-selector-active');
        }) 
    }) 
}

export default UIWindowFontPicker