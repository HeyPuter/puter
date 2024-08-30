Multiple things attempted when trying to add icons to the bundle.

None of this worked - eventually just prepended text on emit instead.

```javascript
    // compilation.hooks.processAssets.tap(
    //     {
    //         name: 'AddImportPlugin',
    //         stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
    //     },
    //     (assets) => {
    //         for (const assetName of Object.keys(assets)) {
    //             if (assetName.endsWith('.js')) {
    //                 const source = assets[assetName].source();
    //                 const newSource = `${icons}\n${source}`;
    //                 compilation.updateAsset(assetName, new compiler.webpack.sources.RawSource(newSource));
    //             }
    //         }
    //     }
    // );

    // Inject into bundle
    // console.log('adding this:' + icons);
    // compilation.assets['icons-thing'] = {
    //     source: () => icons,
    //     size: () => icons.length,
    // };

    // compilation.addModule({
    //   identifier() {
    //     return 'icons-thing';
    //   },
    //   build() {
    //     this._source = {
    //       source() {
    //         return content;
    //       },
    //       size() {
    //         return content.length;
    //       }
    //     };
    //   }
    // });


    // Add the generated module to Webpack's internal modules
    // compilation.hooks.optimizeModules.tap('IconsPlugin', (modules) => {
    //     const virtualModule = {
    //     identifier: () => 'icons.js',
    //     readableIdentifier: () => 'icons.js',
    //     build: () => {},
    //     source: () => icons,
    //     size: () => icons.length,
    //     chunks: [],
    //     assets: [],
    //     hash: () => 'icons',
    //     };

    //     modules.push(virtualModule);
    // });

});
// this.hooks.entryOption.tap('IconsPlugin', (context, entry) => {
//     entry.main.import.push('icons-thing');
// });
// this.hooks.make.tapAsync('InjectTextEntryPlugin', (compilation, callback) => {
//     // Create a new asset (fake module) from the generated content
//     const content = `console.log('${this.options.text}');`;

//     callback();
// });
// this.hooks.entryOption.tap('IconsPlugin', (context, entry) => {
// });
// this.hooks.entryOption.tap('InjectTextEntryPlugin', (context, entry) => {
//     // Add this as an additional entry point
//     this.options.entry = {
//       ...this.options.entry,
//       'generated-entry': '// FINDME\n'
//     };
// });
```