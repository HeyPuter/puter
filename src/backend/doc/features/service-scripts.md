> **NOTICE:** This documentation is new and might contain errors.
> Feel free to open a Github issue if you run into any problems.

# Service Scripts

## What is a Service Script?

Service scripts allow backend services to provide client-side code that
runs in Puter's GUI. This is useful if you want to make a mod or plugin
for Puter that has backend functionality. For example, you might want
to add a tab to the settings panel to make use of or configure the service.

Service scripts are made possible by the `puter-homepage` service, which
allows you to register URLs for additional javascript files Puter's
GUI should load.

## ES Modules - A Problem of Ordering

In browsers, script tags with `type=module` implicitly behave according
to those with the `defer` attribute. This means after the DOM is loaded
the scripts will run in the order in which they appear in the document.

Relying on this execution order however does not work. This is because
`import` is implicitly asynchronous. Effectively, this means these
scripts will execute in arbitrary order if they all have imports.

In a situation where all the client-side code is bundled with rollup
or webpack this is not an issue as you typically only have one
entry script. To facilitate loading service scripts, which are not
bundled with the GUI, we require that service scripts call the global
`service_script` function to access the API for service scripts.

## Providing a Service Script

For a service to provide a service script, it simply needs to serve
static files (the "service script") on some URL, and register that
URL with the `puter-homepage` service.

In this example below we use builtin functionality of express to serve
static files.

```javascript
class MyService extends BaseService {
    async _init () {
        // First we tell `puter-homepage` that we're going to be serving
        // a javascript file which we want to be included when the GUI
        // loads.
        const svc_puterHomepage = this.services.get('puter-homepage');
        svc_puterHomepage.register_script('/my-service-script/main.js');
    }

    async ['__on_install.routes'] (_, { app }) {
        // Here we ask express to serve our script. This is made possible
        // by WebServerService which provides the `app` object when it
        // emits the 'install.routes` event.
        app.use('/my-service-script',
            express.static(
                PathBuilder.add(__dirname).add('gui').build()
            )
        );
    }
}
```

## A Simple Service Script



```javascript
import SomeModule from "./SomeModule.js";

service_script(api => {
    api.on_ready(() => {
        // This callback is invoked when the GUI is ready

        // We can use api.get() to import anything exposed to
        // service scripts by Puter's GUI; for example:
        const Button = api.use('ui.components.Button');
        // ^ Here we get Puter's Button component, which is made
        // available to service scripts.
    });
});
```

## Adding a Settings Tab

Starting with the following example: 

```javascript
import MySettingsTab from "./MySettingsTab.js";

globalThis.service_script(api => {
    api.on_ready(() => {
        const svc_settings = globalThis.services.get('settings');
        svc_settings.register_tab(MySettingsTab(api));
    });
});
```

The module **MySettingsTab** exports a function for scoping the `api`
object, and that function returns a settings tab. The settings tab is
an object with a specific format that Puter's settings window understands.

Here are the contents of `MySettingsTab.js`:

```javascript
import MyWindow from "./MyWindow.js";

export default api => ({
    id: 'my-settings-tab',
    title_i18n_key: 'My Settings Tab',
    icon: 'shield.svg',
    factory: () => {
        const NotifCard = api.use('ui.component.NotifCard');
        const ActionCard = api.use('ui.component.ActionCard');
        const JustHTML = api.use('ui.component.JustHTML');
        const Flexer = api.use('ui.component.Flexer');
        const UIAlert = api.use('ui.window.UIAlert');

        // The root component for our settings tab will be a "flexer",
        // which by default displays its child components in a vertical
        // layout.
        const component = new Flexer({
            children: [
                // We can insert raw HTML as a component
                new JustHTML({
                    no_shadow: true, // use CSS for settings window
                    html: '<h1>Some Heading</h1>',
                }),
                new NotifCard({
                    text: 'I am a card with some text',
                    style: 'settings-card-success',
                }),
                new ActionCard({
                    title: 'Open an Alert',
                    button_text: 'Click Me',
                    on_click: async () => {
                        // Here we open an example window
                        await UIAlert({
                            message: 'Hello, Puter!',
                        });
                    }
                })
            ]
        });

        return component;
    }
});
```
