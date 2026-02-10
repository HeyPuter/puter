jQuery(document).ready(function () {
    //when doc is loaded scroll side nav to active section
    $('#sidebar').scrollTop($('#sidebar').scrollTop() + $('#sidebar a.active').position()?.top
        - $('#sidebar').height() / 2 + $('#sidebar a.active').height() / 2);

    // get github stars
    fetchGitHubData();
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

$(document).on('pathchange', function (e) {
    // remove active class from all sidebar links
    $('#sidebar a').removeClass('active');

    // iterate through all sidebar links and find the one that matches the current page
    $('#sidebar a').each(function () {
        if ( isCurrentPage($(this).attr('href')) ) {
            $(this).addClass('active');
            return false; // break out of the loop
        }
    });

    // close sidebar
    $('#sidebar-wrapper').removeClass('active');
    $('.sidebar-toggle-button').removeClass('active');
});

$(document).on('click', '.sidebar-toggle', function (e) {
    e.preventDefault();
    $('#sidebar-wrapper').toggleClass('active');
    $('.sidebar-toggle-button').toggleClass('active');
});

// clicking anywhere on the page will close the sidebar
$(document).on('click', function (e) {
    // print event target class

    if ( !$(e.target).closest('#sidebar-wrapper').length && !$(e.target).closest('.sidebar-toggle-button').length && !$(e.target).hasClass('sidebar-toggle-button') && !$(e.target).hasClass('sidebar-toggle') ) {
        $('#sidebar-wrapper').removeClass('active');
        $('.sidebar-toggle-button').removeClass('active');
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

$(document).on('change', '.dark-mode-toggle-checkbox', function () {
    $('body').toggleClass('dark', $(this).is(':checked'));
});