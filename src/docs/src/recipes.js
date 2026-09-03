const fs = require('fs-extra');
const path = require('path');
const marked = require('marked');
const esbuild = require('esbuild');
const { encode } = require('html-entities');
const { parseFrontMatter } = require('./frontmatter');
const recipeTags = require('./recipe-tags');

const site = 'https://docs.puter.com';


const RECIPES_SRC_DIR = path.join('src', 'recipes');
const RECIPES_DIST_DIR = path.join('dist', 'recipes');

// Shared <head> boilerplate. This mirrors the block in build.js and
// playground.js — the three generators each carry their own copy rather than
// sharing a partial, since there is no template layer in this build.
const headHTML = `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}}</title>
    <meta name="title" content="{{TITLE}}" />
    <meta name="description" content="{{DESCRIPTION}}" />
    <link rel="canonical" href="{{CANONICAL}}">
    <meta name="robots" content="index, follow" />

    <meta property="og:site_name" content="Puter.js Docs" />
    <meta property="og:title" content="{{TITLE}}">
    <meta property="og:description" content="{{DESCRIPTION}}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="https://assets.puter.site/twitter.png">
    <meta property="og:url" content="{{CANONICAL}}">

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@HeyPuter" />
    <meta name="twitter:title" content="{{TITLE}}">
    <meta name="twitter:description" content="{{DESCRIPTION}}" />
    <meta name="twitter:image" content="https://assets.puter.site/twitter.png">

    <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png">
    <link rel="manifest" href="/assets/favicon/manifest.json">
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="theme-color" content="#ffffff">

    <!-- The docs stylesheet first, for shared typography and the code-block /
         highlight.js styling; the recipes sheet then layers its own chrome on
         top. Everything in the docs sheet beyond a handful of element rules is
         scoped to #docs or a docs-only class, so none of its layout leaks in. -->
    <link rel="stylesheet" href="/recipes/assets/js/bundle.css">
    <link rel="stylesheet" href="/assets/css/style.css">
    <link rel="stylesheet" href="/recipes/assets/css/style.css">
    <script src="/recipes/assets/js/bundle.js"></script>

    <script defer data-domain="docs.puter.com" src="https://plausible.io/js/script.js"></script>
    <script type="text/javascript">
        (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "ubxybtas0w");
    </script>
`;

const githubIcon = '<svg role="img" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><title>GitHub</title><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

const headerHTML = `
    <header class="recipes-header">
        <a class="recipes-logo" href="/recipes/">Puter.js Recipes</a>
        <nav class="recipes-nav">
            <a href="/">Docs</a>
            <a href="/playground/">Playground</a>
            <a href="https://github.com/HeyPuter/puter/" target="_blank" rel="noopener">${githubIcon}<span>GitHub</span></a>
        </nav>
    </header>
`;

function renderPage ({ title, description, canonical, body }) {
    let html = '<!DOCTYPE html>\n<html lang="en">\n<head>';
    html += headHTML;
    html += '</head>\n<body>';
    html += headerHTML;
    html += body;
    html += '<script>hljs.highlightAll();</script>';
    html += '</body>\n</html>';

    return html
        .replaceAll('{{TITLE}}', encode(title))
        .replaceAll('{{DESCRIPTION}}', encode(description))
        .replaceAll('{{CANONICAL}}', canonical);
}

// Reads every top-level .md file in src/recipes/ and validates its front
// matter. Subdirectories (assets/) are ignored. Returns null if any recipe is
// invalid, after printing every problem found — so one build surfaces all of
// them rather than one per run.
function readRecipes () {
    const validTags = Object.keys(recipeTags);
    const entries = fs.readdirSync(RECIPES_SRC_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name)
        .sort();

    const recipes = [];
    let ok = true;

    for ( const filename of entries ) {
        const filePath = path.join(RECIPES_SRC_DIR, filename);
        const markdown = fs.readFileSync(filePath, 'utf-8');
        const { frontMatter, content } = parseFrontMatter(markdown);
        const slug = path.basename(filename, '.md');

        const fail = (message) => {
            console.error(`Error: ${filePath}: ${message}`);
            ok = false;
        };

        if ( ! frontMatter.title ) fail('missing `title` in front matter.');
        if ( ! frontMatter.description ) fail('missing `description` in front matter.');

        if ( ! Array.isArray(frontMatter.tags) || frontMatter.tags.length === 0 ) {
            fail('`tags` must be a non-empty array. Valid tags: ' + validTags.join(', '));
        } else {
            for ( const tag of frontMatter.tags ) {
                if ( ! validTags.includes(tag) ) {
                    fail(`unknown tag '${tag}'. Add it to src/recipe-tags.js, or use one of: ${validTags.join(', ')}`);
                }
            }
        }

        recipes.push({
            slug,
            title: frontMatter.title ?? slug,
            description: frontMatter.description ?? '',
            tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
            order: frontMatter.order ?? 100,
            markdown,
            body: content,
        });
    }

    if ( ! ok ) return null;

    recipes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return recipes;
}

// build.js reads the recipe list from three places (sitemap, llms.txt, and the
// page generator). Parse the files once so a validation error is reported once
// rather than repeated per caller.
let cachedRecipes;

function loadRecipes () {
    if ( cachedRecipes === undefined ) cachedRecipes = readRecipes();
    return cachedRecipes;
}

function renderTagChips (tags, { linked = false } = {}) {
    if ( tags.length === 0 ) return '';
    let html = '<div class="recipe-tags">';
    for ( const tag of tags ) {
        const label = encode(recipeTags[tag]);
        html += linked
            ? `<a class="recipe-tag" href="/recipes/?tags=${encode(tag)}">${label}</a>`
            : `<span class="recipe-tag">${label}</span>`;
    }
    html += '</div>';
    return html;
}

function renderTagFilters (recipes) {
    // Only offer tags something actually uses, so the filter list can't grow
    // stale as the registry gains entries ahead of the content.
    const counts = new Map();
    for ( const recipe of recipes ) {
        for ( const tag of recipe.tags ) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }

    let html = '<div class="filter-group"><div class="filter-title">Tags</div>';
    for ( const tag of Object.keys(recipeTags) ) {
        if ( ! counts.has(tag) ) continue;
        html += `
            <label class="filter-option">
                <input type="checkbox" class="tag-filter" value="${encode(tag)}">
                <span class="filter-label">${encode(recipeTags[tag])}</span>
                <span class="filter-count">${counts.get(tag)}</span>
            </label>`;
    }
    html += '</div>';
    html += '<button class="clear-filters" type="button" hidden>Clear filters</button>';
    return html;
}

function renderCards (recipes) {
    let html = '<div class="recipe-grid">';
    for ( const recipe of recipes ) {
        // data-search bundles everything the search box matches against, so
        // the client never has to reconstruct it from the DOM.
        const searchable = [
            recipe.title,
            recipe.description,
            ...recipe.tags,
            ...recipe.tags.map(tag => recipeTags[tag]),
        ].join(' ').toLowerCase();

        html += `
            <a class="recipe-card" href="/recipes/${recipe.slug}/"
               data-tags="${encode(recipe.tags.join(' '))}"
               data-search="${encode(searchable)}">
                <div class="recipe-card-title">${encode(recipe.title)}</div>
                <div class="recipe-card-desc">${encode(recipe.description)}</div>
                ${renderTagChips(recipe.tags)}
            </a>`;
    }
    html += '</div>';
    html += '<div class="recipe-empty" hidden>No recipes match these filters.</div>';
    return html;
}

function renderRecipeList (recipes, activeSlug) {
    let html = '<div class="recipe-list">';
    html += '<div class="filter-title">All recipes</div>';
    for ( const recipe of recipes ) {
        const active = recipe.slug === activeSlug ? ' active' : '';
        html += `<a class="recipe-list-item${active}" href="/recipes/${recipe.slug}/">${encode(recipe.title)}</a>`;
    }
    html += '</div>';
    return html;
}

function renderIndexPage (recipes) {
    const body = `
        <div class="recipes-layout">
            <aside class="recipes-sidebar">
                <div class="recipes-search">
                    <input type="text" id="recipe-search" placeholder="Search recipes..." autocomplete="off">
                </div>
                ${renderTagFilters(recipes)}
            </aside>
            <main class="recipes-main">
                <h1>Recipes</h1>
                <p class="recipes-intro">
                    Prebuilt patterns for common Puter.js tasks — the recommended way to do
                    each of these. Copy one rather than working it out from the API reference.
                </p>
                ${renderCards(recipes)}
            </main>
        </div>`;

    return renderPage({
        title: 'Recipes | Puter.js',
        description: 'Prebuilt, copy-pasteable patterns for building with Puter.js — AI, storage, auth, hosting, and more.',
        canonical: `${site}/recipes/`,
        body,
    });
}

function renderRecipePage (recipe, recipes) {
    const body = `
        <div class="recipes-layout">
            <aside class="recipes-sidebar">
                ${renderRecipeList(recipes, recipe.slug)}
            </aside>
            <main class="recipes-main recipe-detail">
                <h1>${encode(recipe.title)}</h1>
                ${renderTagChips(recipe.tags, { linked: true })}
                <p class="recipe-lede">${encode(recipe.description)}</p>
                <hr>
                ${marked.parse(recipe.body)}
                <a class="recipes-back" href="/recipes/">&larr; All recipes</a>
            </main>
        </div>`;

    return renderPage({
        title: `${recipe.title} | Puter.js Recipes`,
        description: recipe.description,
        canonical: `${site}/recipes/${recipe.slug}/`,
        body,
    });
}

// Writes dist/recipes/. Returns false if any recipe failed validation, which
// build.js folds into `anyErrors` so a bad tag fails the build.
const generateRecipes = () => {
    const recipes = loadRecipes();
    if ( recipes === null ) return false;

    fs.mkdirSync(RECIPES_DIST_DIR, { recursive: true });

    // Bundled here rather than alongside the docs bundle in build.js, and with
    // the sync API: build.js never awaits generateDocumentation(), so an async
    // build racing this function's copySync over dist/recipes/assets/ fails
    // intermittently with EEXIST. Doing it here keeps one writer for the whole
    // directory.
    try {
        esbuild.buildSync({
            entryPoints: [path.join(RECIPES_SRC_DIR, 'assets', 'js', 'index.js')],
            bundle: true,
            outfile: path.join(RECIPES_DIST_DIR, 'assets', 'js', 'bundle.js'),
            minify: true,
            sourcemap: true,
            allowOverwrite: true,
            loader: {
                '.woff': 'dataurl',
                '.woff2': 'dataurl',
                '.ttf': 'dataurl',
                '.eot': 'dataurl',
                '.svg': 'dataurl',
            },
        });
    } catch ( error ) {
        console.error(error);
        return false;
    }

    // Copy client assets verbatim, the way the playground's are copied.
    fs.copySync(
        path.join(RECIPES_SRC_DIR, 'assets', 'css'),
        path.join(RECIPES_DIST_DIR, 'assets', 'css'),
    );

    fs.writeFileSync(
        path.join(RECIPES_DIST_DIR, 'index.html'),
        renderIndexPage(recipes),
        'utf8',
    );

    for ( const recipe of recipes ) {
        const outputDir = path.join(RECIPES_DIST_DIR, recipe.slug);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'index.html'), renderRecipePage(recipe, recipes), 'utf8');
        // Raw markdown alongside the page, matching what build.js does for docs
        // pages. This is what MCP's puter_docs_get("recipes/<slug>") fetches.
        fs.writeFileSync(path.join(outputDir, 'index.md'), recipe.markdown, 'utf8');
    }

    console.log(`Generated ${recipes.length} recipes.`);
    return true;
};

module.exports = { generateRecipes, loadRecipes };
