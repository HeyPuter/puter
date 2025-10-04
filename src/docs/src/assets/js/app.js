// Global search index
let searchIndex = [];
let searchTimeout = null;
let selectedSearchResult = -1;

const icons = {
    ai_outline: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>`,
    ai_active: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>`,
    fs_outline: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-icon lucide-cloud"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    fs_active: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-icon lucide-cloud"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    kv_outline: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database-icon lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
    kv_active: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database-icon lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
    hosting_outline: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe-icon lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
    hosting_active: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe-icon lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
    auth_outline: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-lock-icon lucide-user-lock"><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><path d="M15 15.5V14a2 2 0 0 1 4 0v1.5"/><rect width="8" height="5" x="13" y="16" rx=".899"/></svg>`,
    auth_active: `<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-lock-icon lucide-user-lock"><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><path d="M15 15.5V14a2 2 0 0 1 4 0v1.5"/><rect width="8" height="5" x="13" y="16" rx=".899"/></svg>`,
    command: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-command-icon lucide-command"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>`
}

jQuery(document).ready(function() {
    //when doc is loaded scroll side nav to active section
    $('#sidebar').scrollTop($('#sidebar').scrollTop() + $('#sidebar a.active').position()?.top
    - $('#sidebar').height()/2 + $('#sidebar a.active').height()/2);
    //History API
    if (window.history && window.history.pushState) {
        $(window).on('popstate', function() {
            if (window.history.state.reload) {
                window.location.href = window.location.href;
            }
        });
    }

    // add icons to .icon elements
    $('.example-group').each(function() {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    });

    $('.example-group.active').each(function() {
        $(this).find('.icon').html(icons[$(this).data('icon-active')]);
    });

    // "Copy code" buttons
    $(document).on('click', '.copy-code-button', function(e) {
        const $codeWrapper = $(this).closest('.code-wrapper')
        const $codeBlock = $codeWrapper.find('code').first();

        navigator.clipboard.writeText($codeBlock.text());
        // show check mark for 1 second after copying
        $(this).find('.copy').css('background-image', 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23012238\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'20 6 9 17 4 12\'/%3E%3C/svg%3E")');
        setTimeout(() => {
            $(this).find('.copy').css('background-image', '');
        }, 1000);
    })

    // "Download code" buttons
    $(document).on('click', '.download-code-button', function(e) {
        const $codeWrapper = $(this).closest('.code-wrapper')
        const $codeBlock = $codeWrapper.find('code').first();
        const $filename = 'puter-example.html';
        const $code = $codeBlock.text();

        const blob = new Blob([$code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = $filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    })

    // Dropdown toggle functionality
    $(document).on('click', '.dropdown-button', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $('.menu-dropdown-items').toggle();
    });

    // Menu button click handlers
    $(document).on('click', '#menu-copy-page', async function(e) {
        const markdownUrl = new URL("index.md", window.location.href).toString();
        try {
            /**
             * The MIT License (MIT) Copyright (c) 2021 Cloudflare, Inc.
             * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
             * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
             */
            const clipboardItem = new ClipboardItem({
            ["text/plain"]: fetch(markdownUrl)
                .then((r) => r.text())
                .then((t) => new Blob([t], { type: "text/plain" }))
                .catch((e) => {
                throw new Error(`Received ${e.message} for ${markdownUrl}`);
                }),
            });

            await navigator.clipboard.write([clipboardItem]);

            const buttonElement = document.querySelector("#menu-copy-page span");
            const originalContent = buttonElement.innerHTML;
            buttonElement.textContent = "Copied!";

            setTimeout(() => {
                buttonElement.innerHTML = originalContent;
            }, 2000);
        } catch (error) {
            console.error("Failed to copy Markdown:", error);
        }
    });

    $(document).on('click', '#menu-view-markdown', function(e) {
        window.open(new URL("index.md", window.location.href),"_blank");
    });

    $(document).on('click', '#menu-open-chatgpt', function(e) {
        const message = `Read from ${window.location.href} so I can ask questions about it.`;
        window.open(`https://chat.openai.com/?q=${message}`, "_blank");
    });

    $(document).on('click', '#menu-open-claude', function(e) {
        const message = `Read from ${window.location.href} so I can ask questions about it.`;
        window.open(`https://claude.ai/new?q=${message}`, "_blank");
    });

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcut = isMac ? `${icons.command}&nbsp;<span>K</span>` : 'Ctrl K';
    
    const $searchTrigger = $('.search-trigger');
    const $shortcutElement = $('<div>')
        .addClass('search-trigger-shortcut')
        .html(shortcut);
    $searchTrigger.append($shortcutElement);

    // search handlers
    function openSearchUI() {
        $('.search-overlay').addClass('active');
        $('body').css('overflow', 'hidden');
        $('.search-input').val('').focus();
        updateSearchResults([]);
    }

    function closeSearchUI() {
        $('.search-overlay').removeClass('active');
        $('body').css('overflow', 'auto');
    }

    $(document).on('click', '.search-trigger', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openSearchUI();
    });

    $(document).on('keydown', function(e) {
        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
            e.stopPropagation();
            e.preventDefault();
            openSearchUI();
        }

        if (e.key === 'Escape' && $('.search-overlay').hasClass('active')) {
            e.stopPropagation();
            e.preventDefault();
            closeSearchUI();
        }
        
        // Arrow key navigation in search results
        if ($('.search-overlay').hasClass('active')) {
            if (e.key === 'ArrowDown') {
                e.stopPropagation();
                e.preventDefault();
                navigateSearchResults('down');
            } else if (e.key === 'ArrowUp') {
                e.stopPropagation();
                e.preventDefault();
                navigateSearchResults('up');
            } else if (e.key === 'Enter' && selectedSearchResult >= 0) {
                e.stopPropagation();
                e.preventDefault();
                closeSearchUI();
                activateSelectedResult();
            }
        }
    });

    $(document).on('click', '.search-overlay', function(e) {
        if (e.target === this) {
            closeSearchUI();
        }
    });

    $(document).on('click', '.search-result', function(e) {
        closeSearchUI();
    });

    $(document).on('input', '.search-input', function(e) {
        const query = $(this).val().trim();
        
        // Clear existing timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        // Set new timeout for debouncing
        searchTimeout = setTimeout(async () => {
            if (searchIndex.length == 0) {
                await fetchSearchIndex();
            }
            performSearch(query);
        }, 300);
    });

    // get github stars
    fetchGitHubData();

    // fetch search index
    fetchSearchIndex();
});

$(document).on('click', '.example-group', function(e) {
    e.preventDefault();
    $('.example-group').removeClass('active');
    // change all icons to outline
    $('.example-group').not(this).each(function() {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    });
    $(this).toggleClass('active');
    // change icon
    if ($(this).hasClass('active')) {
        $(this).find('.icon').html(icons[$(this).data('icon-active')]);
    } else {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    }
    // show content
    $('.example-content').hide();
    let section = $(this).data('section');
    if ($(this).hasClass('active')) {
        $(`.example-content[data-section="${section}"]`).show();
    }
})

$(document).on('click', '.sidebar-toggle', function(e) {
    e.preventDefault();
    $('#sidebar-wrapper').toggleClass('active');
    $('.sidebar-toggle-button').toggleClass('active');
})

// clicking anywhere on the page will close the sidebar and menu dropdown
$(document).on('click', function(e) {
    // print event target class
    
    if (!$(e.target).closest('#sidebar-wrapper').length && !$(e.target).closest('.sidebar-toggle-button').length && !$(e.target).hasClass('sidebar-toggle-button') && !$(e.target).hasClass('sidebar-toggle')) {
        $('#sidebar-wrapper').removeClass('active');
        $('.sidebar-toggle-button').removeClass('active');
    }

    // Close menu dropdown if clicking outside
    if (!$(e.target).closest('.menu-item-main').length) {
        $('.menu-dropdown-items').hide();
    }
    if (!$(e.target).closest('.menu-item').length) {
        $('.menu-dropdown-items').hide();
    }
})

$(document).on('click', '#sidebar a:not(.skip-insta-load), .next-prev-button', function(e) {
	e.preventDefault();
	$('#sidebar a').removeClass('active');
	$(this).addClass('active');

    if($(this).hasClass('next-prev-button')){
        // get the next or previous link
        var $nextPrevLink = $(this).attr('href');
        // find the sidebar link that matches the next or previous link
        var $sidebarLink = $(`#sidebar a[href="${$nextPrevLink}"]`);
        // remove active class from all sidebar links
        $('#sidebar a').removeClass('active');
        // add active class to the sidebar link that matches the next or previous link
        $sidebarLink.addClass('active');
    }
    
    // reset progress bar
    $('#progress-bar').css('width', '0%');
    $('#progress-bar').show();

    // History API
    try{
        window.history.pushState({reload: true}, document.title, $(this).attr('href'));
    }catch(e){
        console.error('Error: Failed to push state.', e);
    }

    $.ajax({
        url: $(this).attr('href'),
        xhr: function() {
            var xhr = new window.XMLHttpRequest();
            xhr.onprogress = function(e) {
                if (e.lengthComputable) {
                    var percentComplete = e.loaded / e.total * 100;
                    $('#progress-bar').css('width', percentComplete + '%');
                }
            };
            return xhr;
        }
    }).done(function(data) {
		$('.docs-content').html($(data).find('.docs-content').html());
        // highlight code
        $(`code[class^='language']`).each(function() {
            var $this = $(this);
            if ($this.attr('data-highlighted') === 'yes') {
                // Remove the attribute or set it to 'no'
                $this.removeAttr('data-highlighted');
            }
            // Now you can re-highlight
            else{
                try{
                    hljs.configure({ignoreUnescapedHTML: true});
                    hljs.highlightElement(this);
                }catch(e){
                    console.error('Error: Failed to highlight.', e);
                }
            }
        });
        
        // add icons to .icon elements
        $('.example-group').each(function() {
            $(this).find('.icon').html(icons[$(this).data('icon')]);
        });

        $('.example-group.active').each(function() {
            $(this).find('.icon').html(icons[$(this).data('icon-active')]);
        });

        setTimeout(() => {
            $('body').animate({
                scrollTop: 0
            }, 100);
        }, 30);
        // close sidebar
        $('#sidebar-wrapper').removeClass('active');
        $('.sidebar-toggle-button').removeClass('active');
    
		//set title of page
        let title = $(data).filter('title').text();
        if(!title)
            title = $(data).find('title').text();
		document.title = title;
        
        // update canonical URL
        let canonical = $('link[rel="canonical"]');
        if (canonical.length === 0) {
            canonical = $('<link rel="canonical">').appendTo('head');
        }
        canonical.attr('href', window.location.href);
        // Hide or reset progress bar
        setTimeout(() => {
            $('#progress-bar').fadeOut(100);
        }, 1000);
	}).fail(function(e) {
        // Handle the error here
        console.error('Error: Failed to load the content.', e);
        // Optionally, display an error message to the user
        $('.docs-content').html('<p>Error loading content.</p>');
        // Hide or reset progress bar
        setTimeout(() => {
            $('#progress-bar').fadeOut(100);
        }, 1000);
    });

    return false;
});


async function fetchSearchIndex() {
    try {
        const response = await fetch('/index.json');
        const data = await response.json();
        searchIndex = data;
        console.log('Search index loaded:', searchIndex.length + ' items');
    } catch (error) {
        console.error('Failed to load search index:', error);
        searchIndex = [];
    }
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateTextFragment(matchedText, prefix = '', suffix = '') {
    const encodedText = encodeURIComponent(matchedText);
    const encodedPrefix = prefix ? encodeURIComponent(prefix) + '-,' : '';
    const encodedSuffix = suffix ? ',-' + encodeURIComponent(suffix) : '';
    
    return `#:~:text=${encodedPrefix}${encodedText}${encodedSuffix}`;
}

function performSearch(query) {
    if (!query || query.length < 2) {
        $('.search-results').html('<div class="search-no-results">Start typing to search...</div>');
        return;
    }
    
    const titleResults = [];
    const textResults = [];
    const queryLower = query.toLowerCase();
    
    searchIndex.forEach(item => {
        const titleMatch = item.title.toLowerCase().indexOf(queryLower);
        if (titleMatch !== -1) {
            const highlightedTitle = escapeHtml(item.title).replace(
                new RegExp(`(${escapeHtml(query)})`, 'i'),
                '<mark>$1</mark>'
            );
            
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
        while (true) {
            const textMatch = textLower.indexOf(queryLower, searchOffset);
            if (textMatch === -1) break;
            
            // Extract 50 chars before and after the match
            const contextStart = Math.max(0, textMatch - 50);
            const contextEnd = Math.min(item.text.length, textMatch + query.length + 50);
            const contextText = item.text.substring(contextStart, contextEnd);
            
            // Split into words
            const words = contextText.split(/\s+/);
            
            // Find all words that intersect with the match range
            const matchStart = textMatch;
            const matchEnd = textMatch + query.length;
            let matchStartWordIndex = -1;
            let matchEndWordIndex = -1;
            let currentPos = contextStart;
            
            for (let i = 0; i < words.length; i++) {
                const wordStart = currentPos;
                const wordEnd = wordStart + words[i].length;
                
                // Check if this word intersects with the match
                if (wordStart < matchEnd && wordEnd > matchStart) {
                    if (matchStartWordIndex === -1) {
                        matchStartWordIndex = i;
                    }
                    matchEndWordIndex = i;
                }
                currentPos = wordEnd + 1; // +1 for space
            }
            
            // Get the complete matched text (all words that contain the match)
            const matchedWords = matchStartWordIndex !== -1 ? 
                words.slice(matchStartWordIndex, matchEndWordIndex + 1).join(' ') : 
                words[0] || '';
            
            // Get prefix and suffix for text fragment (closest words)
            const fragmentPrefix = matchStartWordIndex > 0 ? words[matchStartWordIndex - 1] : '';
            const fragmentSuffix = matchEndWordIndex < words.length - 1 ? words[matchEndWordIndex + 1] : '';
            
            // Generate text fragment
            const textFragment = generateTextFragment(matchedWords, fragmentPrefix, fragmentSuffix);
            
            // Create display text (max 4 words before/after)
            const startWord = Math.max(0, matchStartWordIndex - 4);
            const endWord = Math.min(words.length, matchEndWordIndex + 5);
            const displayWords = words.slice(startWord, endWord);
            
            let displayText = displayWords.join(' ');
            if (startWord > 0) displayText = '...' + displayText;
            if (endWord < words.length) displayText = displayText + '...';
            
            // Highlight the matched text in display
            const highlightedChunk = escapeHtml(displayText).replace(
                new RegExp(`(${escapeHtml(query)})`, 'i'),
                '<mark>$1</mark>'
            );
            
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

function updateSearchResults(results) {
    if (results.length === 0) {
        $('.search-results').html('<div class="search-no-results">No results found</div>');
        selectedSearchResult = -1;
        return;
    }
    
    let html = '';
    results.slice(0, 15).forEach((result, index) => {
        const url = result.path + '/' + (result.textFragment || '');
        html += `
            <div class="search-result" data-index="${index}">
                <a href="${url}" class="search-result-link">
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

function updateSelectedResult() {
    $('.search-result').removeClass('selected');
    if (selectedSearchResult >= 0) {
        const $selected = $(`.search-result[data-index="${selectedSearchResult}"]`);
        $selected.addClass('selected');
        
        // Scroll the container to keep the selected result visible
        const $container = $('.search-results');
        const containerHeight = $container.height();
        const containerScrollTop = $container.scrollTop();
        const selectedOffset = $selected.offset().top;
        const containerOffset = $container.offset().top;
        const selectedRelativeTop = selectedOffset - containerOffset + containerScrollTop;
        const selectedHeight = $selected.outerHeight();
        
        if (selectedRelativeTop < containerScrollTop) {
            // Selected result is above the visible area
            $container.scrollTop(selectedRelativeTop);
        } else if (selectedRelativeTop + selectedHeight > containerScrollTop + containerHeight) {
            // Selected result is below the visible area
            $container.scrollTop(selectedRelativeTop + selectedHeight - containerHeight);
        }
    }
}

function navigateSearchResults(direction) {
    const $results = $('.search-result');
    if ($results.length === 0) return;
    
    if (direction === 'down') {
        selectedSearchResult = selectedSearchResult < $results.length - 1 ? selectedSearchResult + 1 : selectedSearchResult;
    } else if (direction === 'up') {
        selectedSearchResult = selectedSearchResult >= 0 ? selectedSearchResult - 1 : selectedSearchResult;
    }
    
    updateSelectedResult();
}

function activateSelectedResult() {
    if (selectedSearchResult >= 0) {
        const $selected = $(`.search-result[data-index="${selectedSearchResult}"] .search-result-link`);
        if ($selected.length) {
            window.location.href = $selected.attr('href');
        }
    }
}

function fetchGitHubData() {
    // GitHub API fetching and handling

    const url = "https://api.github.com/repos/HeyPuter/puter";

    function formatNumber(num) {
        if (num < 1000) {
            return num; // return the same number if less than 1000
        } else if (num < 1000000) {
            return (num / 1000).toFixed(1) + 'K'; // convert to K for thousands
        } else {
            return (num / 1000000).toFixed(1) + 'M'; // convert to M for millions
        }
    }

    $.getJSON(url, function (data) {
        $('.github-stars').text(formatNumber(data.stargazers_count) + "");
    }).fail(function (jqxhr, textStatus, error) {
        let err = textStatus + ", " + error;
        console.error("Request Failed: " + err);
        $('.github-stars').text('Heyputer/Puter');
    });
}

$(document).on('change', '.dark-mode-toggle-checkbox', function() {
    $('body').toggleClass('dark', $(this).is(':checked'));
});