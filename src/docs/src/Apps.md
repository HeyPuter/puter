The Apps API allows you to create, manage, and interact with applications in the Puter ecosystem. You can build and deploy applications that integrate seamlessly with Puter's platform.

<h2 style="margin-top: 60px;">Examples</h2>
<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="create"><span>Create App</span></div>
     <div class="example-group" data-section="list"><span>List App</span></div>
    <div class="example-group" data-section="delete"><span>Delete App</span></div>
    <div class="example-group" data-section="update"><span>Update App</span></div>
    <div class="example-group" data-section="get"><span>Get Information</span></div>

</div>

<div class="example-content" data-section="create" style="display:block;">

#### Create an app pointing to example.com

```html;app-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name
            let appName = puter.randName();

            // (2) Create the app and prints its UID to the page
            let app = await puter.apps.create(appName, "https://example.com");
            puter.print(`Created app "${app.name}". UID: ${app.uid}`);

            // (3) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="list">

#### Create 3 random apps and then list them

```html;app-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate 3 random app names
            let appName_1 = puter.randName();
            let appName_2 = puter.randName();
            let appName_3 = puter.randName();

            // (2) Create 3 apps
            await puter.apps.create(appName_1, 'https://example.com');
            await puter.apps.create(appName_2, 'https://example.com');
            await puter.apps.create(appName_3, 'https://example.com');

            // (3) Get all apps (list)
            let apps = await puter.apps.list();

            // (4) Display the names of the apps
            puter.print(JSON.stringify(apps.map(app => app.name)));

            // (5) Delete the 3 apps we created earlier (cleanup)
            await puter.apps.delete(appName_1);
            await puter.apps.delete(appName_2);
            await puter.apps.delete(appName_3);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="delete">

#### Create a random app then delete it

```html;app-delete
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name to make sure it doesn't already exist
            let appName = puter.randName();

            // (2) Create the app
            await puter.apps.create(appName, "https://example.com");
            puter.print(`"${appName}" created<br>`);

            // (3) Delete the app
            await puter.apps.delete(appName);
            puter.print(`"${appName}" deleted<br>`);

            // (4) Try to retrieve the app (should fail)
            puter.print(`Trying to retrieve "${appName}"...<br>`);
            try {
                await puter.apps.get(appName);
            } catch (e) {
                puter.print(`"${appName}" could not be retrieved<br>`);
            }
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="update">

#### Create a random app then change its title

```html;app-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random app
            let appName = puter.randName();
            await puter.apps.create(appName, "https://example.com")
            puter.print(`"${appName}" created<br>`);

            // (2) Update the app
            let updated_app = await puter.apps.update(appName, {title: "My Updated Test App!"})
            puter.print(`Changed title to "${updated_app.title}"<br>`);

            // (3) Delete the app (cleanup)
            await puter.apps.delete(appName)
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="get">

#### Create a random app then get it

```html;app-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name to make sure it doesn't already exist
            let appName = puter.randName();

            // (2) Create the app
            await puter.apps.create(appName, "https://example.com");
            puter.print(`"${appName}" created<br>`);

            // (3) Retrieve the app using get()
            let app = await puter.apps.get(appName);
            puter.print(`"${appName}" retrieved using get(): id: ${app.uid}<br>`);

            // (4) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```

</div>

## Functions

These Apps API are supported out of the box when using Puter.js:

- **[`puter.apps.create()`](/Apps/create/)** - Create a new application
- **[`puter.apps.list()`](/Apps/list/)** - List all applications
- **[`puter.apps.delete()`](/Apps/delete/)** - Delete an application
- **[`puter.apps.update()`](/Apps/update/)** - Update application settings
- **[`puter.apps.get()`](/Apps/get/)** - Get information about a specific application

## Examples

You can see various Puter.js Apps API in action from the following examples:

- Create
  - [Create an app pointing to https://example.com](/playground/?example=app-create)
- List
  - [Create 3 random apps and then list them](/playground/?example=app-list)
- Delete
  - [Create a random app then delete it](/playground/?example=app-delete)
- Update
  - [Create a random app then change its title](/playground/?example=app-update)
- Get
  - [Create a random app then get it](/playground/?example=app-get)
- Sample Apps
  - [To-Do List](/playground/?example=app-todo)
  - [AI Chat](/playground/?example=app-ai-chat)
  - [Camera Photo Describer](/playground/?example=app-camera)
  - [Text Summarizer](/playground/?example=app-summarizer)
