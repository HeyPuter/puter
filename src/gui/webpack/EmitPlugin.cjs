/*
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

const fs = require('fs');
const path = require('path');
const uglifyjs = require('uglify-js');
const webpack = require('webpack');

module.exports = async ({ dir, options }) => {
    let prefix_text = '';
    prefix_text += `window.gui_env="${options.env}";\n`;

    // -----------------------------------------------
    // Combine all images into a single js file
    // -----------------------------------------------
    {
        let icons = 'window.icons = [];\n';
        fs.readdirSync(dir).forEach(file => {
            // skip dotfiles
            if (file.startsWith('.'))
                return;
            // load image
            let buff = new Buffer.from(fs.readFileSync(dir + '/' + file));
            // convert to base64
            let base64data = buff.toString('base64');
            // add to `window.icons`
            if (file.endsWith('.png'))
                icons += `window.icons['${file}'] = "data:image/png;base64,${base64data}";\n`;
            else if (file.endsWith('.svg'))
                icons += `window.icons['${file}'] = "data:image/svg+xml;base64,${base64data}";\n`;
        });
        prefix_text += icons + '\n';
    }

    // -----------------------------------------------
    // Concat/merge the JS libraries and save them to ./dist/libs.js
    // -----------------------------------------------
    {
        const lib_paths = require('./libPaths.cjs');
        let js = '';
        for(let i = 0; i < lib_paths.length; i++){
            const file = path.join(__dirname, '../src/lib/', lib_paths[i]);
            // js
            if(file.endsWith('.js') && !file.endsWith('.min.js')){
                let minified_code = await uglifyjs.minify(fs.readFileSync(file).toString(), {mangle: false});
                if(minified_code && minified_code.code){
                    js += minified_code.code;
                    if(options?.verbose)
                        console.log('minified: ', file);
                }
            }else{
                js += fs.readFileSync(file);
                if(options?.verbose)
                    console.log('skipped minification: ', file);
            }

            js += '\n\n\n';
        }
        prefix_text += js;
    }
    
    return new webpack.BannerPlugin({
        banner: prefix_text,
        raw: true,
    });
};
