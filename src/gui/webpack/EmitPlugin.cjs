const fs = require('fs');
const path = require('path');
const uglifyjs = require('uglify-js');

module.exports = ({ dir, options }) => function () {
    const compiler = this;
    compiler.hooks.emit.tapAsync('EmitPlugin', async (compilation, callback) => {
        let prefix_text = '';
        prefix_text += 'window.gui_env="dev";\n';

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

        // -----------------------------------------------
        // Webpack understands this code better than I do
        // -----------------------------------------------
        Object.keys(compilation.assets).forEach((assetName) => {
            if (assetName.endsWith('.js')) {
                const asset = compilation.assets[assetName];
                const originalSource = asset.source();
                const newSource = `${prefix_text}\n${originalSource}`;
                compilation.assets[assetName] = {
                    source: () => newSource,
                    size: () => newSource.length,
                };
            }
        });

        console.log('END');
        callback();
    });
};
