/**
 * Copyright (C) 2024 Puter Technologies Inc.
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
        access_granted_to: "Käyttöoikeus Myönnetty",
        add_existing_account: "Lisää Olemassaoleva Tili",
        all_fields_required: 'Kaikki kentät on täytettävä.',

        apply: "Apply", // TODO: Ambiguous meaning
        // To apply(a principle) => "Sovella" or
        // Apply for(a job) "Hae" or 
        // Apply as(an engineer) => "Hakeudu" or
        // Apply an expression => "Applikoi" or - Probably the most appropriate in the context of the app
        // Apply in the sense of applying something, like a tool => "Käytä"

        ascending: 'Nouseva',
        background: "Tausta",
        browse: "Selaa",
        cancel: 'Peruuta',
        center: 'Keskus',
        change_desktop_background: 'Vaihda työpöydän taustakuvaa…',
        change_password: "Muuta Salasana",
        change_username: "Muuta Käyttäjänimeä",
        close_all_windows: "Sulje Kaikki Ikkunat",
        color: 'Väri',
        confirm_account_for_free_referral_storage_c2a: 'Luo tili ja vahvista sähköpostiosoitteesi saadaksesi 1 Gt ilmaista tallennustilaa. Myös kaverisi saa 1 Gt ilmaista tallennustilaa.',
        confirm_new_password: "Vahvista Uusi Salasana",
        contact_us: "Ota Yhteyttä",

        contain: 'Contain', // TODO: Ambiguous meaning
        // "inside(a house)" => "Sisällä" - probably more appropriate
        // "contain within" => "Sisältää"

        continue: "Jatka",

        copy: 'Copy', // TODO: Lexical categories
        // Noun "A copy of something" => 'Kopio' or
        // Verb "To copy something" => 'Kopioi'?

        copy_link: "Kopioi Linkki",
        copying: "Kopioidaan",

        cover: 'Cover', // TODO: Lexical categories
        // Noun (shelter) => 'Suoja' or 
        // Noun (lid) => 'Kansi' or
        // Intransitive Verb (To occlude something) => 'Peitä' or
        // Transitive Verb (To cover for someone) => 'Suojaa'

        create_account: "Luo Tili",
        create_free_account: "Luo Ilmainen Tili",
        create_shortcut: "Luo Pikakuvake",
        current_password: "Nykyinen Salasana",
        cut: 'Leikkaa',
        date_modified: 'Muutospäivämäärä',
        delete: 'Poista',
        delete_permanently: "Poista Pysyvästi",
        deploy_as_app: 'Levitä sovelluksena',
        descending: 'Laskeva',
        desktop_background_fit: "Sovita",
        dir_published_as_website: `%strong% on julkaistu osoitteessa:`,
        disassociate_dir: "Erota Hakemisto",
        download: 'Lataa',
        downloading: "Ladataan",
        email: "Sähköposti",
        email_or_username: "Sähköposti tai Käyttäjänimi",
        empty_trash: 'Tyhjennä Roskakori',
        empty_trash_confirmation: `Oletko varma, että haluat poistaa Roskakorin kohteet pysyvästi?`,
        emptying_trash: 'Tyhjennetään Roskakori…',
        feedback: "Palaute",
        feedback_c2a: "Käytä alla olevaa lomaketta lähettääksesi meille palautetta, kommentteja ja vikailmoituksia.",
        feedback_sent_confirmation: "Kiitos yhteydenotosta. Jos sinulla on tiliisi liittyvä sähköpostiosoite, saat meiltä vastauksen mahdollisimman pian.",
        forgot_pass_c2a: "Unohditko Salasanasi?",

        from: "From", // TODO: Context dependent, examples
        // "from address" => "osoitteesta" or
        // "from sender" => "lähettäjältä".
        // In the finnish language these are usually translated as case suffixes.
        // "From Person" gets the suffix "-ltä", being the combination of "Henkilö(Person) and ltä(From)"

        general: "General", // TODO: Conceptual ambiguity
        // "general (about something)" => "Yleistä" or
        // "military general" => "Kenraali"

        get_a_copy_of_on_puter: `Hanki '%%' -kopio Puter.com-sivustolta!`, // TODO: Very difficult ambiguity due to different case suffix for any possible word that you can substitue here. Can stay as is, but it's not exactly correct.

        get_copy_link: 'Get Copy Link', // TODO: Ambiguous meaning
        // 'get a copy of a link' => 'Ota Kopio Linkkiin' or
        // 'get a link to the copy' => 'Ota Linkki Kopioon' - More probable, just want to be sure

        hide_all_windows: "Piilota Kaikki Ikkunat",
        html_document: 'HTML-dokumentti',
        image: 'Kuva',
        invite_link: "Kutsulinkki",
        items_in_trash_cannot_be_renamed: `Tätä kohdetta ei voi nimetä uudelleen, koska se on roskakorissa. Jos haluat nimetä kohteen uudelleen, raahaa se ensin pois roskakorista.`,
        jpeg_image: 'JPEG-kuva',
        keep_in_taskbar: 'Pidä tehtäväpalkissa',
        log_in: "Kirjaudu Sisään",
        log_out: 'Kirjaudu Ulos',
        move: 'Siirrä',
        moving_file: "Siirretään %%",
        my_websites: "Verkkosivustoni",
        name: 'Nimi',
        name_cannot_be_empty: 'Nimi ei voi olla tyhjä.',

        name_cannot_contain_double_period: "Name can not be the '..' character.", // TODO: definition says a different thing, than the string
        // "Name can not be the '..' character." => "Nimi ei voi olla '..'-merkki." or
        // "Name can not contain the '..' character." => "Nimi ei voi sisältää merkkiä '..'."

        name_cannot_contain_period: "Name can not be the '.' character.", // TODO: definition says a different thing, than the string
        // "Name can not be the '.' character." => "Nimi ei voi olla '.'-merkki." or
        // "Name can not contain the '.' character." => "Nimi ei voi sisältää merkkiä '.'."

        name_cannot_contain_slash: "Nimi ei voi sisältää merkkiä '/'.",
        name_must_be_string: "Nimi voi olla vain merkkijono.",
        name_too_long: `Nimi ei voi olla pidempi kuin %% merkkiä.`,
        new: 'Uusi',
        new_folder: 'Uusi kansio',
        new_password: "Uusi Salasana",
        new_username: "Uusi Käyttäjänimi",
        no_dir_associated_with_site: 'Osoitteeseen ei liity mitään hakemistoa.',
        no_websites_published: "Et ole vielä julkaissut yhtään verkkosivustoa.",
        ok: 'OK',
        open: "Avaa",
        open_in_new_tab: "Avaa uudessa Välilehdessä",
        open_in_new_window: "Avaa uudessa Ikkunassa",

        open_with: "Open With", // TODO: Context dependent
        // "Open" => "Avaa", can be "Avaa..." in this context or
        // "Open With" is often translated in the context of "Open With Application" => "Avaa Sovelluksessa"

        password: "Salasana",
        password_changed: "Salasana vaihdettu.",
        passwords_do_not_match: '`Uusi Salasana` ja `Vahvista Uusi Salasana` eivät täsmää.',
        paste: 'Liitä',
        paste_into_folder: "Liitä Kansioon",
        pick_name_for_website: "Valitse nimi verkkosivustollesi:",
        picture: "Kuva",
        powered_by_puter_js: `Tämän Mahdollistaa {{link=docs}}Puter.js{{/link}}`,
        preparing: "Valmistellaan...",
        preparing_for_upload: "Valmistellaan latausta...",
        properties: "Ominaisuudet",
        publish: "Julkaise",
        publish_as_website: 'Julkaise verkkosivustona',
        recent: "Viimeisimmät",
        recover_password: "Palauta Salasana",
        refer_friends_c2a: "Saat 1 Gt tilaa jokaisesta kaverista, joka luo ja vahvistaa tilin Puterissa. Myös kaverisi saa 1 Gt tilaa!",
        refer_friends_social_media_c2a: `Hanki 1 Gt ilmaista tallennustilaa Puter.comista!`,
        refresh: 'Päivitä',

        release_address_confirmation: `Are you sure you want to release this address?`, // TODO: Slight ambiguity between the meaning of "release"
        // "get rid of" => "Oletko varma, että haluat luovuttaa tämän osoitteen?" or
        // "publish" => "Oletko varma, että haluat julkaista tämän osoitteen?"

        remove_from_taskbar:'Poista Tehtäväpalkista',
        rename: 'Nimeä uudelleen',
        repeat: 'Toista',
        resend_confirmation_code: "Lähetä Vahvistuskoodi Uudelleen",
        restore: "Palauta",
        save_account_to_get_copy_link: "Luo tili jatkaaksesi.",
        save_account_to_publish: 'Luo tili jatkaaksesi.',
        save_session_c2a: 'Luo tili tallentaaksesi nykyisen istuntosi ja välttyäksesi työn menettämiseltä.',
        scan_qr_c2a: 'Skannaa alla oleva koodi kirjautuaksesi tähän istuntoon muista laitteista',
        select: "Valitse",
        select_color: 'Valitse väri…',
        send: "Lähetä",
        send_password_recovery_email: "Lähetä Salasanan Palautussähköposti",
        session_saved: "Kiitos tilin luomisesta. Tämä istunto on tallennettu.",
        set_new_password: "Aseta Uusi Salasana",

        share_to: "Share to", // TODO: Grammatical ambiguity
        // The base form of "Share" is "Jaa". So maybe "Jaa..." is appropriate?
        // If "share to" is followed by the name of a user, it will not make any sense, as the name can be suffixed by for example "Jaa %%lle".

        show_all_windows: "Näytä Kaikki Ikkunat",
        show_hidden: 'Näytä piilotettu',
        sign_in_with_puter: "Kirjaudu sisään Puterilla",
        sign_up: "Rekisteröidy",
        signing_in: "Kirjaudutaan sisään…",
        size: 'Koko',
        sort_by: 'Lajittele:',
        start: 'Käynnistä',
        taking_longer_than_usual: 'Kestää hieman tavallista kauemmin. Odottakaa...',
        text_document: 'Tekstiasiakirja',
        tos_fineprint: `Klikkaamalla 'Luo ilmainen tili' hyväksyt Puterin käyttöehdot ja tietosuojakäytännön.`,

        trash: 'Trash', // TODO: Ambiguous meaning
        // "Trash" is oft used to just mean "Trash bin" => 'Roskakori' or
        // "Trash" by itself => 'Roska'

        type: 'Type', // TODO: Ambiguous meaning
        // "Type of an object" => 'Tyyppi' or
        // "Type on the keyboard" => 'Kirjoita'

        undo: 'Kumoa',
        unzip: "Pura zip",
        upload: 'Lataa',
        upload_here: 'Lataa tähän',
        username: "Käyttäjänimi",
        username_changed: 'Käyttäjänimi päivitetty onnistuneesti.',
        versions: "Versiot",
        yes_release_it: 'Kyllä, Julkaise Se',
        you_have_been_referred_to_puter_by_a_friend: "Kaverisi on kutsunut sinut Puterille!",
        zip: "Zip",
    }
}

export default fi;