$(document).ready(function () {
    if ( page === 'login' )
    {
        $('#email_or_username').focus();
    }
    else if ( page === 'password-recovery' )
    {
        $('#email_or_username').focus();
    }
    else if ( page === 'set-new-password' )
    {
        $('#password').focus();
    }
});

window.is_email = (email) => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
};

$('#login-submit-btn').on('click', function () {
    const email_username = $('#email_or_username').val();
    const password = $('#password').val();
    let data;

    if ( is_email(email_username) ) {
        data = JSON.stringify({
            email: email_username,
            password: password,
        });
    } else {
        data = JSON.stringify({
            username: email_username,
            password: password,
        });
    }

    $('#login-error-msg').hide();

    $.ajax({
        url: '/login',
        type: 'POST',
        async: false,
        contentType: 'application/json',
        data: data,
        success: function (data) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_username', data.user.username);
            window.location.replace('/');
        },
        error: function (err) {
            $('#login-error-msg').html(err.responseText);
            $('#login-error-msg').fadeIn();
        },
    });
});

$('#pass-recovery-submit-btn').on('click', function (e) {
    const email_username = $('#email_or_username').val();
    let data;

    if ( is_email(email_username) ) {
        data = JSON.stringify({
            email: email_username,
        });
    } else {
        data = JSON.stringify({
            username: email_username,
        });
    }

    $('#login-error-msg').hide();

    $.ajax({
        url: '/send-pass-recovery-email',
        type: 'POST',
        async: false,
        contentType: 'application/json',
        data: data,
        success: function (data) {
            $('#email_or_username').val('');
            $('.pass-recovery-email-sent').html(data);
            $('.pass-recovery-email-sent').fadeIn();
        },
        error: function (err) {
            $('#login-error-msg').html(err.responseText);
            $('#login-error-msg').fadeIn();
        },
    });
});

$('.signup-btn').on('click', function (e) {
    let urlquery = new URLSearchParams(window.location.search);
    let tok;

    if ( urlquery.has('tok') )
    {
        tok = urlquery.get('tok');
    }

    // todo do some basic validation client-side
    //Username
    let username = $('#username').val();

    //Email
    let email = $('#email').val();

    //Password
    let password = $('#password').val();

    //xyzname
    let p102xyzname = $('#p102xyzname').val();

    // disable 'Create Account' button
    $('.signup-btn').prop('disabled', true);

    $.ajax({
        url: '/signup',
        type: 'POST',
        async: true,
        contentType: 'application/json',
        data: JSON.stringify({
            username: username,
            email: email,
            password: password,
            uuid: tok,
            p102xyzname: p102xyzname,
        }),
        success: function (data) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_username', data.user.username);
            window.location.replace('/');
        },
        error: function (err) {
            $('#signup-error-msg').html(err.responseText);
            $('#signup-error-msg').fadeIn();
            // re-enable 'Create Account' button
            $('.signup-btn').prop('disabled', false);
        },
    });
});

$('.signup-form, .login-form, .pass-recovery-form, .set-password-form').on('submit', function (e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
});

$('#set-new-pass-submit-btn').on('click', function (e) {
    // todo do some basic validation client-side

    //Password
    let password = $('#password').val();
    let token = $('#token').val();
    let user_id = $('#user_id').val();

    // disable submit button
    $('#set-new-pass-submit-btn').prop('disabled', true);

    $.ajax({
        url: '/set-pass-using-token',
        type: 'POST',
        async: true,
        contentType: 'application/json',
        data: JSON.stringify({
            password: password,
            token: token,
            user_id: user_id,
        }),
        success: function (data) {
            $('.success-msg').html('Password updated. <a href="/login"><strong>Log in</strong></a>.');
            $('.error-msg').hide();
            $('.success-msg').fadeIn();
            $('#password').val('');
        },
        error: function (err) {
            $('.error-msg').html(err.responseText);
            $('.error-msg').fadeIn();
            // re-enable 'Create Account' button
            $('#set-new-pass-submit-btn').prop('disabled', false);
        },
    });
});