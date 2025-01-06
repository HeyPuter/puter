/*
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
"use strict";

import('./js/InstanceManager.mjs').then(module => {
	const InstanceManager = module.default;

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf8");

	console.log("Now booting, please stand by ...");

	const manager = new InstanceManager({ screen: false, term: false, spawnRoot: undefined });
	manager.getInstanceByinstName("Host").then(result => {
		const hostvm = result.vm;

		hostvm.add_listener("emulator-started", () => {
			process.stdout.write("Welcome to psl!");
			hostvm.serial0_send("\n");
		});

		hostvm.add_listener("serial0-output-byte", (byte) => {
			var chr = String.fromCharCode(byte);
			if (chr <= "~") {
				process.stdout.write(chr);
			}
		});

		process.stdin.on("data", (c) => {
			if (c === "\u0004") {
				hostvm.stop();
				process.stdin.pause();
			}
			else {
				hostvm.serial0_send(c);
			}
		});
	}).catch(error => {
		console.error(error);
		throw Error("Error in getting host inastance, quitting");
	});
}).catch(error => {
	console.error('Error loading InstanceManager:', error);
});
