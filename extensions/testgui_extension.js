extension.on('puter.gui.addons', async (event) => {
    if ( event.guiParams.app ) {
        const app = event.guiParams.app;
        event.divTagContent = `<div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999999999; background: rgba(0,0,0,0.8); color: white; padding: 20px; overflow: auto;">test: ${ JSON.stringify(app)}</div>`;

    }
});