// Tag + text filtering for the recipes index. Every card is rendered
// server-side with `data-tags` and `data-search`; this only shows and hides.

function initFilters () {
    const grid = document.querySelector('.recipe-grid');
    if ( ! grid ) return;   // detail pages have no grid

    const cards = [...grid.querySelectorAll('.recipe-card')];
    const checkboxes = [...document.querySelectorAll('.tag-filter')];
    const searchInput = document.getElementById('recipe-search');
    const empty = document.querySelector('.recipe-empty');
    const clearButton = document.querySelector('.clear-filters');

    const selectedTags = () => checkboxes.filter(cb => cb.checked).map(cb => cb.value);

    function apply () {
        const tags = selectedTags();
        const query = (searchInput?.value ?? '').trim().toLowerCase();
        let visible = 0;

        for ( const card of cards ) {
            const cardTags = (card.dataset.tags ?? '').split(' ').filter(Boolean);
            // OR within tags: a card matches if it carries any selected tag.
            // AND across the two filters: it must also match the search text.
            const tagMatch = tags.length === 0 || tags.some(tag => cardTags.includes(tag));
            const textMatch = query === '' || (card.dataset.search ?? '').includes(query);
            const show = tagMatch && textMatch;

            card.hidden = ! show;
            if ( show ) visible++;
        }

        if ( empty ) empty.hidden = visible > 0;
        if ( clearButton ) clearButton.hidden = tags.length === 0 && query === '';

        syncURL(tags);
    }

    // Keep the selected tags in the URL so a filtered view can be linked to —
    // the tag chips on recipe detail pages link straight into one.
    function syncURL (tags) {
        const url = new URL(window.location.href);
        if ( tags.length > 0 ) {
            url.searchParams.set('tags', tags.join(','));
        } else {
            url.searchParams.delete('tags');
        }
        window.history.replaceState(null, '', url);
    }

    function restoreFromURL () {
        const param = new URL(window.location.href).searchParams.get('tags');
        if ( ! param ) return;
        const wanted = param.split(',').map(t => t.trim()).filter(Boolean);
        for ( const cb of checkboxes ) {
            if ( wanted.includes(cb.value) ) cb.checked = true;
        }
    }

    checkboxes.forEach(cb => cb.addEventListener('change', apply));
    searchInput?.addEventListener('input', apply);
    clearButton?.addEventListener('click', () => {
        checkboxes.forEach(cb => { cb.checked = false; });
        if ( searchInput ) searchInput.value = '';
        apply();
    });

    restoreFromURL();
    apply();
}

if ( document.readyState === 'loading' ) {
    document.addEventListener('DOMContentLoaded', initFilters);
} else {
    initFilters();
}
