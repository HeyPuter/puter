/*
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
    name: 'Suomi',
    english_name: 'Finnish',
    code: 'fi',
    dictionary: {
        account: 'Tili',
        account_password: 'Vahvista tilin salasana',
        access_granted_to: 'Käyttöoikeus myönnetty',
        add_another_account: 'Lisää toinen tili',
        all_fields_required: 'Kaikki kentät on täytettävä.',
        allow: 'Salli',
        // To apply(a principle) => "Sovella" or
        // Apply for(a job) "Hae" or
        // Apply as(an engineer) => "Hakeudu" or
        // Apply an expression => "Applikoi" or - Probably the most appropriate in the context of the app
        // Apply in the sense of applying something, like a tool => "Käytä"

        ascending: 'Nouseva',
        associated_websites: 'Tähän liittyvät verkkosivustot',
        cancel: 'Peruuta',
        change_email: 'Vaihda sähköpostiosoite',
        change_language: 'Vaihda kieli',
        change_password: 'Vaihda salasana',
        change_username: 'Vaihda käyttäjänimi',
        close: 'Sulje',
        close_all_windows_and_log_out: 'Sulje ikkunat ja kirjaudu ulos',
        change_always_open_with:
      'Haluatko aina avata tämän tyyppisen tiedoston sovelluksella',
        confirm: 'Vahvista',
        confirm_code_generic_incorrect: 'Väärä koodi.',
        confirm_code_generic_too_many_requests:
      'Liikaa pyyntöjä. Ole hyvä ja odota muutama minuutti.',
        confirm_code_2fa_instruction:
      'Syötä kuusinumeroinen koodi todennussovelluksestasi.',
        confirm_delete_multiple_items:
      'Haluatko varmasti poistaa nämä kohteet pysyvästi?',
        confirm_delete_single_item: 'Haluatko poistaa tämän kohteen pysyvästi?',
        confirm_open_apps_log_out:
      'Sinulla on avoimia sovelluksia. Haluatko varmasti kirjautua ulos?',
        confirm_new_password: 'Vahvista uusi salasana',
        confirm_delete_user:
      'Haluatko varmasti poistaa tilisi? Kaikki tiedostosi ja tietosi poistetaan pysyvästi. Tätä toimintoa ei voi kumota.',
        confirm_delete_user_title: 'Poista tilisi?',
        confirm_session_revoke: 'Haluatko varmasti peruuttaa tämän istunnon?',
        confirm_your_email_address: 'Vahvista sähköpostiosoitteesi',
        contact_us: 'Ota yhteyttä',
        // "inside(a house)" => "Sisällä" - probably more appropriate
        // "contain within" => "Sisältää"

        continue: 'Jatka',

        copy: 'Kopioi', // TODO: Lexical categories
        // Noun "A copy of something" => 'Kopio' or
        // Verb "To copy something" => 'Kopioi'?

        copy_link: 'Kopioi linkki',
        copying_file: 'Kopioidaan %%',
        // Noun (shelter) => 'Suoja' or
        // Noun (lid) => 'Kansi' or
        // Intransitive Verb (To occlude something) => 'Peitä' or
        // Transitive Verb (To cover for someone) => 'Suojaa'

        create_account: 'Luo tili',
        create_free_account: 'Luo ilmainen tili',
        create_shortcut: 'Luo pikakuvake',
        current_password: 'Nykyinen salasana',
        cut: 'Leikkaa',
        close_all: 'Sulje kaikki',
        created: 'Luotu',
        date_modified: 'Muokkauspäivämäärä',
        delete: 'Poista',
        delete_account: 'Poista tilisi',
        delete_permanently: 'Poista pysyvästi',
        deleting_file: 'Poistetaan %%',
        deploy_as_app: 'Ota käyttöön sovelluksena',
        descending: 'Laskeva',
        desktop: 'Työpöytä',
        developers: 'Kehittäjät',
        disable_2fa: 'Ota kaksivaiheinen tunnistautuminen pois käytöstä',
        disable_2fa_instructions:
      'Syötä salasanasi poistaaksesi kaksivaihesen tunnistautumisen käytöstä.',
        documents: 'Dokumentit',
        dont_allow: 'Älä salli',
        download: 'Lataa',
        download_file: 'Lataa tiedosto',
        email: 'Sähköpostiosoite',
        email_change_confirmation_sent:
      'Vahvistusviesti on lähetetty uuteen sähköpostiosoitteeseesi. Tarkista postilaatikkosi ja viimeistele prosessi seuraamalla ohjeita.',
        email_invalid: 'Sähköpostiosoite on virheellinen.',
        email_or_username: 'Sähköposti tai Käyttäjänimi',
        email_required: 'Sähköpostiosoite vaaditaan.',
        empty_trash: 'Tyhjennä roskakori',
        empty_trash_confirmation: 'Haluatko varmasti poistaa roskakorissa olevat kohteet pysyvästi?',
        emptying_trash: 'Tyhjennetään roskakoria...',
        end_hard: 'Pakotettu lopetus',
        end_soft: 'Pehmeä lopetus',
        enlarged_qr_code: 'Suurennettu QR-koodi',
        enter_password_to_confirm_delete_user:
      'Syötä salasanasi vahvistaaksesi tilisi poiston',
        error_message_is_missing: 'Virheilmoitus puuttuu.',
        error_unknown_cause: 'Tuntematon virhe.',
        error_uploading_files: 'Tiedostojen lataaminen epäonnistui',
        favorites: 'Suosikit',
        feedback: 'Palaute',
        feedback_c2a:
      'Käytä alla olevaa lomaketta lähettääksesi meille palautetta, kommentteja ja vikailmoituksia.',
        feedback_sent_confirmation:
      'Kiitos yhteydenotostasi. Jos tiliisi on liitetty sähköpostiosoite, saat meiltä vastauksen mahdollisimman pian.',
        folder: 'Kansio',
        forgot_pass_c2a: 'Unohditko salasanasi?',

        // "from address" => "osoitteesta" or
        // "from sender" => "lähettäjältä".
        // In the finnish language these are usually translated as case suffixes.
        // "From Person" gets the suffix "-ltä", being the combination of "Henkilö(Person) and ltä(From)"

        general: 'Yleinen', // TODO: Conceptual ambiguity
        // "general (about something)" => "Yleistä" or
        // "military general" => "Kenraali"


        // 'get a copy of a link' => 'Ota Kopio Linkkiin' or
        // 'get a link to the copy' => 'Ota Linkki Kopioon' - More probable, just want to be sure

        home: 'Koti',
        html_document: 'HTML-dokumentti',
        incorrect_password: 'Väärä salasana',
        item: 'kohde',
        items_in_trash_cannot_be_renamed: 'Tätä kohdetta ei voi nimetä uudelleen, koska se on roskakorissa. Jos haluat nimetä kohteen uudelleen, palauta se ensin roskakorista.',
        jpeg_image: 'JPEG-kuva',
        language: 'Kieli',
        loading: 'Ladataan',
        log_in: 'Kirjaudu Sisään',
        log_out: 'Kirjaudu ulos',
        manage_sessions: 'Hallitse istuntoja',
        modified: 'Muokattu',
        move: 'Siirrä',
        moving_file: 'Siirretään %%',
        name: 'Nimi',
        name_cannot_be_empty: 'Nimi ei voi olla tyhjä.',

        name_cannot_contain_double_period: "Nimi ei voi olla '..'", // TODO: definition says a different thing, than the string
        // "Name can not be the '..' character." => "Nimi ei voi olla '..'-merkki." or
        // "Name can not contain the '..' character." => "Nimi ei voi sisältää merkkiä '..'."

        name_cannot_contain_period: "Nimi ei voi olla '.'", // TODO: definition says a different thing, than the string
        // "Name can not be the '.' character." => "Nimi ei voi olla '.'-merkki." or
        // "Name can not contain the '.' character." => "Nimi ei voi sisältää merkkiä '.'."

        name_cannot_contain_slash: "Nimi ei voi sisältää merkkiä '/'.",
        name_must_be_string: 'Nimi voi olla vain merkkijono.',
        name_too_long: 'Nimi ei voi olla pidempi kuin %% merkkiä.',
        new: 'Uusi',
        new_email: 'New Email',
        new_folder: 'Uusi kansio',
        new_password: 'Uusi salasana',
        new_username: 'Uusi käyttäjänimi',
        no: 'Ei',
        ok: 'OK',
        open: 'Avaa',
        open_in_new_tab: 'Avaa uudessa välilehdessä',
        open_in_new_window: 'Avaa uudessa ikkunassa',

        open_with: 'Avaa sovelluksessa', // TODO: Context dependent
        // "Open" => "Avaa", can be "Avaa..." in this context or
        // "Open With" is often translated in the context of "Open With Application" => "Avaa Sovelluksessa"

        original_name: 'Alkuperäinen nimi',
        original_path: 'Alkuperäinen polku',
        password: 'Salasana',
        password_changed: 'Salasana vaihdettu.',
        password_recovery_rate_limit:
      'Olet ylittänyt pyyntörajamme. Ole hyvä, ja odota muutama minuutti. Estääksesi tätä tapahtumasta uudelleen, vältä uudelleenlataamasta sivua liian monta kertaa.',
        password_recovery_token_invalid:
      'Tämä salasanan palautustunnus ei ole enää voimassa.',
        password_recovery_unknown_error:
      'Tuntematon virhe. Yritä myöhemmin uudelleen.',
        password_required: 'Salasana vaaditaan.',
        password_strength_error:
      'Salasanan tulee olla vähintään 8 merkkiä pitkä ja sisältää vähintään yhden ison kirjaimen, yhden pienen kirjaimen, yhden numeron ja yhden erikoismerkin.',
        passwords_do_not_match:
      '`Uusi salasana` ja `Vahvista uusi salasana` eivät täsmää.',
        paste: 'Liitä',
        paste_into_folder: 'Liitä kansioon',
        path: 'Polku',
        pictures: 'Kuvat',
        plural_suffix: 't',
        preparing: 'Valmistellaan...',
        print: 'Tulosta',
        proceed_to_login: 'Jatka sisäänkirjautumiseen',
        properties: 'Ominaisuudet',
        public: 'Julkinen',
        publish: 'Julkaise',
        publish_as_website: 'Julkaise verkkosivustona',
        recover_password: 'Palauta salasanasi',
        refresh: 'Päivitä',

        // "get rid of" => "Oletko varma, että haluat luovuttaa tämän osoitteen?" or
        // "publish" => "Oletko varma, että haluat julkaista tämän osoitteen?"

        rename: 'Nimeä uudelleen',
        replace: 'Replace',
        replace_all: 'Korvaa kaikki',
        resend_confirmation_code: 'Lähetä vahvistuskoodi Uudelleen',
        restore: 'Palauta',
        save: 'Tallenna',
        save_account: 'Tallenna tili',
        save_account_to_publish: 'Luo tili jatkaaksesi.',
        save_session: 'Tallenna istunto',
        save_session_c2a:
      'Luo tili tallentaaksesi nykyisen istuntosi ja välttääksesi työsi menettämisen.',
        seconds: 'sekuntia',
        security: 'Turvallisuus',
        select: 'Valitse',
        selected: 'valitut',
        sessions: 'Istunnot',
        send: 'Lähetä',
        send_password_recovery_email: 'Lähetä salasanan palautussähköposti',
        session_saved: 'Kiitos tilin luomisesta. Tämä istunto on tallennettu.',
        set_new_password: 'Aseta uusi salasana',
        share: 'Jaa',

        share_to: 'Jaa', // TODO: Grammatical ambiguity
        // The base form of "Share" is "Jaa". So maybe "Jaa..." is appropriate?
        // If "share to" is followed by the name of a user, it will not make any sense, as the name can be suffixed by for example "Jaa %%lle".

        shortcut_to: 'Pikakuvake',
        show_hidden: 'Näytä piilotetut',
        sign_in_with_puter: 'Kirjaudu sisään Puterilla',
        size: 'Koko',
        skip: 'Ohita',
        something_went_wrong: 'Jokin meni pieleen.',
        sort_by: 'Lajittele',
        status: 'Tila',
        storage_puter_used: 'Puterin käyttämä',
        taking_longer_than_usual:
      'Kestää hieman tavallista kauemmin. Ole hyvä ja odota...',
        text_document: 'Tekstiasiakirja',
        tos_fineprint: 'Klikkaamalla \'Luo ilmainen tili\' hyväksyt Puterin {{link=terms}}käyttöehdot{{/link}} ja {{link=privacy}}tietosuojakäytännön{{/link}}.',

        trash: 'Roskakori', // TODO: Ambiguous meaning
        // "Trash" is oft used to just mean "Trash bin" => 'Roskakori' or
        // "Trash" by itself => 'Roska'

        two_factor: 'Kaksivaiheinen tunnistautuminen',
        two_factor_disabled: 'Kaksivaiheinen tunnistautuminen poissa käytöstä',
        two_factor_enabled: 'Kaksivaiheinen tunnistautuminen käytössä',

        type: 'Kirjoita', // TODO: Ambiguous meaning
        // "Type of an object" => 'Tyyppi' or
        // "Type on the keyboard" => 'Kirjoita'

        type_confirm_to_delete_account: "Kirjoita 'vahvista' poistaaksesi tilisi.",
        ui_manage_sessions: 'Istunnon hallinta',
        ui_revoke: 'Peruuta',
        undo: 'Kumoa',
        unzip: 'Pura zip-tiedosto',
        upload: 'Lataa',
        upload_here: 'Lataa tähän',
        usage: 'Käyttö',
        username: 'Käyttäjänimi',
        username_changed: 'Käyttäjänimi päivitetty onnistuneesti.',
        username_required: 'Käyttäjänimi vaaditaan.',
        versions: 'Versiot',
        videos: 'Videot',
        yes: 'Kyllä',
        zip: 'Zip',

        // === 2FA Setup ===
        setup2fa_1_instructions: `
            Voit käyttää mitä tahansa todennussovellusta, joka tukee aikaperusteista kertakirjautumissalasanaa (TOTP-protokollaa). 
            Valittavanasi on monia sovelluksia, mutta jos et ole varma, 
            <a target="_blank" href="https://authy.com/download">Authy</a> on hyvä valinta Androidille ja iOS:lle.
        `,
        setup2fa_3_step_heading: 'Syötä kuusinumeroinen koodi',
        setup2fa_4_instructions: `
            Nämä palautuskoodit ovat ainoa tapa päästä tiliisi, jos menetät puhelimesi tai et voi käyttää todennussovellustasi. 
            Varmista, että säilytät ne turvallisessa paikassa.
        `,
        setup2fa_5_confirmation_1:
      'Olen tallentanut palautuskoodini turvalliseen paikkaan',
        setup2fa_5_confirmation_2:
      'Olen valmis ottamaan kaksivaiheisen tunnistautumisen käyttöön',

        // === 2FA Login ===
        login2fa_otp_title: 'Syötä kaksivaiheisen tunnistautumisen koodi',
        login2fa_otp_instructions:
      'Syötä kuusinumeroinen koodi todennussovelluksestasi.',
        login2fa_recovery_title: 'Syötä palautuskoodi',
        login2fa_recovery_instructions:
      'Syötä yksi palautuskoodeistasi saadaksesi pääsy tilillesi.',
        login2fa_use_recovery_code: 'Käytä palautuskoodi',
        login2fa_recovery_placeholder: 'XXXXXXXX',

        reading: 'lukeminen', // In English: "Reading %strong%"
        writing: 'kirjoittaminen', // In English: "Writing %strong%"
        unzipping: 'purkaminen', // In English: "Unzipping %strong%"
        sequencing: 'järjestäminen', // In English: "Sequencing %strong%"
        zipping: 'pakkaaminen', // In English: "Zipping %strong%"

        'billing.subscription_setup': 'Tilauksen määritys', // In English: "Subscription Setup"
        'billing.upgrade': 'Päivitä', // In English: "Upgrade"

        'create_shortcut_s': 'Luo pikakuvakkeita',
        'minimize': 'Pienennä',
        'reload_app': 'Lataa sovellus uudelleen',
        'publish_as_serverless_worker': 'Julkaise työntekijänä',
        'used_of': '{{used}} käytetty {{available}}:sta',
        'worker': 'Työntekijä',
        'server_timeout': 'Palvelimen vastaus kesti liian kauan. Yritä uudelleen.',
        'signup_error': 'Rekisteröitymisen aikana tapahtui virhe. Yritä uudelleen.',
        'alert_error_title': 'Virhe!',
        'alert_warning_title': 'Varoitus!',
        'alert_info_title': 'Info',
        'alert_success_title': 'Onnistui!',
        'alert_confirm_title': 'Oletko varma?',
        'alert_yes': 'Kyllä',
        'alert_no': 'Ei',
        'alert_retry': 'Yritä uudelleen',
        'alert_cancel': 'Peruuta',
        'signup_confirm_password': 'Vahvista salasana',
        'login_email_username_required': 'Sähköposti tai käyttäjänimi vaaditaan',
        'login_password_required': 'Salasana vaaditaan',
        'window_title_open': 'Avaa',
        'window_title_change_password': 'Vaihda salasana',
        'window_title_select_font': 'Valitse fontti…',
        'window_title_set_new_password': 'Aseta uusi salasana',
        'window_title_publish_website': 'Julkaise verkkosivusto',
        'window_title_publish_worker': 'Julkaise työntekijä',
        'window_title_authenticating': 'Todennetaan...',
        'item_shared_by_you': 'Olet jakanut tämän kohteen ainakin yhden muun käyttäjän kanssa.',
        'item_shortcut': 'Pikakuvake',
        'item_associated_websites': 'Liittyvä verkkosivusto',
        'item_associated_websites_plural': 'Liittyvät verkkosivustot',
        'no_suitable_apps_found': 'Sopivia sovelluksia ei löytynyt',
        'window_click_to_go_back': 'Napsauta palataksesi takaisin.',
        'window_click_to_go_forward': 'Napsauta siirtyäksesi eteenpäin.',
        'window_click_to_go_up': 'Napsauta siirtyäksesi yhtä kansiotasoa ylöspäin.',
        'window_title_puter': 'Puter',
        'window_folder_empty': 'Tämä kansio on tyhjä',
    },
};

export default fi;
