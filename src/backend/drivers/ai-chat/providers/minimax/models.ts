import type { IChatModel } from '../../types.js';

export type MiniMaxChatModel = IChatModel & {
	upstreamModel: string;
};

type MiniMaxModelSpec = {
	id: string;
	upstreamModel: string;
	puterId: string;
	name: string;
	context: number;
	aliases?: string[];
};

const makeModel = (spec: MiniMaxModelSpec): MiniMaxChatModel => ({
	id: spec.id,
	puterId: spec.puterId,
	name: spec.name,
	aliases: spec.aliases ?? [],
	modalities: { input: ['text'], output: ['text'] },
	costs_currency: 'usd-cents',
	input_cost_key: 'prompt_tokens',
	output_cost_key: 'completion_tokens',
	costs: {
		tokens: 1_000_000,
		prompt_tokens: 0,
		completion_tokens: 0,
		cached_tokens: 0,
	},
	context: spec.context,
	max_tokens: spec.context,
	tool_call: true,
	upstreamModel: spec.upstreamModel,
});

export const MINIMAX_MODELS: MiniMaxChatModel[] = [
	makeModel({
		id: 'minimax-m2.7',
		upstreamModel: 'MiniMax-M2.7',
		puterId: 'minimax/m2.7',
		name: 'MiniMax M2.7',
		context: 204_800,
		aliases: ['MiniMax-M2.7', 'mini-max-m2.7', 'm2.7'],
	}),
	makeModel({
		id: 'minimax-m2.7-highspeed',
		upstreamModel: 'MiniMax-M2.7-highspeed',
		puterId: 'minimax/m2.7-highspeed',
		name: 'MiniMax M2.7 Highspeed',
		context: 204_800,
		aliases: ['MiniMax-M2.7-highspeed', 'm2.7-highspeed'],
	}),
	makeModel({
		id: 'minimax-m2.5',
		upstreamModel: 'MiniMax-M2.5',
		puterId: 'minimax/m2.5',
		name: 'MiniMax M2.5',
		context: 204_800,
		aliases: ['MiniMax-M2.5', 'm2.5'],
	}),
	makeModel({
		id: 'minimax-m2.5-highspeed',
		upstreamModel: 'MiniMax-M2.5-highspeed',
		puterId: 'minimax/m2.5-highspeed',
		name: 'MiniMax M2.5 Highspeed',
		context: 204_800,
		aliases: ['MiniMax-M2.5-highspeed', 'm2.5-highspeed'],
	}),
	makeModel({
		id: 'minimax-m2.1',
		upstreamModel: 'MiniMax-M2.1',
		puterId: 'minimax/m2.1',
		name: 'MiniMax M2.1',
		context: 204_800,
		aliases: ['MiniMax-M2.1', 'm2.1'],
	}),
	makeModel({
		id: 'minimax-m2.1-highspeed',
		upstreamModel: 'MiniMax-M2.1-highspeed',
		puterId: 'minimax/m2.1-highspeed',
		name: 'MiniMax M2.1 Highspeed',
		context: 204_800,
		aliases: ['MiniMax-M2.1-highspeed', 'm2.1-highspeed'],
	}),
	makeModel({
		id: 'minimax-m2-her',
		upstreamModel: 'MiniMax-M2-her',
		puterId: 'minimax/m2-her',
		name: 'MiniMax M2-her',
		context: 65_536,
		aliases: ['MiniMax-M2-her', 'm2-her'],
	}),
	makeModel({
		id: 'minimax-m2',
		upstreamModel: 'MiniMax-M2',
		puterId: 'minimax/m2',
		name: 'MiniMax M2',
		context: 204_800,
		aliases: ['MiniMax-M2', 'm2'],
	}),
];