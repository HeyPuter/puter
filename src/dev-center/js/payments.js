// Payments tab: link a Glow wallet (a breez.tips Lightning address) and see
// the charges apps created. Puter never holds funds; charges pay the
// developer's wallet directly.

const STATUS_LABELS = { pending: 'Pending', completed: 'Paid', expired: 'Expired' };

function render_charges (charges) {
    if ( charges.length === 0 ) {
        $('#payments-charges').hide();
        $('#payments-no-charges').show();
        return;
    }
    let rows = '';
    for ( const charge of charges ) {
        rows += `<tr>
            <td>${html_encode(new Date(charge.createdAt).toLocaleString())}</td>
            <td>${html_encode(new Intl.NumberFormat().format(charge.amountSats))} sats</td>
            <td><span class="payments-status payments-status-${html_encode(charge.status)}">${html_encode(STATUS_LABELS[charge.status] ?? charge.status)}</span></td>
            <td>${html_encode(charge.description ?? '')}</td>
            <td>${html_encode(charge.lightningAddress)}</td>
            <td style="color:#8a8a94;">${html_encode(charge.id)}</td>
        </tr>`;
    }
    $('#payments-charges tbody').html(rows);
    $('#payments-no-charges').hide();
    $('#payments-charges').show();
}

const ERROR_COPY = {
    invalid_lightning_address: 'Enter a breez.tips address, like you@breez.tips. Get one by installing Glow.',
    lightning_address_not_found: 'That address does not exist on breez.tips. Check the spelling in Glow.',
    lightning_service_unavailable: 'breez.tips is not responding right now. Try again in a moment.',
    too_many_requests: 'Too many requests. Wait a minute and try again.',
};

function show_payments_error (message) {
    $('#payments-error').text(message).toggle(message !== '');
}

function payments_error_message (err, fallback) {
    return ERROR_COPY[err?.code] ?? err?.message ?? fallback;
}

window.refresh_payments = async () => {
    show_payments_error('');
    try {
        const settings = await puter.payments.getSettings();
        $('#payments-glow-link').attr('href', settings.glowSetupUrl);
        $('#payments-address').val(settings.lightningAddress ?? '');
        $('#payments-configured').toggle(!!settings.lightningAddress);
        const page = await puter.payments.listCharges({ limit: 50 });
        render_charges(page.items);
    } catch (err) {
        show_payments_error(payments_error_message(err, 'Could not load payment settings.'));
    }
    puter.ui.hideSpinner();
    if ( activeTab === 'payments' ) {
        $('#tab-payments').show();
    }
};

$(document).on('click', '.payments-save-btn', async function () {
    const address = $('#payments-address').val().trim();
    show_payments_error('');
    $(this).prop('disabled', true);
    try {
        const settings = await puter.payments.updateSettings({ lightningAddress: address === '' ? null : address });
        $('#payments-address').val(settings.lightningAddress ?? '');
        $('#payments-configured').toggle(!!settings.lightningAddress);
    } catch (err) {
        show_payments_error(payments_error_message(err, 'Could not save the Lightning address.'));
    }
    $(this).prop('disabled', false);
});

$(document).on('keydown', '#payments-address', function (e) {
    if ( e.key === 'Enter' ) {
        e.preventDefault();
        $('.payments-save-btn').trigger('click');
    }
});

$(document).on('click', '.payments-refresh-btn', function () {
    puter.ui.showSpinner();
    refresh_payments();
});
