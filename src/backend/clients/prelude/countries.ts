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

/** Per-country Prelude SMS pricing, hardcoded from the Prelude global price
 * sheet. `sms` is the average cost in EUR, or null when SMS is unavailable
 * there. Used to cap phone verification to affordable countries (see
 * PreludeClient.isCountrySupported). Regenerate from the price sheet when
 * Prelude updates rates. */
export interface CountryPrice {
    name: string;
    /** Prelude SMS average in EUR, or null when SMS is not available. */
    sms: number | null;
}

export const COUNTRY_SMS_PRICES: Record<string, CountryPrice> = {
    AD: {
        name: 'Andorra',
        sms: 0.0515,
    },
    AE: {
        name: 'United Arab Emirates',
        sms: 0.0145,
    },
    AF: {
        name: 'Afghanistan',
        sms: 0.2409,
    },
    AG: {
        name: 'Antigua and Barbuda',
        sms: 0.0755,
    },
    AI: {
        name: 'Anguilla',
        sms: 0.0765,
    },
    AL: {
        name: 'Albania',
        sms: 0.0345,
    },
    AM: {
        name: 'Armenia',
        sms: 0.118,
    },
    AN: {
        name: 'Netherlands Antilles',
        sms: null,
    },
    AO: {
        name: 'Angola',
        sms: 0.0347,
    },
    AR: {
        name: 'Argentina',
        sms: 0.0614,
    },
    AS: {
        name: 'American Samoa',
        sms: 0.077,
    },
    AT: {
        name: 'Austria',
        sms: 0.014,
    },
    AU: {
        name: 'Australia',
        sms: 0.0091,
    },
    AW: {
        name: 'Aruba',
        sms: 0.0617,
    },
    AZ: {
        name: 'Azerbaijan',
        sms: 0.0969,
    },
    BA: {
        name: 'Bosnia and Herzegovina',
        sms: 0.0801,
    },
    BB: {
        name: 'Barbados',
        sms: 0.2021,
    },
    BD: {
        name: 'Bangladesh',
        sms: 0.1844,
    },
    BE: {
        name: 'Belgium',
        sms: 0.0297,
    },
    BF: {
        name: 'Burkina Faso',
        sms: 0.063,
    },
    BG: {
        name: 'Bulgaria',
        sms: 0.0799,
    },
    BH: {
        name: 'Bahrain',
        sms: 0.014,
    },
    BI: {
        name: 'Burundi',
        sms: 0.217,
    },
    BJ: {
        name: 'Benin',
        sms: 0.13,
    },
    BM: {
        name: 'Bermuda',
        sms: 0.21,
    },
    BN: {
        name: 'Brunei',
        sms: 0.035,
    },
    BO: {
        name: 'Bolivia',
        sms: 0.0708,
    },
    BQ: {
        name: 'Caribbean Netherlands',
        sms: 0.0565,
    },
    BR: {
        name: 'Brazil',
        sms: 0.0086,
    },
    BS: {
        name: 'Bahamas',
        sms: 0.0672,
    },
    BT: {
        name: 'Bhutan',
        sms: null,
    },
    BW: {
        name: 'Botswana',
        sms: 0.0235,
    },
    BY: {
        name: 'Belarus',
        sms: 0.118,
    },
    BZ: {
        name: 'Belize',
        sms: 0.1529,
    },
    CA: {
        name: 'Canada',
        sms: 0.0052,
    },
    CD: {
        name: 'Congo RDC',
        sms: 0.1112,
    },
    CF: {
        name: 'Central African Republic',
        sms: 0.2,
    },
    CG: {
        name: 'Congo',
        sms: 0.2507,
    },
    CH: {
        name: 'Switzerland',
        sms: 0.0163,
    },
    CI: {
        name: "Cote d'Ivoire",
        sms: 0.19,
    },
    CK: {
        name: 'Cook Islands',
        sms: 0.1041,
    },
    CL: {
        name: 'Chile',
        sms: 0.0027,
    },
    CM: {
        name: 'Cameroon',
        sms: 0.1504,
    },
    CN: {
        name: 'China',
        sms: 0.0053,
    },
    CO: {
        name: 'Colombia',
        sms: 0.0008,
    },
    CR: {
        name: 'Costa Rica',
        sms: 0.0045,
    },
    CU: {
        name: 'Cuba',
        sms: 0.0512,
    },
    CV: {
        name: 'Cabo Verde',
        sms: 0.2031,
    },
    CW: {
        name: 'Curacao',
        sms: 0.0138,
    },
    CY: {
        name: 'Northern Cyprus',
        sms: 0.0065,
    },
    CZ: {
        name: 'Czech Republic',
        sms: 0.0299,
    },
    DE: {
        name: 'Germany',
        sms: 0.0598,
    },
    DJ: {
        name: 'Djibouti',
        sms: 0.0897,
    },
    DK: {
        name: 'Denmark',
        sms: 0.0301,
    },
    DM: {
        name: 'Dominica',
        sms: 0.0824,
    },
    DO: {
        name: 'Dominican Republic',
        sms: 0.0351,
    },
    DZ: {
        name: 'Algeria',
        sms: 0.196,
    },
    EC: {
        name: 'Ecuador',
        sms: 0.1041,
    },
    EE: {
        name: 'Estonia',
        sms: 0.0234,
    },
    EG: {
        name: 'Egypt',
        sms: 0.1561,
    },
    ER: {
        name: 'Eritrea',
        sms: 0.0659,
    },
    ES: {
        name: 'Spain',
        sms: 0.0193,
    },
    ET: {
        name: 'Ethiopia',
        sms: 0.2741,
    },
    FI: {
        name: 'Finland',
        sms: 0.043,
    },
    FJ: {
        name: 'Fiji',
        sms: 0.069,
    },
    FK: {
        name: 'Falkland Islands',
        sms: 0.0713,
    },
    FM: {
        name: 'Micronesia',
        sms: 0.0118,
    },
    FO: {
        name: 'Faroe Islands',
        sms: 0.0319,
    },
    FR: {
        name: 'France',
        sms: 0.03,
    },
    GA: {
        name: 'Gabon',
        sms: 0.15,
    },
    GB: {
        name: 'United Kingdom',
        sms: 0.026,
    },
    GD: {
        name: 'Grenada',
        sms: null,
    },
    GE: {
        name: 'Georgia',
        sms: 0.0788,
    },
    GF: {
        name: 'French Guiana',
        sms: 0.05,
    },
    GG: {
        name: 'Guernsey',
        sms: 0.025,
    },
    GH: {
        name: 'Ghana',
        sms: 0.15,
    },
    GI: {
        name: 'Gibraltar',
        sms: 0.0134,
    },
    GL: {
        name: 'Greenland',
        sms: 0.0048,
    },
    GM: {
        name: 'Gambia',
        sms: 0.1283,
    },
    GN: {
        name: 'Guinea',
        sms: 0.2,
    },
    GP: {
        name: 'Guadeloupe',
        sms: 0.0455,
    },
    GQ: {
        name: 'Equatorial Guinea',
        sms: 0.099,
    },
    GR: {
        name: 'Greece',
        sms: 0.0296,
    },
    GT: {
        name: 'Guatemala',
        sms: 0.1202,
    },
    GU: {
        name: 'Guam',
        sms: 0.02,
    },
    GW: {
        name: 'Guinea-Bissau',
        sms: 0.1566,
    },
    GY: {
        name: 'Guyana',
        sms: 0.2178,
    },
    HK: {
        name: 'Hong Kong',
        sms: 0.038,
    },
    HN: {
        name: 'Honduras',
        sms: 0.162,
    },
    HR: {
        name: 'Croatia',
        sms: 0.03,
    },
    HT: {
        name: 'Haiti',
        sms: 0.09,
    },
    HU: {
        name: 'Hungary',
        sms: 0.029,
    },
    ID: {
        name: 'Indonesia',
        sms: 0.243,
    },
    IE: {
        name: 'Ireland',
        sms: 0.0305,
    },
    IL: {
        name: 'Israel',
        sms: 0.01,
    },
    IM: {
        name: 'Isle of Man',
        sms: 0.0385,
    },
    IN: {
        name: 'India',
        sms: 0.0375,
    },
    IQ: {
        name: 'Iraq',
        sms: 0.151,
    },
    IR: {
        name: 'Iran',
        sms: 0.14,
    },
    IS: {
        name: 'Iceland',
        sms: 0.0493,
    },
    IT: {
        name: 'Italy',
        sms: 0.0245,
    },
    JE: {
        name: 'Jersey',
        sms: 0.025,
    },
    JM: {
        name: 'Jamaica',
        sms: 0.1525,
    },
    JO: {
        name: 'Jordan',
        sms: 0.2094,
    },
    JP: {
        name: 'Japan',
        sms: 0.017,
    },
    KE: {
        name: 'Kenya',
        sms: 0.125,
    },
    KG: {
        name: 'Kyrgyzstan',
        sms: 0.15,
    },
    KH: {
        name: 'Cambodia',
        sms: 0.1529,
    },
    KI: {
        name: 'Kiribati',
        sms: 0.025,
    },
    KM: {
        name: 'Comoros',
        sms: 0.15,
    },
    KN: {
        name: 'Saint Kitts and Nevis',
        sms: 0.1295,
    },
    KR: {
        name: 'South Korea',
        sms: 0.006,
    },
    KW: {
        name: 'Kuwait',
        sms: 0.145,
    },
    KY: {
        name: 'Cayman Islands',
        sms: 0.2172,
    },
    KZ: {
        name: 'Kazakhstan',
        sms: 0.202,
    },
    LA: {
        name: 'Laos',
        sms: 0.15,
    },
    LB: {
        name: 'Lebanon',
        sms: 0.153,
    },
    LC: {
        name: 'Saint Lucia',
        sms: 0.0892,
    },
    LI: {
        name: 'Liechtenstein',
        sms: null,
    },
    LK: {
        name: 'Sri Lanka',
        sms: 0.3593,
    },
    LR: {
        name: 'Liberia',
        sms: 0.1448,
    },
    LS: {
        name: 'Lesotho',
        sms: 0.0301,
    },
    LT: {
        name: 'Lithuania',
        sms: 0.0261,
    },
    LU: {
        name: 'Luxembourg',
        sms: 0.034,
    },
    LV: {
        name: 'Latvia',
        sms: 0.028,
    },
    LY: {
        name: 'Libya',
        sms: 0.1898,
    },
    MA: {
        name: 'Morocco',
        sms: 0.105,
    },
    MC: {
        name: 'Monaco',
        sms: 0.1219,
    },
    MD: {
        name: 'Moldova',
        sms: 0.065,
    },
    ME: {
        name: 'Montenegro',
        sms: 0.07,
    },
    MG: {
        name: 'Madagascar',
        sms: 0.24,
    },
    MH: {
        name: '',
        sms: 0.032,
    },
    MK: {
        name: 'Macedonia',
        sms: 0.0096,
    },
    ML: {
        name: 'Mali',
        sms: 0.136,
    },
    MM: {
        name: 'Myanmar',
        sms: 0.3037,
    },
    MN: {
        name: 'Mongolia',
        sms: 0.183,
    },
    MO: {
        name: 'Macao',
        sms: 0.005,
    },
    MP: {
        name: 'Northern Mariana Islands',
        sms: 0.0669,
    },
    MQ: {
        name: 'Martinique',
        sms: 0.0455,
    },
    MR: {
        name: 'Mauritania',
        sms: 0.161,
    },
    MS: {
        name: 'Montserrat',
        sms: 0.0725,
    },
    MT: {
        name: 'Malta',
        sms: 0.0343,
    },
    MU: {
        name: 'Mauritius',
        sms: 0.1431,
    },
    MV: {
        name: 'Maldives',
        sms: 0.145,
    },
    MW: {
        name: 'Malawi',
        sms: 0.19,
    },
    MX: {
        name: 'Mexico',
        sms: 0.0021,
    },
    MY: {
        name: 'Malaysia',
        sms: 0.08,
    },
    MZ: {
        name: 'Mozambique',
        sms: 0.2266,
    },
    NA: {
        name: 'Namibia',
        sms: 0.0173,
    },
    NC: {
        name: 'New Caledonia',
        sms: 0.052,
    },
    NE: {
        name: 'Niger',
        sms: 0.143,
    },
    NG: {
        name: 'Nigeria',
        sms: 0.198,
    },
    NI: {
        name: 'Nicaragua',
        sms: 0.1033,
    },
    NL: {
        name: 'Netherlands',
        sms: 0.046,
    },
    NO: {
        name: 'Norway',
        sms: 0.03,
    },
    NP: {
        name: 'Nepal',
        sms: 0.1645,
    },
    NR: {
        name: 'Nauru',
        sms: null,
    },
    NU: {
        name: 'Niue',
        sms: null,
    },
    NZ: {
        name: 'New Zealand',
        sms: 0.0372,
    },
    OM: {
        name: 'Oman',
        sms: 0.0713,
    },
    PA: {
        name: 'Panama',
        sms: 0.07,
    },
    PE: {
        name: 'Peru',
        sms: 0.13,
    },
    PF: {
        name: 'French Polynesia',
        sms: 0.0518,
    },
    PG: {
        name: 'Papua New Guinea',
        sms: 0.15,
    },
    PH: {
        name: 'Philippines',
        sms: 0.1237,
    },
    PK: {
        name: 'Pakistan',
        sms: 0.3548,
    },
    PL: {
        name: 'Poland',
        sms: 0.011,
    },
    PM: {
        name: 'Saint Pierre and Miquelon',
        sms: 0.0905,
    },
    PR: {
        name: 'Puerto Rico',
        sms: 0.02,
    },
    PS: {
        name: 'Palestine',
        sms: 0.2541,
    },
    PT: {
        name: 'Portugal',
        sms: 0.009,
    },
    PW: {
        name: 'Palau',
        sms: null,
    },
    PY: {
        name: 'Paraguay',
        sms: 0.0236,
    },
    QA: {
        name: 'Qatar',
        sms: 0.1393,
    },
    RE: {
        name: 'Reunion',
        sms: 0.034,
    },
    RO: {
        name: 'Romania',
        sms: 0.0255,
    },
    RS: {
        name: 'Serbia',
        sms: 0.1935,
    },
    RU: {
        name: 'Russia',
        sms: 0.2028,
    },
    RW: {
        name: 'Rwanda',
        sms: 0.1177,
    },
    SA: {
        name: 'Saudi Arabia',
        sms: 0.0638,
    },
    SB: {
        name: 'Solomon Islands',
        sms: 0.0357,
    },
    SC: {
        name: 'Seychelles',
        sms: 0.0404,
    },
    SD: {
        name: 'Sudan',
        sms: 0.224,
    },
    SE: {
        name: 'Sweden',
        sms: 0.026,
    },
    SG: {
        name: 'Singapore',
        sms: 0.0256,
    },
    SI: {
        name: 'Slovenia',
        sms: 0.1,
    },
    SK: {
        name: 'Slovakia',
        sms: 0.0245,
    },
    SL: {
        name: 'Sierra Leone',
        sms: 0.2322,
    },
    SM: {
        name: 'San Marino',
        sms: null,
    },
    SN: {
        name: 'Senegal',
        sms: 0.1151,
    },
    SO: {
        name: 'Somalia',
        sms: 0.06,
    },
    SR: {
        name: 'Suriname',
        sms: 0.119,
    },
    SS: {
        name: 'South Sudan',
        sms: 0.15,
    },
    ST: {
        name: 'Sao Tome and Principe',
        sms: 0.0133,
    },
    SV: {
        name: 'El Salvador',
        sms: 0.06,
    },
    SX: {
        name: 'Sint Maarten',
        sms: 0.0623,
    },
    SY: {
        name: 'Syria',
        sms: 0.221,
    },
    SZ: {
        name: 'Eswatini',
        sms: 0.12,
    },
    TC: {
        name: 'Turks and Caicos Islands',
        sms: null,
    },
    TD: {
        name: 'Chad',
        sms: 0.1711,
    },
    TG: {
        name: 'Togo',
        sms: 0.1806,
    },
    TH: {
        name: 'Thailand',
        sms: 0.003,
    },
    TJ: {
        name: 'Tajikistan',
        sms: 0.2626,
    },
    TL: {
        name: 'Timor-Leste',
        sms: 0.0675,
    },
    TM: {
        name: 'Turkmenistan',
        sms: 0.1677,
    },
    TN: {
        name: 'Tunisia',
        sms: 0.225,
    },
    TO: {
        name: 'Tonga',
        sms: 0.0902,
    },
    TR: {
        name: 'Turkey',
        sms: 0.0008,
    },
    TT: {
        name: 'Trinidad and Tobago',
        sms: 0.1556,
    },
    TW: {
        name: 'Taiwan',
        sms: 0.0165,
    },
    TZ: {
        name: 'Tanzania',
        sms: 0.2753,
    },
    UA: {
        name: 'Ukraine',
        sms: 0.094,
    },
    UG: {
        name: 'Uganda',
        sms: 0.1707,
    },
    US: {
        name: 'United States',
        sms: 0.0043,
    },
    UY: {
        name: 'Uruguay',
        sms: 0.0174,
    },
    UZ: {
        name: 'Uzbekistan',
        sms: 0.292,
    },
    VC: {
        name: 'Saint Vincent and The Grenadines',
        sms: 0.1216,
    },
    VE: {
        name: 'Venezuela',
        sms: 0.0427,
    },
    VG: {
        name: 'British Virgin Islands',
        sms: 0.083,
    },
    VI: {
        name: 'Virgin Island',
        sms: 0.0017,
    },
    VN: {
        name: 'Vietnam',
        sms: 0.0885,
    },
    VU: {
        name: 'Vanuatu',
        sms: 0.1347,
    },
    WF: {
        name: 'Wallis and Futuna',
        sms: 0.09,
    },
    WS: {
        name: 'Samoa',
        sms: 0.2,
    },
    XK: {
        name: 'Kosovo',
        sms: 0.1394,
    },
    YE: {
        name: 'Yemen',
        sms: 0.1486,
    },
    YT: {
        name: 'Mayotte',
        sms: 0.06,
    },
    ZA: {
        name: 'South Africa',
        sms: 0.039,
    },
    ZM: {
        name: 'Zambia',
        sms: 0.21,
    },
    ZW: {
        name: 'Zimbabwe',
        sms: 0.13,
    },
};
