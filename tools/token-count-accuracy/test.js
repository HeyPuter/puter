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

const claude_examples = [
    {
        type: 'output', // probably doesn't matter
        text: "I am Claude, an AI assistant created by Anthropic. I'm running on Puter, an open-source platform, through a driver interface called puter-chat-completion. I aim to be direct and honest about my identity and capabilities.",
        tokens: 55,
    },
    {
        type: 'output',
        text: `Here's a list of fascinating numbers and their significance:

1. 1.618033988749895 (φ, Phi, Golden Ratio)
- Found throughout nature and art
- Considered aesthetically pleasing
- Appears in the proportions of the Parthenon, nautilus shells, and spiral galaxies

2. 2.71828... (e, Euler's Number)
- Base of natural logarithms
- Fundamental to exponential growth and decay
- Essential in compound interest calculations

3. 3.14159... (π, Pi)
- Ratio of circle's circumference to diameter
- Transcendental number
- Appears across mathematics and physics

4. 6.02214076 × 10²³ (Avogadro's Number)
- Number of particles in one mole of substance
- Fundamental to chemistry
- Named after Italian scientist Amedeo Avogadro

5. 137 (Fine Structure Constant)
- Describes strength of electromagnetic interaction
- Mysterious number in physics
- No theoretical explanation for its value

6. 1729 (Hardy-Ramanujan Number)
- Smallest number expressible as sum of two cubes in two different ways
- Famous from conversation between mathematicians Hardy and Ramanujan

7. 42 
- Answer to "life, the universe, and everything" in Hitchhiker's Guide to the Galaxy
- Has gained cultural significance
- Interestingly appears in various mathematical contexts

8. 0.577215... (γ, Euler-Mascheroni Constant)
- Appears in number theory and calculus
- Still unknown if it's irrational
- Connected to harmonic series

9. 23! (Factorial of 23)
- Approximately equal to all seconds since Big Bang
- Shows how quickly factorial numbers grow

10. 666 (Number of the Beast)
- Cultural and religious significance
- Appears in Book of Revelation
- Subject of numerous mathematical curiosities

These numbers demonstrate how mathematics intersects with nature, science, culture, and human understanding of the universe.`,
        tokens: 481,
    },
    {
        type: 'output',
        text: `Here are some digits of Pi:
3.14159265358979323846264338327950288419716939937510...

Some digits of the square root of 2:
1.41421356237309504880168872420969807856967187537694...

And now for some random unpredictable things:

Purple elephants juggling quantum calculators in zero gravity
The sound of silence tastes like neon butterflies 
Yesterday's tomorrow forgot to attend its own birthday party
Clouds made of crystallized laughter are floating upside down
The number 7 decided to identify as a letter instead
Spinning teacups full of liquid starlight and abstract concepts
Time decided to flow sideways through a Klein bottle
Philosophical zombies debating the existence of consciousness while eating imaginary cookies
The color blue went on strike and was temporarily replaced by the smell of nostalgia
Dancing fractals wearing mismatched socks made of pure mathematics
A parade of impossible objects marching through an Escher painting
The concept of Tuesday learned to yodel in binary code
Metaphysical hiccups causing temporary glitches in the fabric of reason
Square circles plotting a revolution against euclidean geometry
The letter Q eloped with an ampersand and they had punctuation mark babies`,
        tokens: 284,
    }
];

// Measure each with tiktoken

class TikTokenCounter {
    constructor (model_to_try) {
        this.model_to_try = model_to_try;
    }

    get title () {
        return `TikToken ${this.model_to_try}`;
    }

    count (text) {
        const tiktoken = require('tiktoken');
        const enc = tiktoken.encoding_for_model(this.model_to_try);
        const tokens = enc.encode(text);
        return tokens.length;
    }
}

class DivideCounter {
    constructor (by) {
        this.by = by;
    }

    get title () {
        return `Divide by ${this.by}`;
    }

    count (text) {
        return text.length / this.by;
    }
}

const counters_to_try = [
    new TikTokenCounter('gpt-3.5-turbo'),
    new TikTokenCounter('gpt-4'),
    new TikTokenCounter('gpt-4o'),
    new TikTokenCounter('gpt-4o-mini'),
    new DivideCounter(4),
    new DivideCounter(5),
];

const scores = {};

const results = [];
for (const example of claude_examples) {
    const result = {
        example,
        counts: {},
        diffs: {},
    };
    for (const counter of counters_to_try) {
        result.counts[counter.title] = counter.count(example.text);
    }
    results.push(result);

    // Which one is the most accurate?
    const real_amount = example.tokens;
    for ( const count_name in result.counts ) {
        const count = result.counts[count_name];
        const diff = Math.abs(count - real_amount);
        result.diffs[count_name] = diff;
    }
    // Report the most accurate one
    const most_accurate =
        Object.keys(result.diffs)
            .reduce((a, b) => result.diffs[a] < result.diffs[b] ? a : b);
    result.most_accurate = most_accurate;

    scores[most_accurate] = (scores[most_accurate] || 0) + 1;
}


console.log(results);

console.log(scores);