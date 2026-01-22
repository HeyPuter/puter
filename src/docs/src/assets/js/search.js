// Global search index
let searchIndex = [];
let searchTimeout = null;
let selectedSearchResult = -1;

const commandIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-command-icon lucide-command"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

jQuery(document).ready(function () {
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

        // Set new timeout for debouncing
        searchTimeout = setTimeout(async () => {
            if ( searchIndex.length == 0 ) {
                await fetchSearchIndex();
            }
            performSearch(query);
        }, 300);
    });

    // fetch search index
    fetchSearchIndex();
});

async function fetchSearchIndex () {
    try {
        const response = await fetch('/index.json');
        const data = await response.json();
        searchIndex = data;
        console.log('Search index loaded:', `${searchIndex.length } items`);
    } catch ( error ) {
        console.error('Failed to load search index:', error);
        searchIndex = [];
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

function generateTextFragment (matchedText, prefix = '', suffix = '') {
    const encodedText = encodeURIComponent(matchedText);
    const encodedPrefix = prefix ? `${encodeURIComponent(prefix) }-,` : '';
    const encodedSuffix = suffix ? `,-${ encodeURIComponent(suffix)}` : '';

    return `#:~:text=${encodedPrefix}${encodedText}${encodedSuffix}`;
}

function performSearch (query) {
    if ( !query || query.length < 2 ) {
        $('.search-results').html(
                        '<div class="search-no-results">Start typing to search...</div>');
        return;
    }

    const titleResults = [];
    const textResults = [];
    const queryLower = query.toLowerCase();

    searchIndex.forEach((item) => {
        const titleMatch = item.title.toLowerCase().indexOf(queryLower);
        if ( titleMatch !== -1 ) {
            const highlightedTitle = escapeHtml(item.title).replace(
                            new RegExp(`(${escapeHtml(query)})`, 'i'),
                            '<mark>$1</mark>');

            titleResults.push({
                title: highlightedTitle,
                path: item.path,
                text: escapeHtml(item.text.substring(0, 60) + (item.text.length > 60 ? '...' : '')),
                textFragment: '',
            });
        }

        const textLower = item.text.toLowerCase();
        let searchOffset = 0;

        // Find all matches in the text
        while ( true ) {
            const textMatch = textLower.indexOf(queryLower, searchOffset);
            if ( textMatch === -1 ) break;

            // Extract 50 chars before and after the match
            const contextStart = Math.max(0, textMatch - 50);
            const contextEnd = Math.min(item.text.length,
                            textMatch + query.length + 50);
            const contextText = item.text.substring(contextStart, contextEnd);

            // Split into words
            const words = contextText.split(/\s+/);

            // Find all words that intersect with the match range
            const matchStart = textMatch;
            const matchEnd = textMatch + query.length;
            let matchStartWordIndex = -1;
            let matchEndWordIndex = -1;
            let currentPos = contextStart;

            for ( let i = 0; i < words.length; i++ ) {
                const wordStart = currentPos;
                const wordEnd = wordStart + words[i].length;

                // Check if this word intersects with the match
                if ( wordStart < matchEnd && wordEnd > matchStart ) {
                    if ( matchStartWordIndex === -1 ) {
                        matchStartWordIndex = i;
                    }
                    matchEndWordIndex = i;
                }
                currentPos = wordEnd + 1; // +1 for space
            }

            // Get the complete matched text (all words that contain the match)
            const matchedWords =
                matchStartWordIndex !== -1
                    ? words.slice(matchStartWordIndex, matchEndWordIndex + 1).join(' ')
                    : words[0] || '';

            // Get prefix and suffix for text fragment (closest words)
            const fragmentPrefix =
                matchStartWordIndex > 0 ? words[matchStartWordIndex - 1] : '';
            const fragmentSuffix =
                matchEndWordIndex < words.length - 1
                    ? words[matchEndWordIndex + 1]
                    : '';

            // Generate text fragment
            const textFragment = generateTextFragment(matchedWords,
                            fragmentPrefix,
                            fragmentSuffix);

            // Create display text (max 4 words before/after)
            const startWord = Math.max(0, matchStartWordIndex - 4);
            const endWord = Math.min(words.length, matchEndWordIndex + 5);
            const displayWords = words.slice(startWord, endWord);

            let displayText = displayWords.join(' ');
            if ( startWord > 0 ) displayText = `...${ displayText}`;
            if ( endWord < words.length ) displayText = `${displayText }...`;

            // Highlight the matched text in display
            const highlightedChunk = escapeHtml(displayText).replace(
                            new RegExp(`(${escapeHtml(query)})`, 'i'),
                            '<mark>$1</mark>');

            textResults.push({
                title: item.title,
                path: item.path,
                text: highlightedChunk,
                textFragment: textFragment,
            });

            searchOffset = textMatch + 1;
        }
    });

    updateSearchResults([...titleResults, ...textResults]);
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
        const url = `${result.path }/${ result.textFragment || ''}`;
        html += `
            <div class="search-result" data-index="${index}">
                <a href="${url}" class="search-result-link skip-insta-load">
                    <div class="search-result-title">${result.title}</div>
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
