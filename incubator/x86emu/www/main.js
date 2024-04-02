#!/usr/bin/env node
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

		hostvm.add_listener("emulator-started", function() {
			process.stdout.write("Welcome to psl!");
		});

		hostvm.add_listener("serial0-output-byte", function(byte) {
			var chr = String.fromCharCode(byte);
			if (chr <= "~") {
				process.stdout.write(chr);
			}
		});

		process.stdin.on("data", function(c) {
			// ctrl d
			if (c === "\u0004") {
				hostvm.stop();
				process.stdin.pause();
			}
			else {
				hostvm.serial0_send(c);
			}
		});
	}).catch(error => {
		console.log(error);
		throw Error("Error in getting host inastance, quitting");
	});
}).catch(error => {
	console.error('Error loading InstanceManager:', error);
});
