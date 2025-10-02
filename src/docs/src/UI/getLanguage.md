Retrieves the current language/locale code from the Puter environment. This function communicates with the host environment to get the active language setting.

## Syntax
```js
puter.ui.getLanguage()
```

## Parameters

This function takes no parameters.

## Return value 
A `Promise` that resolves to a string containing the current language code (e.g., `en`, `fr`, `es`, `de`).

## Examples
```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Get the current language
        puter.ui.getLanguage().then((language) => {
            console.log('Current language:', language);
            // Output: "Current language: fr" (if French is selected)
        });

        // Using async/await syntax
        async function displayLanguage() {
            const currentLang = await puter.ui.getLanguage();
            document.body.innerHTML = `<h1>Current language: ${currentLang}</h1>`;
        }
        
        displayLanguage();

        // Listen for language changes and update accordingly
        puter.ui.on('localeChanged', async (data) => {
            console.log('Language changed to:', data.language);
            const updatedLang = await puter.ui.getLanguage();
            console.log('Confirmed current language:', updatedLang);
        });
    </script>
</body>
</html>
```