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

import UIWindow from './UIWindow.js'

async function UIWindowColorPicker(options){
    // set sensible defaults
    if(arguments.length > 0){
        // if first argument is a string, then assume it is the default color
        if(window.isString(arguments[0])){
            options = {};
            options.default = arguments[0];
        }
    }
    options = options ?? {};

    return new Promise(async (resolve) => {
        let colorPicker;

        let h = ``;
        h += `<div>`;
            h += `<div style="padding: 20px; border-bottom: 1px solid #ced7e1; width: 100%; box-sizing: border-box;">`;
                    // picker
                    h += `<div style="padding: 0; margin-bottom: 20px;">`;
                        h += `<div class="picker"></div>`;
                    h += `</div>`;

                    // Select button
                    h += `<button class="select-btn button button-primary button-block button-normal">${i18n('select')}</button>`
                h += `</form>`;
            h += `</div>`;
        h += `</div>`;
        
        const el_window = await UIWindow({
            title: i18n('select_color'),
            app: 'color-picker',
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
            on_close: async ()=>{
                resolve(false)
            },
            onAppend: function(window){
                colorPicker = new iro.ColorPicker($(window).find('.picker').get(0), {
                    layout: [
                        {
                            component: iro.ui.Box,
                            options: {
                                layoutDirection: 'horizontal',
                                width: 265,
                                height: 265,
                            }
                        },
                        {
                            component: iro.ui.Slider,
                            options: {
                                sliderType: 'alpha',
                                layoutDirection: 'horizontal',
                                height: 265,
                                width:265,
                            }
                        },
                        {
                            component: iro.ui.Slider,
                            options: {
                                sliderType: 'hue',
                            }
                        },
                    ],
                    // Set the initial color to pure red
                    color: options.default ?? "#f00",
                });    
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
            resolve({color: colorPicker.color.hex8String});
            $(el_window).close();
        })  
        $(el_window).find('.font-selector').on('click', function(e){
            $(el_window).find('.font-selector').removeClass('font-selector-active');
            $(this).addClass('font-selector-active');
        }) 
    }) 
}

export default UIWindowColorPicker