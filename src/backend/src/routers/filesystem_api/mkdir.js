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
"use strict"
const eggspress = require('../../api/eggspress');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLMkdir } = require('../../filesystem/hl_operations/hl_mkdir');
const { Context } = require('../../util/context');
const { boolify } = require('../../util/hl_types');

// -----------------------------------------------------------------------//
// POST /mkdir
// -----------------------------------------------------------------------//
module.exports = eggspress('/mkdir', {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    parameters: {
        parent: new FSNodeParam('parent', { optional: true }),
        shortcut_to: new FSNodeParam('shortcut_to', { optional: true }),
    }
}, async (req, res, next) => {
    // validation
    if(req.body.path === undefined)
        return res.status(400).send({message: 'path is required'})
    else if(req.body.path === '')
        return res.status(400).send({message: 'path cannot be empty'})
    else if(req.body.path === null)
        return res.status(400).send({message: 'path cannot be null'})
    else if(typeof req.body.path !== 'string')
        return res.status(400).send({message: 'path must be a string'})

    const overwrite         = req.body.overwrite ?? false;

    // modules
    let frame;
    {
        const x = Context.get();
        const operationTraceSvc = x.get('services').get('operationTrace');
        frame = (await operationTraceSvc.add_frame('api:/mkdir'))
            .attr('gui_metadata', {
                original_client_socket_id: req.body.original_client_socket_id,
                operation_id: req.body.operation_id,
                user_id: req.user.id,
            })
            ;
        x.set(operationTraceSvc.ckey('frame'), frame);
    }

    // PEDANTRY: in theory there's no difference between creating an object just to call
    //           a method on it and calling a utility function. HLMkdir is a class because
    //           it uses traits and supports dependency injection, but those features are
    //           not concerns of this endpoint handler.
    const hl_mkdir = new HLMkdir();
    const response = await hl_mkdir.run({
        parent: req.values.parent,
        path: req.body.path,
        overwrite: overwrite,
        dedupe_name: req.body.dedupe_name ?? false,
        create_missing_parents: boolify(
            req.body.create_missing_ancestors ??
            req.body.create_missing_parents
        ),
        actor: req.actor,
        shortcut_to: req.values.shortcut_to,
    });

    // TODO: maybe endpoint handlers are operations too. It would be much
    // nicer to not have to explicitly call frame.done() here.
    frame.done();

    return res.send(response);
})
