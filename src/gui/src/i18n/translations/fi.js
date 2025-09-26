/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const fi = {
  name: "Suomi",
  english_name: "Finnish",
  code: "fi",
  dictionary: {
    about: "Tietoa",
    account: "Tili",
    account_password: "Vahvista tilin salasana",
    access_granted_to: "Käyttöoikeus myönnetty",
    add_existing_account: "Kirjaudu olemassaolevalla tilillä",
    all_fields_required: "Kaikki kentät on täytettävä.",
    allow: "Salli",
    apply: "Käytä", // TODO: Ambiguous meaning
    // To apply(a principle) => "Sovella" or
    // Apply for(a job) "Hae" or
    // Apply as(an engineer) => "Hakeudu" or
    // Apply an expression => "Applikoi" or - Probably the most appropriate in the context of the app
    // Apply in the sense of applying something, like a tool => "Käytä"

    ascending: "Nouseva",
    associated_websites: "Tähän liittyvät verkkosivustot",
    auto_arrange: "Järjestä automaattisesti",
    background: "Tausta",
    browse: "Selaa",
    cancel: "Peruuta",
    center: "Keskitä",
    change_desktop_background: "Vaihda työpöydän taustakuvaa…",
    change_email: "Vaihda sähköpostiosoite",
    change_language: "Vaihda kieli",
    change_password: "Vaihda salasana",
    change_ui_colors: "Vaihda käyttöliittymän värejä",
    change_username: "Vaihda käyttäjänimi",
    close: "Sulje",
    close_all_windows: "Sulje kaikki ikkunat",
    close_all_windows_confirm: "Haluatko varmasti sulkea kaikki ikkunat?",
    close_all_windows_and_log_out: "Sulje ikkunat ja kirjaudu ulos",
    change_always_open_with:
      "Haluatko aina avata tämän tyyppisen tiedoston sovelluksella",
    color: "Väri",
    confirm: "Vahvista",
    confirm_2fa_setup: "Olen lisännyt koodin todennussovellukseeni",
    confirm_2fa_recovery:
      "Olen tallentanut palautuskoodini turvalliseen paikkaan",
    confirm_account_for_free_referral_storage_c2a:
      "Luo tili ja vahvista sähköpostiosoitteesi saadaksesi 1 Gt ilmaista tallennustilaa. Myös kaverisi saa 1 Gt:n ilmaista tallennustilaa.",
    confirm_code_generic_incorrect: "Väärä koodi.",
    confirm_code_generic_too_many_requests:
      "Liikaa pyyntöjä. Ole hyvä ja odota muutama minuutti.",
    confirm_code_generic_submit: "Lähetä koodi",
    confirm_code_generic_try_again: "Yritä uudelleen",
    confirm_code_generic_title: "Syötä vahvistuskoodi",
    confirm_code_2fa_instruction:
      "Syötä kuusinumeroinen koodi todennussovelluksestasi.",
    confirm_code_2fa_submit_btn: "Lähetä",
    confirm_code_2fa_title: "Syötä kaksivaiheisen tunnistautumisen koodi",
    confirm_delete_multiple_items:
      "Haluatko varmasti poistaa nämä kohteet pysyvästi?",
    confirm_delete_single_item: "Haluatko poistaa tämän kohteen pysyvästi?",
    confirm_open_apps_log_out:
      "Sinulla on avoimia sovelluksia. Haluatko varmasti kirjautua ulos?",
    confirm_new_password: "Vahvista uusi salasana",
    confirm_delete_user:
      "Haluatko varmasti poistaa tilisi? Kaikki tiedostosi ja tietosi poistetaan pysyvästi. Tätä toimintoa ei voi kumota.",
    confirm_delete_user_title: "Poista tilisi?",
    confirm_session_revoke: "Haluatko varmasti peruuttaa tämän istunnon?",
    confirm_your_email_address: "Vahvista sähköpostiosoitteesi",
    contact_us: "Ota yhteyttä",
    contact_us_verification_required:
      "Sinulla on oltava vahvistettu sähköpostiosoite, jotta voit käyttää tätä.",
    contain: "Sisällytä", // TODO: Ambiguous meaning
    // "inside(a house)" => "Sisällä" - probably more appropriate
    // "contain within" => "Sisältää"

    continue: "Jatka",

    copy: "Kopioi", // TODO: Lexical categories
    // Noun "A copy of something" => 'Kopio' or
    // Verb "To copy something" => 'Kopioi'?

    copy_link: "Kopioi linkki",
    copying: "Kopioidaan",
    copying_file: "Kopioidaan %%",
    cover: "Kansi", // TODO: Lexical categories
    // Noun (shelter) => 'Suoja' or
    // Noun (lid) => 'Kansi' or
    // Intransitive Verb (To occlude something) => 'Peitä' or
    // Transitive Verb (To cover for someone) => 'Suojaa'

    create_account: "Luo tili",
    create_free_account: "Luo ilmainen tili",
    create_shortcut: "Luo pikakuvake",
    credits: "Tekijät",
    current_password: "Nykyinen salasana",
    cut: "Leikkaa",
    clock: "Kello",
    clock_visible_hide: "Piilota - aina piilossa",
    clock_visible_show: "Näytä - aina näkyvissä",
    clock_visible_auto:
      "Automaattinen - oletus, näkyy vain koko näytön tilassa.",
    close_all: "Sulje kaikki",
    created: "Luotu",
    date_modified: "Muokkauspäivämäärä",
    default: "Oletus",
    delete: "Poista",
    delete_account: "Poista tilisi",
    delete_permanently: "Poista pysyvästi",
    deleting_file: "Poistetaan %%",
    deploy_as_app: "Ota käyttöön sovelluksena",
    descending: "Laskeva",
    desktop: "Työpöytä",
    desktop_background_fit: "Sovita",
    developers: "Kehittäjät",
    dir_published_as_website: `%strong% on julkaistu osoitteessa:`,
    disable_2fa: "Ota kaksivaiheinen tunnistautuminen pois käytöstä",
    disable_2fa_confirm:
      "Haluatko varmasti poistaa kaksivaiheisen tunnistautumisen käytöstä?",
    disable_2fa_instructions:
      "Syötä salasanasi poistaaksesi kaksivaihesen tunnistautumisen käytöstä.",
    disassociate_dir: "Irrota hakemisto",
    documents: "Dokumentit",
    dont_allow: "Älä salli",
    download: "Lataa",
    download_file: "Lataa tiedosto",
    downloading: "Ladataan",
    email: "Sähköpostiosoite",
    email_change_confirmation_sent:
      "Vahvistusviesti on lähetetty uuteen sähköpostiosoitteeseesi. Tarkista postilaatikkosi ja viimeistele prosessi seuraamalla ohjeita.",
    email_invalid: "Sähköpostiosoite on virheellinen.",
    email_or_username: "Sähköposti tai Käyttäjänimi",
    email_required: "Sähköpostiosoite vaaditaan.",
    empty_trash: "Tyhjennä roskakori",
    empty_trash_confirmation: `Haluatko varmasti poistaa roskakorissa olevat kohteet pysyvästi?`,
    emptying_trash: "Tyhjennetään roskakoria...",
    enable_2fa: "Ota käyttöön kaksivaiheinen tunnistautuminen",
    end_hard: "Pakotettu lopetus",
    end_process_force_confirm:
      "Haluatko varmasti pakottaa prosessin lopetuksen?",
    end_soft: "Pehmeä lopetus",
    enlarged_qr_code: "Suurennettu QR-koodi",
    enter_password_to_confirm_delete_user:
      "Syötä salasanasi vahvistaaksesi tilisi poiston",
    error_message_is_missing: "Virheilmoitus puuttuu.",
    error_unknown_cause: "Tuntematon virhe.",
    error_uploading_files: "Tiedostojen lataaminen epäonnistui",
    favorites: "Suosikit",
    feedback: "Palaute",
    feedback_c2a:
      "Käytä alla olevaa lomaketta lähettääksesi meille palautetta, kommentteja ja vikailmoituksia.",
    feedback_sent_confirmation:
      "Kiitos yhteydenotostasi. Jos tiliisi on liitetty sähköpostiosoite, saat meiltä vastauksen mahdollisimman pian.",
    fit: "Sovita",
    folder: "Kansio",
    force_quit: "Pakota lopetus",
    forgot_pass_c2a: "Unohditko salasanasi?",

    from: "Henkilöltä", // TODO: Context dependent, examples
    // "from address" => "osoitteesta" or
    // "from sender" => "lähettäjältä".
    // In the finnish language these are usually translated as case suffixes.
    // "From Person" gets the suffix "-ltä", being the combination of "Henkilö(Person) and ltä(From)"

    general: "Yleinen", // TODO: Conceptual ambiguity
    // "general (about something)" => "Yleistä" or
    // "military general" => "Kenraali"

    get_a_copy_of_on_puter: `Hanki '%%' -kopio Puter.com-sivustolta!`, // TODO: Very difficult ambiguity due to different case suffix for any possible word that you can substitue here. Can stay as is, but it's not exactly correct.

    get_copy_link: "Hanki kopiolinkki", // TODO: Ambiguous meaning
    // 'get a copy of a link' => 'Ota Kopio Linkkiin' or
    // 'get a link to the copy' => 'Ota Linkki Kopioon' - More probable, just want to be sure

    hide_all_windows: "Piilota kaikki ikkunat",
    home: "Koti",
    html_document: "HTML-dokumentti",
    hue: "Sävy",
    image: "Kuva",
    incorrect_password: "Väärä salasana",
    invite_link: "Kutsulinkki",
    item: "kohde",
    items_in_trash_cannot_be_renamed: `Tätä kohdetta ei voi nimetä uudelleen, koska se on roskakorissa. Jos haluat nimetä kohteen uudelleen, palauta se ensin roskakorista.`,
    jpeg_image: "JPEG-kuva",
    keep_in_taskbar: "Pidä tehtäväpalkissa",
    language: "Kieli",
    license: "Lisenssi",
    lightness: "Valoisuus",
    link_copied: "Linkki kopioitu",
    loading: "Ladataan",
    log_in: "Kirjaudu Sisään",
    log_into_another_account_anyway:
      "Kirjaudu joka tapauksessa toiselle tilille",
    log_out: "Kirjaudu ulos",
    looks_good: "Näyttää hyvältä!",
    manage_sessions: "Hallitse istuntoja",
    modified: "Muokattu",
    move: "Siirrä",
    moving_file: "Siirretään %%",
    my_websites: "Sivustoni",
    name: "Nimi",
    name_cannot_be_empty: "Nimi ei voi olla tyhjä.",

    name_cannot_contain_double_period: "Nimi ei voi olla '..'", // TODO: definition says a different thing, than the string
    // "Name can not be the '..' character." => "Nimi ei voi olla '..'-merkki." or
    // "Name can not contain the '..' character." => "Nimi ei voi sisältää merkkiä '..'."

    name_cannot_contain_period: "Nimi ei voi olla '.'", // TODO: definition says a different thing, than the string
    // "Name can not be the '.' character." => "Nimi ei voi olla '.'-merkki." or
    // "Name can not contain the '.' character." => "Nimi ei voi sisältää merkkiä '.'."

    name_cannot_contain_slash: "Nimi ei voi sisältää merkkiä '/'.",
    name_must_be_string: "Nimi voi olla vain merkkijono.",
    name_too_long: `Nimi ei voi olla pidempi kuin %% merkkiä.`,
    new: "Uusi",
    new_email: "New Email",
    new_folder: "Uusi kansio",
    new_password: "Uusi salasana",
    new_username: "Uusi käyttäjänimi",
    no: "Ei",
    no_dir_associated_with_site:
      "Tähän osoitteeseen ei ole liitetty hakemistoa.",
    no_websites_published:
      "Et ole vielä julkaissut yhtään verkkosivustoa. Napsauta kansiota hiiren kakkospainikkeella aloittaaksesi.",
    ok: "OK",
    open: "Avaa",
    open_in_new_tab: "Avaa uudessa välilehdessä",
    open_in_new_window: "Avaa uudessa ikkunassa",

    open_with: "Avaa sovelluksessa", // TODO: Context dependent
    // "Open" => "Avaa", can be "Avaa..." in this context or
    // "Open With" is often translated in the context of "Open With Application" => "Avaa Sovelluksessa"

    original_name: "Alkuperäinen nimi",
    original_path: "Alkuperäinen polku",
    oss_code_and_content: "Avoimen lähdekoodin ohjelmisto ja sisältö",
    password: "Salasana",
    password_changed: "Salasana vaihdettu.",
    password_recovery_rate_limit:
      "Olet ylittänyt pyyntörajamme. Ole hyvä, ja odota muutama minuutti. Estääksesi tätä tapahtumasta uudelleen, vältä uudelleenlataamasta sivua liian monta kertaa.",
    password_recovery_token_invalid:
      "Tämä salasanan palautustunnus ei ole enää voimassa.",
    password_recovery_unknown_error:
      "Tuntematon virhe. Yritä myöhemmin uudelleen.",
    password_required: "Salasana vaaditaan.",
    password_strength_error:
      "Salasanan tulee olla vähintään 8 merkkiä pitkä ja sisältää vähintään yhden ison kirjaimen, yhden pienen kirjaimen, yhden numeron ja yhden erikoismerkin.",
    passwords_do_not_match:
      "`Uusi salasana` ja `Vahvista uusi salasana` eivät täsmää.",
    paste: "Liitä",
    paste_into_folder: "Liitä kansioon",
    path: "Polku",
    personalization: "Personointi",
    pick_name_for_website: "Valitse nimi verkkosivustollesi:",
    picture: "Kuva",
    pictures: "Kuvat",
    plural_suffix: "t",
    powered_by_puter_js: `Palvelun tarjoaa {{link=docs}}Puter.js{{/link}}`,
    preparing: "Valmistellaan...",
    preparing_for_upload: "Valmistellaan latausta...",
    print: "Tulosta",
    privacy: "Yksityisyys",
    proceed_to_login: "Jatka sisäänkirjautumiseen",
    proceed_with_account_deletion: "Jatka tilin poistamista",
    process_status_initializing: "Alustetaan",
    process_status_running: "Käynnissä",
    process_type_app: "Sovellus",
    process_type_init: "Alustava",
    process_type_ui: "Käyttöliittymä",
    properties: "Ominaisuudet",
    public: "Julkinen",
    publish: "Julkaise",
    publish_as_website: "Julkaise verkkosivustona",
    puter_description: `Puter on yksityisyyttä korostava henkilökohtainen pilvipalvelu, jossa voit säilyttää kaikki tiedostosi, sovelluksesi ja pelisi yhdessä turvallisessa paikassa, ja jotka ovat saatavilla mistä tahansa milloin tahansa.`,
    reading_file: "Luetaan %strong%",
    recent: "Viimeisimmät",
    recommended: "Suositellut",
    recover_password: "Palauta salasanasi",
    refer_friends_c2a:
      "Saat 1 Gt ilmaista tallennustilaa jokaisesta ystävästä, joka luo ja vahvistaa tilin Puterissa. Myös ystäväsi saa 1 Gt:n ilmaista tallennustilaa!",
    refer_friends_social_media_c2a: `Hanki 1 Gt ilmaista tallennustilaa Puter.comista!`,
    refresh: "Päivitä",

    release_address_confirmation: `Haluatko varmasti julkaista tämän osoitteen?`, // TODO: Slight ambiguity between the meaning of "release"
    // "get rid of" => "Oletko varma, että haluat luovuttaa tämän osoitteen?" or
    // "publish" => "Oletko varma, että haluat julkaista tämän osoitteen?"

    remove_from_taskbar: "Poista tehtäväpalkista",
    rename: "Nimeä uudelleen",
    repeat: "Toista",
    replace: "Replace",
    replace_all: "Korvaa kaikki",
    resend_confirmation_code: "Lähetä vahvistuskoodi Uudelleen",
    reset_colors: "Palauta värit",
    restart_puter_confirm: "Haluatko varmasti käynnistää Puterin uudelleen?",
    restore: "Palauta",
    save: "Tallenna",
    saturation: "Kylläisyys",
    save_account: "Tallenna tili",
    save_account_to_get_copy_link: "Luo tili jatkaaksesi.",
    save_account_to_publish: "Luo tili jatkaaksesi.",
    save_session: "Tallenna istunto",
    save_session_c2a:
      "Luo tili tallentaaksesi nykyisen istuntosi ja välttääksesi työsi menettämisen.",
    scan_qr_c2a:
      "Skannaa alla oleva koodi kirjautuaksesi tähän istuntoon muilla laitteilla.",
    scan_qr_2fa: "Skannaa QR-koodi todennussovelluksellasi",
    scan_qr_generic:
      "Skannaa tämä QR-koodi puhelimellasi tai toisella laitteella.",
    search: "Etsi",
    seconds: "sekuntia",
    security: "Turvallisuus",
    select: "Valitse",
    selected: "valitut",
    select_color: "Valitse väri…",
    sessions: "Istunnot",
    send: "Lähetä",
    send_password_recovery_email: "Lähetä salasanan palautussähköposti",
    session_saved: "Kiitos tilin luomisesta. Tämä istunto on tallennettu.",
    settings: "Asetukset",
    set_new_password: "Aseta uusi salasana",
    share: "Jaa",

    share_to: "Jaa", // TODO: Grammatical ambiguity
    // The base form of "Share" is "Jaa". So maybe "Jaa..." is appropriate?
    // If "share to" is followed by the name of a user, it will not make any sense, as the name can be suffixed by for example "Jaa %%lle".

    share_with: "Jaa:",
    shortcut_to: "Pikakuvake",
    show_all_windows: "Näytä kaikki ikkunat",
    show_hidden: "Näytä piilotetut",
    sign_in_with_puter: "Kirjaudu sisään Puterilla",
    sign_up: "Rekisteröidy",
    signing_in: "Kirjaudutaan sisään…",
    size: "Koko",
    skip: "Ohita",
    something_went_wrong: "Jokin meni pieleen.",
    sort_by: "Lajittele",
    start: "Käynnistä",
    status: "Tila",
    storage_usage: "Tallennustilan käyttö",
    storage_puter_used: "Puterin käyttämä",
    taking_longer_than_usual:
      "Kestää hieman tavallista kauemmin. Ole hyvä ja odota...",
    task_manager: "Tehtävienhallinta",
    taskmgr_header_name: "Nimi",
    taskmgr_header_status: "Tila",
    taskmgr_header_type: "Tyyppi",
    terms: "Ehdot",
    text_document: "Tekstiasiakirja",
    tos_fineprint: `Klikkaamalla 'Luo ilmainen tili' hyväksyt Puterin {{link=terms}}käyttöehdot{{/link}} ja {{link=privacy}}tietosuojakäytännön{{/link}}.`,
    transparency: "Läpinäkyvyys",

    trash: "Roskakori", // TODO: Ambiguous meaning
    // "Trash" is oft used to just mean "Trash bin" => 'Roskakori' or
    // "Trash" by itself => 'Roska'

    two_factor: "Kaksivaiheinen tunnistautuminen",
    two_factor_disabled: "Kaksivaiheinen tunnistautuminen poissa käytöstä",
    two_factor_enabled: "Kaksivaiheinen tunnistautuminen käytössä",

    type: "Kirjoita", // TODO: Ambiguous meaning
    // "Type of an object" => 'Tyyppi' or
    // "Type on the keyboard" => 'Kirjoita'

    type_confirm_to_delete_account: "Kirjoita 'vahvista' poistaaksesi tilisi.",
    ui_colors: "Käyttöliittymän värit",
    ui_manage_sessions: "Istunnon hallinta",
    ui_revoke: "Peruuta",
    undo: "Kumoa",
    unlimited: "Rajoittamaton",
    unzip: "Pura zip-tiedosto",
    upload: "Lataa",
    upload_here: "Lataa tähän",
    usage: "Käyttö",
    username: "Käyttäjänimi",
    username_changed: "Käyttäjänimi päivitetty onnistuneesti.",
    username_required: "Käyttäjänimi vaaditaan.",
    versions: "Versiot",
    videos: "Videot",
    visibility: "Näkyvyys",
    yes: "Kyllä",
    yes_release_it: "Kyllä, julkaise se",
    you_have_been_referred_to_puter_by_a_friend:
      "Kaverisi on kutsunut sinut Puteriin!",
    zip: "Zip",
    zipping_file: "Zipataan %strong%",

    // === 2FA Setup ===
    setup2fa_1_step_heading: "Avaa todennussovelluksesi",
    setup2fa_1_instructions: `
            Voit käyttää mitä tahansa todennussovellusta, joka tukee aikaperusteista kertakirjautumissalasanaa (TOTP-protokollaa). 
            Valittavanasi on monia sovelluksia, mutta jos et ole varma, 
            <a target="_blank" href="https://authy.com/download">Authy</a> on hyvä valinta Androidille ja iOS:lle.
        `,
    setup2fa_2_step_heading: "Skannaa QR-koodi",
    setup2fa_3_step_heading: "Syötä kuusinumeroinen koodi",
    setup2fa_4_step_heading: "Kopioi palautuskoodisi",
    setup2fa_4_instructions: `
            Nämä palautuskoodit ovat ainoa tapa päästä tiliisi, jos menetät puhelimesi tai et voi käyttää todennussovellustasi. 
            Varmista, että säilytät ne turvallisessa paikassa.
        `,
    setup2fa_5_step_heading:
      "Vahvista kaksivaiheisen tunnistautumisen asetukset",
    setup2fa_5_confirmation_1:
      "Olen tallentanut palautuskoodini turvalliseen paikkaan",
    setup2fa_5_confirmation_2:
      "Olen valmis ottamaan kaksivaiheisen tunnistautumisen käyttöön",
    setup2fa_5_button: "Ota kaksivaiheinen tunnistautuminen käyttöön",

    // === 2FA Login ===
    login2fa_otp_title: "Syötä kaksivaiheisen tunnistautumisen koodi",
    login2fa_otp_instructions:
      "Syötä kuusinumeroinen koodi todennussovelluksestasi.",
    login2fa_recovery_title: "Syötä palautuskoodi",
    login2fa_recovery_instructions:
      "Syötä yksi palautuskoodeistasi saadaksesi pääsy tilillesi.",
    login2fa_use_recovery_code: "Käytä palautuskoodi",
    login2fa_recovery_back: "Takaisin",
    login2fa_recovery_placeholder: "XXXXXXXX",

    change: "muutos", // In English: "Change"
    clock_visibility: "kellon näkyvyys", // In English: "Clock Visibility"
    reading: "lukeminen", // In English: "Reading %strong%"
    writing: "kirjoittaminen", // In English: "Writing %strong%"
    unzipping: "purkaminen", // In English: "Unzipping %strong%"
    sequencing: "järjestäminen", // In English: "Sequencing %strong%"
    zipping: "pakkaaminen", // In English: "Zipping %strong%"
    Editor: "Muokkaaja", // In English: "Editor"
    Viewer: "Katselija", // In English: "Viewer"
    "People with access": "Henkilöt, joilla on käyttöoikeus", // In English: "People with access"
    "Share With…": "Jaa kanssa…", // In English: "Share With…"
    Owner: "Omistaja", // In English: "Owner"
    "You can't share with yourself.": "Et voi jakaa itsellesi.", // In English: "You can't share with yourself."
    "This user already has access to this item":
    "Tällä käyttäjällä on jo pääsy tähän kohteeseen", // In English: "This user already has access to this item"

    "billing.change_payment_method": "Vaihda", // In English: "Change"
    "billing.cancel": "Peruuta", // In English: "Cancel"
    "billing.download_invoice": "Lataa", // In English: "Download"
    "billing.payment_method": "Maksutapa", // In English: "Payment Method"
    "billing.payment_method_updated": "Maksutapa päivitetty!", // In English: "Payment method updated!"
    "billing.confirm_payment_method": "Vahvista maksutapa", // In English: "Confirm Payment Method"
    "billing.payment_history": "Maksuhistoria", // In English: "Payment History"
    "billing.refunded": "Hyvitetty", // In English: "Refunded"
    "billing.paid": "Maksettu", // In English: "Paid"
    "billing.ok": "OK", // In English: "OK"
    "billing.resume_subscription": "Jatka tilausta", // In English: "Resume Subscription"
    "billing.subscription_cancelled": "Tilauksesi on peruutettu.", // In English: "Your subscription has been canceled."
    "billing.subscription_cancelled_description": "Voit jatkaa tilauksesi käyttöä laskutuskauden loppuun asti.", // In English: "You will still have access to your subscription until the end of this billing period."
    "billing.offering.free": "Ilmainen", // In English: "Free"
    "billing.offering.pro": "Ammattilainen", // In English: "Professional"
    "billing.offering.professional": "Ammattilainen", // In English: "Professional"
    "billing.offering.business": "Yritys", // In English: "Business"
    "billing.cloud_storage": "Pilvitallennustila", // In English: "Cloud Storage"
    "billing.ai_access": "Tekoälykäyttö", // In English: "AI Access"
    "billing.bandwidth": "Kaistanleveys", // In English: "Bandwidth"
    "billing.apps_and_games": "Sovellukset ja pelit", // In English: "Apps & Games"
    "billing.upgrade_to_pro": "Vaihda %strong% tilaukseen", // In English: "Upgrade to %strong%"
    "billing.switch_to": "Vaiha %strong% tilaukseen", // In English: "Switch to %strong%"
    "billing.payment_setup": "Maksuasetukset", // In English: "Payment Setup"
    "billing.back": "Takaisin", // In English: "Back"
    "billing.you_are_now_subscribed_to": "Olet nyt tilannut %strong% tason.", // In English: "You are now subscribed to %strong% tier."
    "billing.you_are_now_subscribed_to_without_tier": "Olet nyt tehnyt tilauksen", // In English: "You are now subscribed"
    "billing.subscription_cancellation_confirmation": "Haluatko varmasti peruuttaa tilauksesi?", // In English: "Are you sure you want to cancel your subscription?"
    "billing.subscription_setup": "Tilauksen määritys", // In English: "Subscription Setup"
    "billing.cancel_it": "Peruuta", // In English: "Cancel It"
    "billing.keep_it": "Säilytä", // In English: "Keep It"
    "billing.subscription_resumed": "%strong% -tilaustasi on jatkettu.", // In English: "Your %strong% subscription has been resumed!"
    "billing.upgrade_now": "Päivitä nyt", // In English: "Upgrade Now"
    "billing.upgrade": "Päivitä", // In English: "Upgrade"
    "billing.currently_on_free_plan": "Olet tällä hetkellä ilmaisella suunnitelmalla.", // In English: "You are currently on the free plan."
    "billing.download_receipt": "Lataa kuitti", // In English: "Download Receipt"
    "billing.subscription_check_error": "Tilauksesi tarkistuksessa tapahtui virhe.", // In English: "A problem occurred while checking your subscription status."
    "billing.email_confirmation_needed": "Sähköpostiosoitettasi ei ole vahvistettu. Lähetämme sinulle vahvistuskoodin nyt.", // In English: "Your email has not been confirmed. We'll send you a code to confirm it now."
    "billing.sub_cancelled_but_valid_until": "Olet peruuttanut tilauksesi, ja se vaihtuu automaattisesti ilmaiseen tasoon laskutuskauden lopussa. Sinulta ei veloiteta enää, ellet päätä uusia tilaustasi.", // In English: "You have cancelled your subscription and it will automatically switch to the free tier at the end of the billing period. You will not be charged again unless you re-subscribe."
    "billing.current_plan_until_end_of_period": "Nykyinen suunnitelmasi on voimassa tämän laskutuskauden loppuun asti.", // In English: "Your current plan until the end of this billing period."
    "billing.current_plan": "Nykyinen suunnitelma", // In English: "Current plan"
    "billing.cancelled_subscription_tier": "Peruutettu tilaus (%%)", // In English: "Cancelled Subscription (%%)"
    "billing.manage": "Hallinnoi", // In English: "Manage"
    "billing.limited": "Rajallinen", // In English: "Limited"
    "billing.expanded": "Laajennettu", // In English: "Expanded"
    "billing.accelerated": "Nopeutettu", // In English: "Accelerated"
    "billing.enjoy_msg": "Nauti %% pilvitallennustilasta ja muista eduista.", // In English: "Enjoy %% of Cloud Storage plus other benefits."

    "choose_publishing_option": "Valitse, miten haluat julkaista verkkosivustosi:",
    "create_desktop_shortcut": "Luo pikakuvake (Työpöydälle)",
    "create_desktop_shortcut_s": "Luo pikakuvakkeita (Työpöydälle)",
    "create_shortcut_s": "Luo pikakuvakkeita",
    "minimize": "Pienennä",
    "reload_app": "Lataa sovellus uudelleen",
    "new_window": "Uusi ikkuna",
    "open_trash": "Avaa roskakori",
    "pick_name_for_worker": "Valitse nimi työntekijälle:",
    "publish_as_serverless_worker": "Julkaise työntekijänä",
    "toolbar.enter_fullscreen": "Koko näyttöön",
    "toolbar.github": "GitHub",
    "toolbar.refer": "Suosittele",
    "toolbar.save_account": "Tallenna tili",
    "toolbar.search": "Haku",
    "toolbar.qrcode": "QR-koodi",
    "used_of": "{{used}} käytetty {{available}}:sta",
    "worker": "Työntekijä",
    "billing.offering.basic": "Perus",
    "too_many_attempts": "Liian monta yritystä. Yritä myöhemmin uudelleen.",
    "server_timeout": "Palvelimen vastaus kesti liian kauan. Yritä uudelleen.",
    "signup_error": "Rekisteröitymisen aikana tapahtui virhe. Yritä uudelleen.",
    "welcome_title": "Tervetuloa henkilökohtaiseen Internet-tietokoneeseesi",
    "welcome_description": "Tallenna tiedostoja, pelaa pelejä, löydä upeita sovelluksia ja paljon muuta! Kaikki yhdessä paikassa, käytettävissä mistä tahansa ja milloin tahansa.",
    "welcome_get_started": "Aloita",
    "welcome_terms": "Ehdot",
    "welcome_privacy": "Tietosuoja",
    "welcome_developers": "Kehittäjät",
    "welcome_open_source": "Avoin lähdekoodi",
    "welcome_instant_login_title": "Välitön kirjautuminen!",
    "alert_error_title": "Virhe!",
    "alert_warning_title": "Varoitus!",
    "alert_info_title": "Info",
    "alert_success_title": "Onnistui!",
    "alert_confirm_title": "Oletko varma?",
    "alert_yes": "Kyllä",
    "alert_no": "Ei",
    "alert_retry": "Yritä uudelleen",
    "alert_cancel": "Peruuta",
    "signup_confirm_password": "Vahvista salasana",
    "login_email_username_required": "Sähköposti tai käyttäjänimi vaaditaan",
    "login_password_required": "Salasana vaaditaan",
    "window_title_open": "Avaa",
    "window_title_change_password": "Vaihda salasana",
    "window_title_select_font": "Valitse fontti…",
    "window_title_session_list": "Istuntolista",
    "window_title_set_new_password": "Aseta uusi salasana",
    "window_title_instant_login": "Välitön kirjautuminen!",
    "window_title_publish_website": "Julkaise verkkosivusto",
    "window_title_publish_worker": "Julkaise työntekijä",
    "window_title_authenticating": "Todennetaan...",
    "window_title_refer_friend": "Suosittele ystävälle!",
    "desktop_show_desktop": "Näytä työpöytä",
    "desktop_show_open_windows": "Näytä avoimet ikkunat",
    "desktop_exit_full_screen": "Poistu koko näytöstä",
    "desktop_enter_full_screen": "Koko näyttöön",
    "desktop_position": "Sijainti",
    "desktop_position_left": "Vasen",
    "desktop_position_bottom": "Ala",
    "desktop_position_right": "Oikea",
    "item_shared_with_you": "Käyttäjä on jakanut tämän kohteen kanssasi.",
    "item_shared_by_you": "Olet jakanut tämän kohteen ainakin yhden muun käyttäjän kanssa.",
    "item_shortcut": "Pikakuvake",
    "item_associated_websites": "Liittyvä verkkosivusto",
    "item_associated_websites_plural": "Liittyvät verkkosivustot",
    "no_suitable_apps_found": "Sopivia sovelluksia ei löytynyt",
    "window_click_to_go_back": "Napsauta palataksesi takaisin.",
    "window_click_to_go_forward": "Napsauta siirtyäksesi eteenpäin.",
    "window_click_to_go_up": "Napsauta siirtyäksesi yhtä kansiotasoa ylöspäin.",
    "window_title_public": "Julkinen",
    "window_title_videos": "Videot",
    "window_title_pictures": "Kuvat",
    "window_title_puter": "Puter",
    "window_folder_empty": "Tämä kansio on tyhjä",
    "manage_your_subdomains": "Hallitse aliverkkotunnuksiasi",
    "open_containing_folder": "Avaa sisältävä kansio"
  },
};

export default fi;
