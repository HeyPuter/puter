import $ from 'jquery';

// The sidebar's "What's new" link shows a dot when the changelog has a day newer
// than the reader's last visit to it, which the changelog page records. A reader's
// first page view only records today's newest day, so they don't get a dot for
// entries that came before them.
const SEEN_KEY = 'changelogSeen';

function readSeen () {
    try {
        return localStorage.getItem(SEEN_KEY);
    } catch ( e ) {
        return null;
    }
}

function writeSeen (value) {
    try {
        localStorage.setItem(SEEN_KEY, value);
    } catch ( e ) {
        // Without storage the dot never shows, which is fine.
    }
}

function updateDot () {
    const link = document.querySelector('.changelog-link');
    const latest = link?.dataset.latest;
    if ( ! latest ) return;

    let seen = readSeen();
    if ( seen === null ) {
        writeSeen(latest);
        seen = latest;
    }
    // Days are YYYY-MM-DD, so string order is date order.
    link.classList.toggle('has-unread', seen < latest);
}

$(document).ready(updateDot);

// The changelog opens in another tab, and records the visit there.
window.addEventListener('storage', function (e) {
    if ( e.key === SEEN_KEY ) updateDot();
});
