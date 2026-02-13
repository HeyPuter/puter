import $ from 'jquery';

$(document).ready(function () {
    //History API
    if ( window.history && window.history.pushState ) {
        // Initialize state for the first page
        if ( ! window.history.state ) {
            window.history.replaceState({ reload: true }, document.title, window.location.href);
        }

        $(window).on('popstate', function () {
            if ( window.history.state && window.history.state.reload ) {
                window.location.href = window.location.href;
            }
        });
    }
});

function isCurrentPage (str) {
    try {
        const resolved = new URL(str, window.location.href);
        const current = new URL(window.location.href);

        // Remove hash from both for comparison
        resolved.hash = '';
        current.hash = '';

        return resolved.href === current.href;
    } catch (e) {
        return false;
    }
}

function isExternalLink (href) {
    try {
        const url = new URL(href, window.location.href);
        return url.origin !== window.location.origin;
    } catch (e) {
        return false;
    }
}

function isPlaygroundLink (href) {
    try {
        const url = new URL(href, window.location.href);
        return url.pathname.startsWith('/playground/');
    } catch (e) {
        return false;
    }
}

$(document).on('click', 'a:not(.skip-insta-load):not([target="_blank"])', function (e) {
    // modifier keys
    if ( e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) return;
    // special case handling
    const href = $(this).attr('href');
    if ( isCurrentPage(href) || isExternalLink(href) || isPlaygroundLink(href) ) return;

    e.preventDefault();

    // reset progress bar
    $('#progress-bar').css('width', '0%');
    $('#progress-bar').show();

    // History API
    try {
        window.history.pushState({ reload: true }, document.title, $(this).attr('href'));
    } catch (e) {
        console.error('Error: Failed to push state.', e);
    }

    let progressTimer;

    $.ajax({
        url: $(this).attr('href'),
        beforeSend: function () {
            let progress = 0;

            progressTimer = setInterval(() => {
                progress += Math.random() * 10;
                if ( progress >= 90 ) {
                    progress = 90;
                    clearInterval(progressTimer);
                }
                $('#progress-bar').css('width', `${progress }%`);
            }, 150);
        },
    }).done(function (data) {
        clearInterval(progressTimer);
        $('#progress-bar').css('width', '100%');

        $('.docs-content').html($(data).find('.docs-content').html());
        $('#toc-wrapper').html($(data).find('#toc-wrapper').html());

        setTimeout(() => {
            $('body').animate({
                scrollTop: 0,
            }, 100);
        }, 30);

        //set title of page
        let title = $(data).filter('title').text();
        if ( ! title )
        {
            title = $(data).find('title').text();
        }
        document.title = title;

        // update description meta tag
        let description = $(data).filter('meta[name="description"]').attr('content');
        if ( ! description )
        {
            description = $(data).find('meta[name="description"]').attr('content');
        }
        if ( description ) {
            let descriptionMeta = $('meta[name="description"]');
            if ( descriptionMeta.length === 0 ) {
                descriptionMeta = $('<meta name="description">').appendTo('head');
            }
            descriptionMeta.attr('content', description);
        }

        // update canonical URL
        let canonical = $('link[rel="canonical"]');
        if ( canonical.length === 0 ) {
            canonical = $('<link rel="canonical">').appendTo('head');
        }
        canonical.attr('href', window.location.href);
        // Hide or reset progress bar
        setTimeout(() => {
            $('#progress-bar').fadeOut(100);
        }, 1000);
        clarity('identify', (sessionStorage.cid ??= crypto.randomUUID()));
        $.event.trigger('pathchange');
    }).fail(function (e) {
        clearInterval(progressTimer);
        $('#progress-bar').css('width', '100%');

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
