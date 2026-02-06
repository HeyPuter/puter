/* global require, monaco, clarity */
let editor;
// on document load
document.addEventListener('DOMContentLoaded', function () {
    // load monaco editor
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
        // get editor element
        var editorElement = document.getElementById('code');
        // create editor
        editor = monaco.editor.create(editorElement, {
            language: 'html',
            fontFamily: 'monospace',
            minimap: {
                enabled: false,
            },
        });
        editor.updateOptions({ fontFamily: 'monospace' });

        // Load initial code from iframe
        editor.setValue(document.getElementById('initial-code').textContent);
        // auto run?
        var urlParams = new URLSearchParams(window.location.search);
        var autoRun = urlParams.get('autorun');
        if ( autoRun ) {
            loadStringInIframe(editor.getValue());
        }
    });

    function fetchGitHubData () {
        // GitHub API fetching and handling

        const url = 'https://api.github.com/repos/HeyPuter/puter';

        function formatNumber (num) {
            if ( num < 1000 ) {
                return num; // return the same number if less than 1000
            } else if ( num < 1000000 ) {
                return `${(num / 1000).toFixed(1) }K`; // convert to K for thousands
            } else {
                return `${(num / 1000000).toFixed(1) }M`; // convert to M for millions
            }
        }

        $.getJSON(url, function (data) {
            $('.github-stars').text(`${formatNumber(data.stargazers_count) }`);
        }).fail(function (jqxhr, textStatus, error) {
            let err = `${textStatus }, ${ error}`;
            console.error(`Request Failed: ${ err}`);
            $('.github-stars').text('Heyputer/Puter');
        });
    }

    fetchGitHubData();
});

// Attach the resize event listener to the window
window.addEventListener('resize', () => {
    editor.layout();
});

function loadStringInIframe (str) {
    // Create a new iframe element
    var iframe = document.createElement('iframe');

    // set iframe id
    iframe.id = 'output-iframe';

    // append to output
    var output = document.getElementById('output');
    output.innerHTML = '';
    output.appendChild(iframe);

    // Get the document of the iframe
    var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

    // Write the string content into the iframe
    iframeDoc.open();
    iframeDoc.write(str);
    iframeDoc.close();
}

// ctrl + enter to run
document.addEventListener('keydown', function (e) {
    if ( e.ctrlKey && e.key === 'Enter' ) {
        loadStringInIframe(editor.getValue());
    }
});

var run = document.getElementById('run');
run.addEventListener('click', function () {
    loadStringInIframe(editor.getValue());
});

// Resizer functionality
const resizer = document.querySelector('.resizer');
const codeContainer = document.getElementById('code-container');
const outputContainer = document.getElementById('output-container');
let isResizing = false;
let startX;
let startWidthCode;
let startWidthOutput;

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('dragging');
    startX = e.pageX;
    startWidthCode = codeContainer.offsetWidth;
    startWidthOutput = outputContainer.offsetWidth;

    // Disable pointer events on iframe during resize
    const iframe = document.getElementById('output-iframe');
    if ( iframe ) {
        iframe.style.pointerEvents = 'none';
    }
});

document.addEventListener('mousemove', (e) => {
    if ( ! isResizing ) return;

    const parentWidth = codeContainer.parentElement.offsetWidth;
    const diffX = e.pageX - startX;

    const newCodeWidth = ((startWidthCode + diffX) / parentWidth * 100);
    const newOutputWidth = ((startWidthOutput - diffX) / parentWidth * 100);

    // Set minimum width to 20%
    if ( newCodeWidth >= 20 && newOutputWidth >= 20 ) {
        codeContainer.style.width = `${newCodeWidth}%`;
        outputContainer.style.width = `${newOutputWidth}%`;
        editor.layout(); // Resize Monaco editor
    }
});

document.addEventListener('mouseup', () => {
    if ( isResizing ) {
        isResizing = false;
        resizer.classList.remove('dragging');

        // Re-enable pointer events on iframe after resize
        const iframe = document.getElementById('output-iframe');
        if ( iframe ) {
            iframe.style.pointerEvents = 'auto';
        }
    }
});

// Sidebar toggle functionality
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarContainer = document.getElementById('sidebar-container');

// Collapse sidebar by default on mobile
if ( window.innerWidth <= 768 ) {
    sidebarContainer.classList.add('collapsed');
}

sidebarToggle.addEventListener('click', () => {
    sidebarContainer.classList.toggle('collapsed');
    // Re-layout editor
    if ( editor ) {
        editor.layout();
    }
});

// Highlight active example in sidebar
function updateActiveSidebarItem () {
    const currentPath = window.location.pathname;
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    sidebarItems.forEach(item => {
        if ( item.getAttribute('href') === currentPath ) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}
updateActiveSidebarItem();

// Scroll sidebar to center the active item on first load
const sidebar = document.querySelector('.sidebar');
const activeItem = document.querySelector('.sidebar-item.active');
if ( sidebar && activeItem ) {
    const sidebarRect = sidebar.getBoundingClientRect();
    const activeItemRect = activeItem.getBoundingClientRect();
    const scrollOffset = activeItemRect.top - sidebarRect.top + sidebar.scrollTop
        - sidebar.clientHeight / 2 + activeItem.clientHeight / 2;
    sidebar.scrollTop = scrollOffset;
}

// Client-side routing for sidebar links
document.addEventListener('click', function (e) {
    // Check if clicked element is a sidebar item
    const sidebarItem = e.target.closest('.sidebar-item');
    if ( ! sidebarItem ) return;

    // Collapse sidebar by default on mobile after clicking a link
    if ( window.innerWidth <= 768 ) {
        sidebarContainer.classList.add('collapsed');
    }

    // Don't intercept if modifier keys are pressed
    if ( e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) return;

    const href = sidebarItem.getAttribute('href');
    if ( ! href ) return;

    // Don't intercept external links or current page
    try {
        const url = new URL(href, window.location.href);
        if ( url.origin !== window.location.origin ) return;
        if ( url.pathname === window.location.pathname ) return;
    } catch ( err ) {
        return;
    }

    e.preventDefault();

    // Update history
    window.history.pushState({ reload: true }, '', href);

    // Clear the preview/output
    const output = document.getElementById('output');
    if ( output ) {
        output.innerHTML = '';
    }

    // Fetch the new page
    $.ajax({
        url: href,
        method: 'GET',
    }).done(function (data) {
        // Parse the HTML response
        const parser = new DOMParser();
        const doc = parser.parseFromString(data, 'text/html');

        // Extract code content from the initial-code iframe
        const initialCodeIframe = doc.getElementById('initial-code');
        if ( initialCodeIframe && editor ) {
            const newCode = initialCodeIframe.textContent;
            editor.setValue(newCode);
        }

        // Update page title
        const newTitle = doc.querySelector('title');
        if ( newTitle ) {
            document.title = newTitle.textContent;
        }

        // Update meta description
        const newDescription = doc.querySelector('meta[name="description"]');
        if ( newDescription ) {
            let descriptionMeta = document.querySelector('meta[name="description"]');
            if ( ! descriptionMeta ) {
                descriptionMeta = document.createElement('meta');
                descriptionMeta.setAttribute('name', 'description');
                document.head.appendChild(descriptionMeta);
            }
            descriptionMeta.setAttribute('content', newDescription.getAttribute('content'));
        }

        // Update canonical URL
        const newCanonical = doc.querySelector('link[rel="canonical"]');
        if ( newCanonical ) {
            let canonical = document.querySelector('link[rel="canonical"]');
            if ( ! canonical ) {
                canonical = document.createElement('link');
                canonical.setAttribute('rel', 'canonical');
                document.head.appendChild(canonical);
            }
            canonical.setAttribute('href', newCanonical.getAttribute('href'));
        }

        // Update Open Graph tags
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        if ( ogTitle ) {
            let ogTitleMeta = document.querySelector('meta[property="og:title"]');
            if ( ! ogTitleMeta ) {
                ogTitleMeta = document.createElement('meta');
                ogTitleMeta.setAttribute('property', 'og:title');
                document.head.appendChild(ogTitleMeta);
            }
            ogTitleMeta.setAttribute('content', ogTitle.getAttribute('content'));
        }

        const ogDescription = doc.querySelector('meta[property="og:description"]');
        if ( ogDescription ) {
            let ogDescriptionMeta = document.querySelector('meta[property="og:description"]');
            if ( ! ogDescriptionMeta ) {
                ogDescriptionMeta = document.createElement('meta');
                ogDescriptionMeta.setAttribute('property', 'og:description');
                document.head.appendChild(ogDescriptionMeta);
            }
            ogDescriptionMeta.setAttribute('content', ogDescription.getAttribute('content'));
        }

        const ogUrl = doc.querySelector('meta[name="og:url"]');
        if ( ogUrl ) {
            let ogUrlMeta = document.querySelector('meta[name="og:url"]');
            if ( ! ogUrlMeta ) {
                ogUrlMeta = document.createElement('meta');
                ogUrlMeta.setAttribute('name', 'og:url');
                document.head.appendChild(ogUrlMeta);
            }
            ogUrlMeta.setAttribute('content', ogUrl.getAttribute('content'));
        }

        // Update Twitter Card tags
        const twitterTitle = doc.querySelector('meta[name="twitter:title"]');
        if ( twitterTitle ) {
            let twitterTitleMeta = document.querySelector('meta[name="twitter:title"]');
            if ( ! twitterTitleMeta ) {
                twitterTitleMeta = document.createElement('meta');
                twitterTitleMeta.setAttribute('name', 'twitter:title');
                document.head.appendChild(twitterTitleMeta);
            }
            twitterTitleMeta.setAttribute('content', twitterTitle.getAttribute('content'));
        }

        const twitterDescription = doc.querySelector('meta[name="twitter:description"]');
        if ( twitterDescription ) {
            let twitterDescriptionMeta = document.querySelector('meta[name="twitter:description"]');
            if ( ! twitterDescriptionMeta ) {
                twitterDescriptionMeta = document.createElement('meta');
                twitterDescriptionMeta.setAttribute('name', 'twitter:description');
                document.head.appendChild(twitterDescriptionMeta);
            }
            twitterDescriptionMeta.setAttribute('content', twitterDescription.getAttribute('content'));
        }

        clarity('identify', (sessionStorage.cid ??= crypto.randomUUID()));

        // Update active sidebar item
        updateActiveSidebarItem();
    }).fail(function (error) {
        console.error('Failed to load page:', error);
        // On error, do a full page load
        window.location.href = href;
    });
});

// Handle popstate (back/forward navigation) with reload
window.addEventListener('popstate', function () {
    if ( window.history.state && window.history.state.reload ) {
        window.location.reload();
    }
});

// Sidebar search functionality
const searchInput = document.getElementById('sidebar-search-input');
const noResultsMessage = document.querySelector('.sidebar-no-results');

if ( searchInput ) {
    searchInput.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase().trim();
        const categories = document.querySelectorAll('.sidebar-category');
        let totalVisible = 0;

        categories.forEach(category => {
            const items = category.querySelectorAll('.sidebar-item');
            let categoryHasVisibleItems = false;

            items.forEach(item => {
                const title = item.getAttribute('data-title') || item.textContent.toLowerCase();
                const matches = query === '' || title.includes(query);

                if ( matches ) {
                    item.classList.remove('hidden');
                    categoryHasVisibleItems = true;
                    totalVisible++;
                } else {
                    item.classList.add('hidden');
                }
            });

            // Also check category title
            const categoryTitle = category.getAttribute('data-category') || '';
            if ( categoryTitle.includes(query) ) {
                // Show all items in this category
                items.forEach(item => {
                    item.classList.remove('hidden');
                    totalVisible++;
                });
                categoryHasVisibleItems = true;
            }

            if ( categoryHasVisibleItems || query === '' ) {
                category.classList.remove('hidden');
            } else {
                category.classList.add('hidden');
            }
        });

        // Show/hide no results message
        if ( noResultsMessage ) {
            if ( totalVisible === 0 && query !== '' ) {
                noResultsMessage.classList.add('visible');
            } else {
                noResultsMessage.classList.remove('visible');
            }
        }
    });

    // Clear search on Escape
    searchInput.addEventListener('keydown', function (e) {
        if ( e.key === 'Escape' ) {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            searchInput.blur();
        }
    });
}