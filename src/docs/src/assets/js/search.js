import $ from 'jquery';
import Fuse from 'fuse.js';

// Global search index
let searchIndex = [];
let searchTimeout = null;
let selectedSearchResult = -1;
let fuseInstance = null;

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

// Shared Fuse search keys and options, kept in one place so the
// index and instance always stay in sync.
const fuseKeys = [
    { name: 'title', weight: 2.0 },
    { name: 'text', weight: 1.0 }
];

const fuseOptions = {
    keys: fuseKeys,
    includeMatches: true,
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
};

async function fetchSearchIndex () {
    try {
        const response = await fetch('/index.json');
        const data = await response.json();
        searchIndex = data.documents;

        // Load the pre-built Fuse index generated at build time.
        // Reference: https://www.fusejs.io/api/indexing.html
        const index = Fuse.parseIndex(data.index);
        fuseInstance = new Fuse(searchIndex, fuseOptions, index);

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

function highlightIndices(text, indices, offsetStart = 0, offsetEnd = text.length) {
    let result = '';
    let currentIndex = offsetStart;
    
    // Filter and sort indices within the extracted window
    let validIndices = indices
        .filter(([start, end]) => start <= offsetEnd && end >= offsetStart)
        .map(([start, end]) => [Math.max(start, offsetStart), Math.min(end, offsetEnd)])
        .sort((a, b) => a[0] - b[0]);

    // Expand to word boundaries to avoid highlighting single letters
    validIndices = validIndices.map(([start, end]) => {
        let s = start;
        let e = end;
        while (s > offsetStart && /[a-zA-Z0-9_]/.test(text[s - 1])) s--;
        while (e < offsetEnd - 1 && /[a-zA-Z0-9_]/.test(text[e + 1])) e++;
        return [s, e];
    });
        
    // Merge overlapping/adjacent indices
    const mergedIndices = [];
    if (validIndices.length > 0) {
        let current = [...validIndices[0]];
        for (let i = 1; i < validIndices.length; i++) {
            if (validIndices[i][0] <= current[1] + 1) {
                current[1] = Math.max(current[1], validIndices[i][1]);
            } else {
                mergedIndices.push(current);
                current = [...validIndices[i]];
            }
        }
        mergedIndices.push(current);
    }
    
    for (const [start, end] of mergedIndices) {
        if (start > currentIndex) {
            result += escapeHtml(text.substring(currentIndex, start));
        }
        result += '<mark>' + escapeHtml(text.substring(start, end + 1)) + '</mark>';
        currentIndex = end + 1;
    }
    
    if (currentIndex < offsetEnd) {
        result += escapeHtml(text.substring(currentIndex, offsetEnd));
    }
    
    return result;
}

function performSearch (query) {
    if ( !query || query.length < 2 ) {
        $('.search-results').html('<div class="search-no-results">Start typing to search...</div>');
        return;
    }

    if (!fuseInstance) return;

    const queryLower = query.toLowerCase().trim();
    const queryTokens = queryLower.split(/\s+/).filter(Boolean);
    const fuseResults = fuseInstance.search(query);
    const finalResults = [];

    fuseResults.forEach(result => {
        const item = result.item;
        const textLower = item.text.toLowerCase();
        const titleLower = item.title.toLowerCase();
        
        let score = (1 - result.score) * 100; // Base fuse score (0-100)

        // Exact matches
        let isExactTextMatch = textLower.includes(queryLower);
        let isExactTitleMatch = titleLower.includes(queryLower);
        
        if (isExactTitleMatch) score += 500;
        if (isExactTextMatch) score += 300;

        // Near phrase / All Keywords
        if (!isExactTextMatch && !isExactTitleMatch) {
            let allTokensInTitle = queryTokens.length > 0 && queryTokens.every(t => titleLower.includes(t));
            let allTokensInText = queryTokens.length > 0 && queryTokens.every(t => textLower.includes(t));
            if (allTokensInTitle) score += 200;
            if (allTokensInText) score += 100;
        }

        let occurrences = [];
        
        if (isExactTextMatch) {
            let offset = 0;
            while (true) {
                let idx = textLower.indexOf(queryLower, offset);
                if (idx === -1) break;
                occurrences.push({ type: 'exact', index: idx, length: queryLower.length });
                offset = idx + queryLower.length;
                if (occurrences.length >= 3) break; // Limit exact matches per page
            }
        }
        
        if (occurrences.length === 0 && result.matches) {
            const textMatch = result.matches.find(m => m.key === 'text');
            if (textMatch && textMatch.indices.length > 0) {
                 const firstIndex = textMatch.indices[0][0];
                 occurrences.push({ type: 'fuzzy', index: firstIndex, indices: textMatch.indices });
            }
        }

        // Highlight Title
        let highlightedTitle = item.title;
        const titleMatch = result.matches ? result.matches.find(m => m.key === 'title') : null;
        if (isExactTitleMatch) {
            const exactTitleMatchIndex = titleLower.indexOf(queryLower);
            highlightedTitle = highlightIndices(item.title, [[exactTitleMatchIndex, exactTitleMatchIndex + queryLower.length - 1]]);
        } else if (titleMatch) {
            highlightedTitle = highlightIndices(item.title, titleMatch.indices);
        } else {
            highlightedTitle = escapeHtml(item.title);
        }

        if (occurrences.length === 0) {
             // No exact or fuzzy text match — show the first 80 chars of the
             // page body. We still attempt to highlight any query tokens that
             // happen to appear in this preview snippet so the result feels
             // consistent with the other highlighted entries.
             const snippetEnd = Math.min(item.text.length, 80);
             let snippetHTML;
             const snippetLower = item.text.substring(0, snippetEnd).toLowerCase();
             const tokenIndices = [];
             for (const token of queryTokens) {
                 let pos = 0;
                 while (pos < snippetEnd) {
                     const idx = snippetLower.indexOf(token, pos);
                     if (idx === -1 || idx >= snippetEnd) break;
                     tokenIndices.push([idx, idx + token.length - 1]);
                     pos = idx + token.length;
                 }
             }
             if (tokenIndices.length > 0) {
                 snippetHTML = highlightIndices(item.text, tokenIndices, 0, snippetEnd) + '...';
             } else {
                 snippetHTML = escapeHtml(item.text.substring(0, snippetEnd)) + '...';
             }

             finalResults.push({
                 title: highlightedTitle,
                 path: item.path,
                 text: snippetHTML,
                 textFragment: '',
                 score: score + 50
             });
        }

        occurrences.forEach((occ, i) => {
             let contextStart = Math.max(0, occ.index - 50);
             let contextEnd = Math.min(item.text.length, occ.index + (occ.length || 20) + 50);
             
             // Snap to word boundaries
             while (contextStart > 0 && !/\s/.test(item.text[contextStart - 1])) contextStart--;
             while (contextEnd < item.text.length && !/\s/.test(item.text[contextEnd])) contextEnd++;

             let contextText = item.text.substring(contextStart, contextEnd);
             let textFragment = '';
             let highlightedChunk = '';

             if (occ.type === 'exact') {
                 const exactMatchStart = occ.index;
                 const exactMatchEnd = occ.index + occ.length;
                 const words = contextText.split(/\s+/);
                 let currentPos = contextStart;
                 let matchStartWordIndex = -1;
                 let matchEndWordIndex = -1;

                 for (let j = 0; j < words.length; j++) {
                     const wordStart = currentPos;
                     const wordEnd = wordStart + words[j].length;
                     if (wordStart < exactMatchEnd && wordEnd > exactMatchStart) {
                         if (matchStartWordIndex === -1) matchStartWordIndex = j;
                         matchEndWordIndex = j;
                     }
                     currentPos = wordEnd + 1; // +1 for space
                 }
                 
                 const matchedWords = matchStartWordIndex !== -1 
                     ? words.slice(matchStartWordIndex, matchEndWordIndex + 1).join(' ') 
                     : words[0] || '';
                     
                 const fragmentPrefix = matchStartWordIndex > 0 ? words[matchStartWordIndex - 1] : '';
                 const fragmentSuffix = matchEndWordIndex < words.length - 1 ? words[matchEndWordIndex + 1] : '';
                 
                 textFragment = generateTextFragment(matchedWords, fragmentPrefix, fragmentSuffix);
                 highlightedChunk = highlightIndices(item.text, [[occ.index, occ.index + occ.length - 1]], contextStart, contextEnd);
             } else {
                 let nearestHeading = null;
                 if (item.headings && item.headings.length > 0) {
                     for (let j = item.headings.length - 1; j >= 0; j--) {
                          if (item.headings[j].index <= occ.index) {
                              nearestHeading = item.headings[j];
                              break;
                          }
                     }
                 }
                 if (nearestHeading) {
                      textFragment = `#${nearestHeading.slug}`;
                 } else if (item.subheading) {
                      textFragment = `#${item.subheading}`;
                 }
                 highlightedChunk = highlightIndices(item.text, occ.indices, contextStart, contextEnd);
             }
             
             if (contextStart > 0) highlightedChunk = '...' + highlightedChunk;
             if (contextEnd < item.text.length) highlightedChunk = highlightedChunk + '...';

             finalResults.push({
                 title: highlightedTitle,
                 path: item.path,
                 text: highlightedChunk,
                 textFragment: textFragment,
                 score: score - i // slight penalty for subsequent occurrences
             });
        });
    });

    finalResults.sort((a, b) => b.score - a.score);
    updateSearchResults(finalResults);
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
