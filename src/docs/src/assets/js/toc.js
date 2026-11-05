import $ from 'jquery';

// Highlight the table-of-contents link for the section being read, so the
// reader can see where they are on the page.

// A heading becomes the current section once its top scrolls above this many
// pixels from the top of the window.
const ACTIVE_OFFSET = 120;

let activeLink = null;
let pendingFrame = null;

function findActiveLink () {
    const links = [...document.querySelectorAll('#toc-wrapper .toc-link')];
    if ( links.length === 0 ) return null;

    const sections = links
        .map(link => ({ link, heading: document.getElementById(link.getAttribute('href').slice(1)) }))
        .filter(section => section.heading);

    // At the bottom of the page the last sections can't scroll up to the
    // offset, so the last one counts as current.
    const page = document.scrollingElement;
    if ( sections.length > 0 && window.innerHeight + window.scrollY >= page.scrollHeight - 2 ) {
        return sections[sections.length - 1].link;
    }

    // Before the first heading, the page title link is current.
    let current = links[0];
    for ( const { link, heading } of sections ) {
        if ( heading.getBoundingClientRect().top > ACTIVE_OFFSET ) break;
        current = link;
    }
    return current;
}

// Scroll the TOC itself just enough to show the active link.
function keepInView (link) {
    const toc = link.closest('.table-of-contents');
    if ( ! toc ) return;
    const tocBox = toc.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    if ( linkBox.top < tocBox.top ) {
        toc.scrollTop -= tocBox.top - linkBox.top;
    } else if ( linkBox.bottom > tocBox.bottom ) {
        toc.scrollTop += linkBox.bottom - tocBox.bottom;
    }
}

// The bar beside the active link is one element that moves to the link and
// takes its height, so it slides and resizes between entries of different
// heights instead of jumping.
function moveIndicator (link) {
    const nav = link.closest('.toc-nav');
    if ( ! nav ) return;
    let indicator = nav.querySelector('.toc-indicator');
    const isNew = ! indicator;
    if ( isNew ) {
        indicator = document.createElement('div');
        indicator.className = 'toc-indicator';
        indicator.style.transition = 'none';
        nav.append(indicator);
    }
    // Measured from the boxes rather than offsetTop, which rounds to whole
    // pixels and can leave the bar a pixel off the link.
    const linkBox = link.getBoundingClientRect();
    const transform = `translateY(${linkBox.top - nav.getBoundingClientRect().top}px)`;
    const height = `${linkBox.height}px`;
    if ( indicator.style.transform !== transform ) indicator.style.transform = transform;
    if ( indicator.style.height !== height ) indicator.style.height = height;
    if ( isNew ) {
        // Place a new indicator without animating it in from the top.
        indicator.getBoundingClientRect();
        indicator.style.transition = '';
    }
}

function updateActiveLink () {
    pendingFrame = null;
    const link = findActiveLink();
    if ( link !== activeLink ) {
        activeLink?.classList.remove('active');
        activeLink = link;
        if ( link ) {
            link.classList.add('active');
            keepInView(link);
        }
    }
    // Also runs when only the layout changed, such as a resize that rewraps
    // the active link onto more lines.
    if ( link ) moveIndicator(link);
}

function scheduleUpdate () {
    if ( pendingFrame === null ) {
        pendingFrame = requestAnimationFrame(updateActiveLink);
    }
}

window.addEventListener('scroll', scheduleUpdate, { passive: true });
window.addEventListener('resize', scheduleUpdate);

$(document).ready(scheduleUpdate);

// The router replaces the TOC when it loads another page.
$(document).on('pathchange', function () {
    activeLink = null;
    scheduleUpdate();
});
