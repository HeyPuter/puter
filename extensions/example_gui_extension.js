extension.on('puter.gui.addons', async (event) => {
    if ( event.guiParams.app ) {
        // disabled for now
        // const app = event.guiParams.app;
        // event.bodyContent += `
        // <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999999999; background: rgba(0,0,0,0.8); color: white; padding: 20px; overflow: auto;">
        //     test: ${ JSON.stringify(app)}
        // </div>`;
        // event.headContent += `<meta name="description" content="some additional description"/>`
        // event.headContent += `<script> console.log("test1234"); </script>`
    }
});