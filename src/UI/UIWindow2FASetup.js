/*
    Plan:
        Components: OneAtATimeView < ... >

        Screen 1: QR code and entry box for testing
            Components: Flexer < QRCodeView, CodeEntryView, ActionsView >
            Logic:
            - when CodeEntryView has a value, check it against the QR code value...
              ... then go to the next screen
              - CodeEntryView will have callbacks: `verify`, `on_verified`
            - cancel action

        Screen 2: Recovery codes
            Components: Flexer < RecoveryCodesView, ConfirmationsView, ActionsView >
            Logic:
            - done action
            - cancel action
            - when done action is clicked, call /auth/configure-2fa/enable

*/

import CodeEntryView from "./Components/CodeEntryView.js";
import Flexer from "./Components/Flexer.js";
import QRCodeView from "./Components/QRCode.js";
import RecoveryCodesView from "./Components/RecoveryCodesView.js";
import StepView from "./Components/StepView.js";
import TestView from "./Components/TestView.js";
import UIComponentWindow from "./UIComponentWindow.js";

const UIWindow2FASetup = async function UIWindow2FASetup () {
    const resp = await fetch(`${api_origin}/auth/configure-2fa/setup`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${puter.authToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
    const data = await resp.json();

    const check_code_ = async function check_code_ (value) {
        const resp = await fetch(`${api_origin}/auth/configure-2fa/test`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${puter.authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code: value,
            }),
        });

        const data = await resp.json();

        return data.ok;
    };

    let stepper;
    let code_entry;
    const component =
        new StepView({
            _ref: me => stepper = me,
            children: [
                new Flexer({
                    children: [
                        new QRCodeView({
                            value: data.url,
                        }),
                        new CodeEntryView({
                            async [`property.value`] (value, { component }) {
                                console.log('value? ', value)

                                if ( false && ! await check_code_(value) ) {
                                    component.set('error', 'Invalid code');
                                    return;
                                }

                                stepper.next();
                            }
                        }),
                    ]
                }),
                new Flexer({
                    children: [
                        new RecoveryCodesView({
                            values: data.codes,
                        }),
                    ]
                }),
            ]
        })
        ;

    UIComponentWindow({
        component,
    });
}

export default UIWindow2FASetup;
