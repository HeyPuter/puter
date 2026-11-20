const fs = require('fs-extra');
const path = require('path');
const marked = require('marked');
const { JSDOM } = require('jsdom');
const { encode } = require('html-entities');

const SOURCE_PATH = path.join('src', 'changelog.md');
const DIST_DIR = 'dist';
const SITE = 'https://docs.puter.com';
const FEED_PATH = '/changelog/rss.xml';
// Feed readers only need recent days, and they fetch the feed on every poll.
const FEED_DAYS = 50;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
const DAY_HEADING = new RegExp(`^(${MONTHS.join('|')}) (\\d{1,2}), (\\d{4})$`);

// The first word of an entry picks its label color.
const LABEL_KINDS = {
    Added: 'added',
    Changed: 'changed',
    Renamed: 'changed',
    Raised: 'changed',
    Lowered: 'changed',
    Fixed: 'fixed',
    Removed: 'removed',
    Deprecated: 'removed',
};
const LABEL_PATTERN = new RegExp(`^\\s*(${Object.keys(LABEL_KINDS).join('|')})\\b`);

/** @returns {{ year: number, month: number, day: number } | null} */
function parseDay (text) {
    const match = text.trim().match(DAY_HEADING);
    if ( ! match ) return null;
    return { year: Number(match[3]), month: MONTHS.indexOf(match[1]), day: Number(match[2]) };
}

function isoDate ({ year, month, day }) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function slug (text) {
    return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Reads the day headings of changelog.md. Every `##` heading must be a
 * "Month D, YYYY" date, newest first, with no day listed twice.
 * @returns {{ latest: string | null, errors: string[] }} the newest day as YYYY-MM-DD
 */
function parseChangelog (markdown) {
    const errors = [];
    let previous = null;
    let latest = null;
    for ( const [, text] of markdown.matchAll(/^## (.*)$/gm) ) {
        const day = parseDay(text);
        if ( ! day ) {
            errors.push(`"## ${text}" isn't a "Month D, YYYY" date`);
            continue;
        }
        const iso = isoDate(day);
        latest ??= iso;
        if ( previous !== null && iso >= previous ) {
            errors.push(iso === previous
                ? `"## ${text}" repeats a day. Each day gets one heading.`
                : `"## ${text}" is out of order. Put the newest day first.`);
        }
        previous = iso;
    }
    return { latest, errors };
}

function readChangelog () {
    return fs.readFileSync(SOURCE_PATH, 'utf8');
}

/**
 * Turns the changelog Markdown into the page body: a heading per month, each
 * day as a date beside a card of entries, and a label on each entry's first word.
 */
function renderEntries (markdown) {
    // The page has its own title and intro, so only the days are rendered.
    const firstDay = markdown.search(/^## /m);
    const html = firstDay === -1 ? '' : marked.parse(markdown.slice(firstDay));
    const { document } = new JSDOM(`<body>${html}</body>`).window;
    const body = document.body;

    let currentMonth = null;
    for ( const h2 of [...body.querySelectorAll('h2')] ) {
        const day = parseDay(h2.textContent);
        if ( ! day ) continue;

        const monthName = `${MONTHS[day.month]} ${day.year}`;
        if ( monthName !== currentMonth ) {
            currentMonth = monthName;
            const month = document.createElement('h2');
            month.className = 'changelog-month';
            month.id = slug(monthName);
            month.textContent = monthName;
            h2.before(month);
        }

        const id = slug(h2.textContent);
        const section = document.createElement('section');
        section.className = 'changelog-day';
        section.id = id;
        const date = document.createElement('h3');
        date.className = 'changelog-date';
        date.innerHTML = `<a href="#${id}">${h2.textContent.trim()}</a>`;
        const entries = document.createElement('div');
        entries.className = 'changelog-entries';
        while ( h2.nextElementSibling && h2.nextElementSibling.tagName !== 'H2' ) {
            entries.append(h2.nextElementSibling);
        }
        section.append(date, entries);
        h2.replaceWith(section);
    }

    for ( const li of body.querySelectorAll('.changelog-entries li') ) {
        const first = li.firstChild;
        if ( ! first || first.nodeType !== first.TEXT_NODE ) continue;
        const match = first.textContent.match(LABEL_PATTERN);
        if ( ! match ) continue;
        const label = document.createElement('span');
        label.className = `changelog-label changelog-label-${LABEL_KINDS[match[1]]}`;
        label.textContent = match[1];
        first.textContent = first.textContent.slice(match[0].length).trimStart();
        li.prepend(label);
    }

    return body.innerHTML;
}

function readIntro (markdown) {
    return markdown.match(/^# .*\n+([^\n#][^\n]*)/)?.[1] ?? '';
}

/**
 * Builds an RSS 2.0 feed with one item per day, newest first. Each item links
 * to that day on the changelog page. `markdown` must already have absolute links.
 */
function renderFeed (markdown) {
    const items = markdown.split(/^## /m).slice(1, FEED_DAYS + 1).map(section => {
        const newline = section.indexOf('\n');
        const heading = section.slice(0, newline).trim();
        const { year, month, day } = parseDay(heading);
        const link = `${SITE}/changelog/#${slug(heading)}`;
        return `
        <item>
            <title>${encode(heading)}</title>
            <link>${link}</link>
            <guid isPermaLink="true">${link}</guid>
            <pubDate>${new Date(Date.UTC(year, month, day)).toUTCString()}</pubDate>
            <description>${encode(marked.parse(section.slice(newline + 1)).trim())}</description>
        </item>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>Puter.js Changelog</title>
        <link>${SITE}/changelog/</link>
        <description>${encode(readIntro(markdown))}</description>
        <language>en</language>
        <atom:link href="${SITE}${FEED_PATH}" rel="self" type="application/rss+xml" />${items.join('')}
    </channel>
</rss>
`;
}

function renderPage (markdown, latest) {
    const intro = encode(readIntro(markdown));
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Puter.js Changelog</title>
    <meta name="description" content="${intro}">
    <link rel="canonical" href="${SITE}/changelog/">
    <link rel="alternate" type="application/rss+xml" title="Puter.js Changelog" href="${FEED_PATH}">
    <meta name="robots" content="noindex, follow" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png">
    <link rel="stylesheet" href="/assets/js/bundle.css">
    <link rel="stylesheet" href="/assets/css/changelog.css">
    <script defer data-domain="docs.puter.com" src="https://plausible.io/js/script.js"></script>
</head>
<body>
    <header class="changelog-header">
        <a class="changelog-logo" href="/changelog/">Puter.js Changelog</a>
        <nav class="changelog-nav">
            <a href="/">Docs</a>
            <a href="/recipes/">Recipes</a>
            <a href="https://github.com/HeyPuter/puter/" target="_blank" rel="noopener">GitHub</a>
        </nav>
    </header>
    <main class="changelog-main">
        <h1>Changelog</h1>
        <p class="changelog-intro">${intro}</p>
        <p class="changelog-formats">
            <a href="/changelog.md" target="_blank"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>View as Markdown</a>
            <a href="${FEED_PATH}" target="_blank"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rss"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>RSS feed</a>
        </p>
        ${renderEntries(markdown)}
    </main>
    <script>
        // Clears the "What's new" dot in the docs sidebar.
        try { localStorage.setItem('changelogSeen', '${latest}'); } catch ( e ) {}
    </script>
</body>
</html>
`;
}

/**
 * Writes the changelog page and its RSS feed to dist/changelog/, and its
 * Markdown to dist/changelog.md for feeding to AI, with links made absolute so
 * the files work on their own. Returns false if a day heading is invalid.
 */
function generateChangelog () {
    const source = readChangelog();
    const { latest, errors } = parseChangelog(source);
    for ( const error of errors ) {
        console.error(`Error: ${SOURCE_PATH}: ${error}`);
    }
    if ( errors.length > 0 ) return false;

    const markdown = source.replace(/\]\(\//g, `](${SITE}/`);
    fs.mkdirSync(path.join(DIST_DIR, 'changelog'), { recursive: true });
    fs.writeFileSync(path.join(DIST_DIR, 'changelog', 'index.html'), renderPage(source, latest));
    fs.writeFileSync(path.join(DIST_DIR, 'changelog', 'index.md'), markdown);
    fs.writeFileSync(path.join(DIST_DIR, 'changelog.md'), markdown);
    fs.writeFileSync(path.join(DIST_DIR, FEED_PATH), renderFeed(markdown));
    return true;
}

module.exports = { generateChangelog, parseChangelog, readChangelog };
