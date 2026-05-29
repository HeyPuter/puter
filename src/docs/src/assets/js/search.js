import $ from 'jquery';
import MiniSearch from 'minisearch';

let miniSearch = null;
let searchTimeout = null;
let selectedSearchResult = -1;

// Last query the user typed while the index was still loading; replayed by
// fetchSearchIndex() once the index becomes available so the user doesn't
// have to retype. Cleared on success, failure, or when the query falls
// below the minimum length.
let pendingQuery = null;
// True after fetchSearchIndex() has thrown at least once; lets performSearch
// distinguish "still loading" from "load failed" without waiting forever.
let indexLoadFailed = false;

// Query-time tokenizer. Splits on whitespace AND punctuation only — does
// NOT emit the joined-without-punctuation form. The index (built in
// build.js's indexTokenize) already pre-baked the joined variants, so
// queries just need to produce the user's natural tokens and let
// exact/prefix/fuzzy match against the indexed terms.
function queryTokenize (text) {
    if ( !text ) return [];
    const tokens = [];
    for ( const chunk of text.split(/[\n\r\p{Z}]+/u) ) {
        if ( !chunk ) continue;
        const parts = chunk.split(/\p{P}+/u).filter(Boolean);
        for ( const part of parts ) tokens.push(part);
    }
    return tokens;
}

const MINISEARCH_CONFIG = {
    fields: ['title', 'text', 'pageTitle'],
    storeFields: ['title', 'pageTitle', 'path', 'anchor', 'text'],
    tokenize: queryTokenize,
    searchOptions: {
        boost: { title: 3, pageTitle: 2, text: 1 },
        fuzzy: term => {
            if ( term.length <= 3 ) return 0;
            if ( term.length <= 7 ) return 1;
            return 2;
        },
        prefix: term => term.length >= 3,

        combineWith: 'AND',
    },
};

const commandIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-command-icon lucide-command"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

$(document).ready(function () {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcut = isMac ? `${commandIcon}&nbsp;<span>K</span>` : 'Ctrl K';

    const $searchTrigger = $('.search-trigger');
    const $shortcutElement = $('<div>')
        .addClass('search-trigger-shortcut')
        .html(shortcut);
    $searchTrigger.append($shortcutElement);

    // search handlers
    function openSearchUI () {
        $('.search-overlay').addClass('active');
        $('body').css('overflow', 'hidden');
        $('.search-input').val('').focus();
        updateSearchResults([]);
    }

    function closeSearchUI () {
        $('.search-overlay').removeClass('active');
        $('body').css('overflow', 'auto');
    }

    $(document).on('click', '.search-trigger', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSearchUI();
    });

    $(document).on('keydown', function (e) {
        if ( e.key === 'k' && (e.metaKey || e.ctrlKey) ) {
            e.stopPropagation();
            e.preventDefault();
            openSearchUI();
        }

        if ( e.key === 'Escape' && $('.search-overlay').hasClass('active') ) {
            e.stopPropagation();
            e.preventDefault();
            closeSearchUI();
        }

        // Arrow key navigation in search results
        if ( $('.search-overlay').hasClass('active') ) {
            if ( e.key === 'ArrowDown' ) {
                e.stopPropagation();
                e.preventDefault();
                navigateSearchResults('down');
            } else if ( e.key === 'ArrowUp' ) {
                e.stopPropagation();
                e.preventDefault();
                navigateSearchResults('up');
            } else if ( e.key === 'Enter' && selectedSearchResult >= 0 ) {
                e.stopPropagation();
                e.preventDefault();
                closeSearchUI();
                activateSelectedResult();
            }
        }
    });

    $(document).on('click', '.search-overlay', function (e) {
        if ( e.target === this ) {
            closeSearchUI();
        }
    });

    $(document).on('click', '.search-result', function (e) {
        closeSearchUI();
    });

    $(document).on('input', '.search-input', function (e) {
        const query = $(this).val().trim();

        // Clear existing timeout
        if ( searchTimeout ) {
            clearTimeout(searchTimeout);
        }

        // Synchronously drop any pending replay when the input is too
        // short, so a late index load can't resurrect stale results
        // after the user clears the field within the debounce window.
        if ( !query || query.length < 2 ) {
            pendingQuery = null;
        }

        // Set new timeout for debouncing. performSearch handles the
        // not-yet-loaded case itself, so the input handler stays sync.
        searchTimeout = setTimeout(() => {
            performSearch(query);
        }, 300);
    });

    // fetch search index
    fetchSearchIndex();
});

async function fetchSearchIndex () {
    indexLoadFailed = false;
    try {
        const response = await fetch('/index.json');
        const text = await response.text();
        miniSearch = MiniSearch.loadJSON(text, MINISEARCH_CONFIG);
        console.log('Search index loaded:', `${miniSearch.documentCount } items`);
        // Replay the query the user typed while we were still loading.
        if ( pendingQuery !== null ) {
            const q = pendingQuery;
            pendingQuery = null;
            performSearch(q);
        }
    } catch ( error ) {
        console.error('Failed to load search index:', error);
        miniSearch = null;
        indexLoadFailed = true;
        if ( pendingQuery !== null ) {
            pendingQuery = null;
            renderSearchStatus('failed');
        }
    }
}
function escapeHtml (text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeRegex (text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateTextFragment (matchedText, prefix = '', suffix = '') {
    const encodedText = encodeURIComponent(matchedText);
    const encodedPrefix = prefix ? `${encodeURIComponent(prefix) }-,` : '';
    const encodedSuffix = suffix ? `,-${ encodeURIComponent(suffix)}` : '';

    return `text=${encodedPrefix}${encodedText}${encodedSuffix}`;
}

// Build the final href for a search result, combining the page path with
// optional section anchor and optional text fragment per the WICG spec.
function buildResultUrl (result) {
    let url = `${result.path}/`;
    if ( result.anchor ) url += `#${result.anchor}`;
    if ( result.textFragment ) {
        url += result.anchor
            ? `:~:${result.textFragment}`
            : `#:~:${result.textFragment}`;
    }
    return url;
}

// Single source of truth for the empty-state UI so the idle / loading /
// failed copy can only drift in one place.
function renderSearchStatus (kind) {
    const messages = {
        idle: 'Start typing to search...',
        loading: 'Loading search index...',
        failed: 'Failed to load search index. Please refresh.',
    };
    $('.search-results').html(
        `<div class="search-no-results">${messages[kind]}</div>`
    );
}

function performSearch (query) {
    if ( !query || query.length < 2 ) {
        // Drop any pending replay so the user isn't surprised by a stale
        // search firing after they cleared the input.
        pendingQuery = null;
        renderSearchStatus('idle');
        return;
    }

    if ( !miniSearch ) {
        if ( indexLoadFailed ) {
            renderSearchStatus('failed');
            return;
        }
        // Index still loading; remember the query so fetchSearchIndex
        // can replay it on success.
        pendingQuery = query;
        renderSearchStatus('loading');
        return;
    }

    const hits = miniSearch.search(query).slice(0, 15);
    const results = hits.map(hit => decorateHit(hit, query));
    updateSearchResults(results);
}

function textPreview (text, maxLen) {
    if ( !text ) return '';
    if ( text.length <= maxLen ) return text;
    return `${text.substring(0, maxLen) }...`;
}

// Apply exact-substring highlighting on top of an engine hit. Priority:
//   1. Query found in section title  → mark the title, no text fragment
//      (anchor jump alone lands on the heading).
//   2. Query found in section body   → mark a snippet around the match,
//      attach a text-fragment URL so the browser scrolls to the phrase.
//   3. Fuzzy-only hit (no exact match either place) → no marks, no fragment;
//      we just link to the section anchor.
function decorateHit (hit, query) {
    const queryLower = query.toLowerCase();
    const queryRegex = new RegExp(`(${escapeRegex(query)})`, 'i');

    const base = {
        pageTitle: hit.pageTitle,
        path: hit.path,
        anchor: hit.anchor,
    };

    if ( hit.title.toLowerCase().includes(queryLower) ) {
        return {
            ...base,
            title: escapeHtml(hit.title).replace(queryRegex, '<mark>$1</mark>'),
            text: escapeHtml(textPreview(hit.text, 80)),
            textFragment: '',
        };
    }

    const textIdx = hit.text.toLowerCase().indexOf(queryLower);
    if ( textIdx !== -1 ) {
        const { snippet, textFragment } = buildBodySnippet(hit.text, query, textIdx);
        return {
            ...base,
            title: escapeHtml(hit.title),
            text: snippet,
            textFragment,
        };
    }

    // Fuzzy-only hit
    return {
        ...base,
        title: escapeHtml(hit.title),
        text: escapeHtml(textPreview(hit.text, 120)),
        textFragment: '',
    };
}

// Build a word-aligned snippet around an exact match in body text, plus the
// `text=prefix-,match,-suffix` fragment that lets the browser highlight the
// phrase in-page after navigation.
function buildBodySnippet (text, query, matchIdx) {
    const queryLen = query.length;

    // ±50 chars of context around the match
    const contextStart = Math.max(0, matchIdx - 50);
    const contextEnd = Math.min(text.length, matchIdx + queryLen + 50);
    const contextText = text.substring(contextStart, contextEnd);

    const words = contextText.split(/\s+/);

    // Find which words the match spans
    const matchStart = matchIdx;
    const matchEnd = matchIdx + queryLen;
    let matchStartWordIndex = -1;
    let matchEndWordIndex = -1;
    let currentPos = contextStart;

    for ( let i = 0; i < words.length; i++ ) {
        const wordStart = currentPos;
        const wordEnd = wordStart + words[i].length;
        if ( wordStart < matchEnd && wordEnd > matchStart ) {
            if ( matchStartWordIndex === -1 ) matchStartWordIndex = i;
            matchEndWordIndex = i;
        }
        currentPos = wordEnd + 1; // +1 for separating space
    }

    const matchedWords = matchStartWordIndex !== -1
        ? words.slice(matchStartWordIndex, matchEndWordIndex + 1).join(' ')
        : words[0] || '';

    // Adjacent words tighten the text-fragment so it doesn't match elsewhere
    const fragmentPrefix = matchStartWordIndex > 0
        ? words[matchStartWordIndex - 1] : '';
    const fragmentSuffix = matchEndWordIndex < words.length - 1
        ? words[matchEndWordIndex + 1] : '';
    const textFragment = generateTextFragment(matchedWords,
                    fragmentPrefix,
                    fragmentSuffix);

    // Display: up to 4 words on either side, with ellipses if trimmed
    const startWord = Math.max(0, matchStartWordIndex - 4);
    const endWord = Math.min(words.length, matchEndWordIndex + 5);
    let displayText = words.slice(startWord, endWord).join(' ');
    if ( startWord > 0 ) displayText = `...${ displayText}`;
    if ( endWord < words.length ) displayText = `${displayText }...`;

    const snippet = escapeHtml(displayText).replace(
                    new RegExp(`(${escapeRegex(query)})`, 'i'),
                    '<mark>$1</mark>');

    return { snippet, textFragment };
}

function updateSearchResults (results) {
    if ( results.length === 0 ) {
        $('.search-results').html(
                        '<div class="search-no-results">No results found</div>');
        selectedSearchResult = -1;
        return;
    }

    let html = '';
    results.slice(0, 15).forEach((result, index) => {
        const url = buildResultUrl(result);
        // For section entries, show "Page Title › Section Heading" inline. For
        // intro entries (no anchor), the result IS the page, so just the title.
        // `result.title` may already contain <mark> from title-match highlighting,
        // so it's not escaped here; pageTitle is plain text and must be escaped.
        const titleHtml = result.anchor && result.pageTitle
            ? `<span class="search-result-title-page">${escapeHtml(result.pageTitle)}</span>`
                + '<span class="search-result-sep">›</span>'
                + result.title
            : result.title;
        html += `
            <div class="search-result" data-index="${index}">
                <a href="${url}" class="search-result-link skip-insta-load">
                    <div class="search-result-title">${titleHtml}</div>
                    <div class="search-result-text">${result.text}</div>
                </a>
            </div>
        `;
    });

    $('.search-results').html(html);
    selectedSearchResult = -1; // Reset selection
    updateSelectedResult();
}

function updateSelectedResult () {
    $('.search-result').removeClass('selected');
    if ( selectedSearchResult >= 0 ) {
        const $selected = $(`.search-result[data-index="${selectedSearchResult}"]`);
        $selected.addClass('selected');

        // Scroll the container to keep the selected result visible
        const $container = $('.search-results');
        const containerHeight = $container.height();
        const containerScrollTop = $container.scrollTop();
        const selectedOffset = $selected.offset().top;
        const containerOffset = $container.offset().top;
        const selectedRelativeTop =
            selectedOffset - containerOffset + containerScrollTop;
        const selectedHeight = $selected.outerHeight();

        if ( selectedRelativeTop < containerScrollTop ) {
            // Selected result is above the visible area
            $container.scrollTop(selectedRelativeTop);
        } else if (
            selectedRelativeTop + selectedHeight >
            containerScrollTop + containerHeight
        ) {
            // Selected result is below the visible area
            $container.scrollTop(selectedRelativeTop + selectedHeight - containerHeight);
        }
    }
}

function navigateSearchResults (direction) {
    const $results = $('.search-result');
    if ( $results.length === 0 ) return;

    if ( direction === 'down' ) {
        selectedSearchResult =
            selectedSearchResult < $results.length - 1
                ? selectedSearchResult + 1
                : selectedSearchResult;
    } else if ( direction === 'up' ) {
        selectedSearchResult =
            selectedSearchResult >= 0
                ? selectedSearchResult - 1
                : selectedSearchResult;
    }

    updateSelectedResult();
}

function activateSelectedResult () {
    if ( selectedSearchResult >= 0 ) {
        const $selected = $(`.search-result[data-index="${selectedSearchResult}"] .search-result-link`);
        if ( $selected.length ) {
            window.location.href = $selected.attr('href');
        }
    }
}
