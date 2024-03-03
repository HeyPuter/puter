# Puter in Production

## Building
    
```bash
npm run build
```

## Usage

Will build Puter in the `dist` directory. Include the generated `./dist/gui.js` file in your HTML page and call `gui()` when the page is loaded:

```html
<script type="text/javascript" src="./dist/gui.js"></script>
<script type="text/javascript">
    window.addEventListener('load', function() {
        // Initialize the GUI. All options are optional!
        gui({
            // The origin of the app. This is the base URL of the GUI. 
            gui_origin: "https://puter.com",

            // The origin of the API. This is the base URL of the API endpoints that the GUI will call for all its operations.
            api_origin: "https://api.puter.com",

            // The domain under which user websites are hosted.
            hosting_domain: "puter.site",

            // The maximum length of file/directory names.
            max_item_name_length: 500,

            // If GUI has to enforce email verification before allowing user to publish a website.
            require_email_verification_to_publish_website: true,
        })
    });
</script>
```

## Full Production Example

Assuming the following directory structure in production:

```
.
├── dist/
│   ├── favicons/
│   ├── images/
│   ├── bundle.min.css
│   ├── bundle.min.js
│   ├── gui.js
│   └── ...
└── index.html
```

The `index.html` file below will load Puter and all the necessary meta tags, favicons, and branding assets:

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <title>Puter</title>
    <meta name="author" content="Puter Technologies Inc.">
    <meta name="description" content="Puter is a privacy-first personal cloud to keep all your files, apps, and games in one private and secure place, accessible from anywhere at any time.">
    <meta name="facebook-domain-verification" content="e29w3hjbnnnypf4kzk2cewcdaxym1y" />
    <link rel="canonical" href="https://puter.com">

    <!-- Meta meta tags -->
    <meta property="og:url" content="https://puter.com">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Puter">
    <meta property="og:description" content="Puter is a privacy-first personal cloud to keep all your files, apps, and games in one private and secure place, accessible from anywhere at any time.">
    <meta property="og:image" content="./dist/images/screenshot.png">

    <!-- Twitter meta tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta property="twitter:domain" content="puter.com">
    <meta property="twitter:url" content="https://puter.com">
    <meta name="twitter:title" content="Puter">
    <meta name="twitter:description" content="Puter is a privacy-first personal cloud to keep all your files, apps, and games in one private and secure place, accessible from anywhere at any time.">
    <meta name="twitter:image" content="./dist/images/screenshot.png">

    <!-- favicons -->
    <link rel="apple-touch-icon" sizes="57x57" href="./dist/favicons/apple-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="./dist/favicons/apple-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="./dist/favicons/apple-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="./dist/favicons/apple-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="./dist/favicons/apple-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="./dist/favicons/apple-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="./dist/favicons/apple-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="./dist/favicons/apple-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="./dist/favicons/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192"  href="./dist/favicons/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="./dist/favicons/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="./dist/favicons/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="./dist/favicons/favicon-16x16.png">
    <link rel="manifest" href="./dist/manifest.json">
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="msapplication-TileImage" content="./dist/favicons/ms-icon-144x144.png">
    <meta name="theme-color" content="#ffffff">

    <!-- Preload images when applicable -->
    <link rel="preload" as="image" href="./dist/images/wallpaper.webp">
</head>

<body>
    <!-- Load the GUI script -->
    <script type="text/javascript" src="./dist/gui.js"></script>    
    <!-- Initialize GUI when document is loaded -->
    <script type="text/javascript">
    window.addEventListener('load', function() {
        gui()
    });
    </script>
</body>

</html>
```

### Server settings

The GUI is a single page application (SPA) and as best practice any route under root (`/*`) should preferably load the `index.html` file. However, there are situations where we want to load a custom page for a specific route: for example, the `/privacy` route may need to load a page that contains your privacy policy and has nothing to do with the GUI application. In these cases it is ok to load a custom page as long as the following essential GUI routes are loaded with the GUI (i.e. `index.html` file):
- `/app/*`
- `/action/*`

In other words, consider the routes above as "reserved" for Puter.

### Best Practices

- The `title` tags and meta tags (`<title></title>`, `<meta property="og:title"`, `<meta name="twitter:title"`, ...) should be dynamically set by the server. For example, if the URL is of an app (e.g. `https://puter.com/app/editor`) the `title` tags and meta tags should contain the app's title rather than the generic Puter title.

- The `description` meta tags (`<meta name="description"`, `<meta property="og:description"`, `<meta name="twitter:description"`, ...) should be dynamically set by the server. For example, if the URL is of an app (e.g. `https://puter.com/app/editor`) the `description` meta tags should contain the app's description rather than the generic Puter description.

- Make sure to escape any HTML code that is dynamically added to the HTML page. For example, if the app's description is `Puter is a <b>privacy-first</b> personal cloud to keep all your files, apps, and games in one private and secure place, accessible from anywhere at any time.` the `<b>` tag should be escaped to `&lt;b&gt;` so that the browser doesn't interpret it as an HTML tag.

- Make sure to replace all new line characters with space when dynamically adding text to the HTML page.

- Generally, for UX and SEO reasons make sure that the tags are filled with relevant information about the state the URL is representing. E.g. is the user on the desktop or an app?
