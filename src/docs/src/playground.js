const fs = require('fs');
const path = require('path');
const examples = require('./examples');

// Function to generate sidebar HTML
const generateSidebarHtml = (sections) => {
    let sidebarHtml = '<div class="sidebar-content">';

    sections.forEach(section => {
        sidebarHtml += `<div class="sidebar-category" data-category="${section.title.toLowerCase()}">`;
        sidebarHtml += `<div class="sidebar-category-title">${section.title}</div>`;
        section.children.forEach(example => {
            sidebarHtml += `<a href="/playground/${example.slug ? `${example.slug }/` : ''}" class="sidebar-item" data-title="${example.title.toLowerCase()}">${example.title}</a>`;
        });
        sidebarHtml += '</div>';
    });

    sidebarHtml += '</div>';
    sidebarHtml += '<div class="sidebar-no-results">No examples found</div>';
    return sidebarHtml;
};

const playgroundHtml = `
<html>

<head>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css"
        integrity="sha512-NhSC1YmyruXifcj/KFRWoC561YpHpc5Jtzgvbuzx5VozKpWvQ+4nXhPdFgmx8xqexRcpAglTj9sIBWINXa8x5w=="
        crossorigin="anonymous" referrerpolicy="no-referrer" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Roboto:black,bold,medium,regular,light,thin" rel="stylesheet">
    <title>{{TITLE}}</title>
    <meta name="title" content="{{TITLE}}" />
    <meta name="description" content="{{DESCRIPTION}}" />

    <link rel="canonical" href="{{CANONICAL}}">

    <meta property="og:title" content="{{TITLE}}">
    <meta property="og:description" content="{{DESCRIPTION}}" />
    <meta property="og:type" content="website" />
    <meta name="og:image" content="https://assets.puter.site/twitter.png">
    <meta name="og:url" content="{{CANONICAL}}">

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@HeyPuter" />
    <meta name="twitter:title" content="{{TITLE}}">
    <meta name="twitter:description" content="{{DESCRIPTION}}" />
    <meta name="twitter:image" content="https://assets.puter.site/twitter.png">

    <link rel="apple-touch-icon" sizes="57x57" href="/assets/favicon/apple-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="/assets/favicon/apple-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="/assets/favicon/apple-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="/assets/favicon/apple-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="/assets/favicon/apple-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="/assets/favicon/apple-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="/assets/favicon/apple-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="/assets/favicon/apple-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png">
    <link rel="manifest" href="/assets/favicon/manifest.json">
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="msapplication-TileImage" content="/assets/favicon/ms-icon-144x144.png">
    <meta name="theme-color" content="#ffffff">
    <script defer data-domain="docs.puter.com" src="https://plausible.io/js/script.js"></script>
    <script type="text/javascript">
        (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            c[a]("identify", (sessionStorage.cid ??= crypto.randomUUID()));
        })(window, document, "clarity", "script", "ubxybtas0w");
    </script>
    <link rel="stylesheet" href="/playground/assets/css/style.css">
</head>

<body>
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"
        integrity="sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=" crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js"
        integrity="sha512-ZG31AN9z/CQD1YDDAK4RUAvogwbJHv6bHrumrnMLzdCrVu4HeAqrUX7Jsal/cbUwXGfaMUNmQU04tQ8XXl5Znw=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://js.puter.com/v2/"></script>

    <div style="height: 50px; padding: 10px; background-color: #474e5d; display: flex; flex-direction: row;">
        <h1 class="logo"><a href="/playground/">Puter.js Playground</a></h1>
        <div style="float:right;" class="navbar">
            <a href="/" target="_blank" style="margin-right: 35px;">Docs</a>
            <a style="display: flex; flex-direction: row; align-items: center;"
                href="https://github.com/heyPuter/puter/" target="_blank"><svg role="img"
                    style="margin-right:4px; margin-bottom: 3px;" width="17" height="17" viewBox="0 0 24 24" fill="#fff"
                    xmlns="http://www.w3.org/2000/svg">
                    <title>GitHub</title>
                    <path
                        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg><span class="github-stars"></span></a></h1>
        </div>
    </div>

    <div class="main-container">
        <!-- Sidebar -->
        <div id="sidebar-container">
            <div class="sidebar-header">
                <button class="sidebar-toggle" id="sidebar-toggle">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-menu-icon lucide-menu"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>
                </button>
                <span class="sidebar-title">Examples</span>
            </div>
            <div class="sidebar-search">
                <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" id="sidebar-search-input" placeholder="Search examples..." autocomplete="off" />
            </div>
            <div class="sidebar">
                {{SIDEBAR}}
            </div>
        </div>

        <div style="display: flex; flex-direction: row; width: 100%;">
            <!-- Code Container -->
            <div id="code-container">
                <div style="overflow: hidden; height: 50px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; background: #fff; border-bottom: 1px solid #CCC;">
                    <span style="user-select: none; margin:0; float:left; font-size: 20px; padding: 10px; flex-grow:1;">Code</span>
                </div>
                <div id="code" style="width: 100%; height: 100%;"></div>
            </div>
                
            <!-- Resizer -->
            <div class="resizer"></div>

            <!-- Output Container -->
            <div id="output-container">
                <div style="overflow: hidden; height: 50px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; background: #fff; border-bottom: 1px solid #CCC;">
                    <span style="user-select: none; margin:0; float:left; font-size: 20px; padding: 10px; flex-grow: 1;">Preview</span>
                    <button id="run"><span></span>Run</button>
                </div>
                <div id="output" style="width: 100%; height: 100%;"></div>
            </div>
        </div>
    </div>
    <iframe id="initial-code" style="display:none;">{{CODE}}</iframe>
    <script src="/playground/assets/js/app.js"></script>
</body>

</html>`;

const generatePlayground = () => {
    // Generate sidebar HTML once for all examples
    const sidebarHtml = generateSidebarHtml(examples);

    let totalExamples = 0;

    examples.forEach(section => {
        section.children.forEach(example => {
            // Read source file from src/ directory
            const sourcePath = path.join('src', example.source);
            const sourceContent = fs.readFileSync(sourcePath, 'utf8');

            // Copy playgroundHtml to avoid tainting the original
            let htmlTemplate = playgroundHtml.slice();

            htmlTemplate = htmlTemplate.replace('{{SIDEBAR}}', sidebarHtml);
            const pageTitle = example.slug === '' ? 'Puter.js Playground' : `${example.title} | Puter.js Playground`;
            htmlTemplate = htmlTemplate.replaceAll('{{TITLE}}', pageTitle);
            const pageDescription = example.description || 'Try Puter.js instantly with interactive examples in your browser. Run, edit, and experiment with code - no installation or setup required.';
            htmlTemplate = htmlTemplate.replaceAll('{{DESCRIPTION}}', pageDescription);
            const canonicalUrl = `https://docs.puter.com/playground/${example.slug ? `${example.slug }/` : ''}`;
            htmlTemplate = htmlTemplate.replaceAll('{{CANONICAL}}', canonicalUrl);
            const finalHtml = htmlTemplate.replace('{{CODE}}', sourceContent);

            // Create output directory
            const outputDir = path.join('dist', 'playground', example.slug);
            fs.mkdirSync(outputDir, { recursive: true });

            // Write the file
            const outputPath = path.join(outputDir, 'index.html');
            fs.writeFileSync(outputPath, finalHtml, 'utf8');

            totalExamples++;
        });
    });
    console.log(`Generated ${totalExamples} playground examples.`);
};

module.exports = { generatePlayground };
