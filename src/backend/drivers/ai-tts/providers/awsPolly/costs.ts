// Microcents per character, per Polly engine.
export const AWS_POLLY_COSTS: Record<string, number> = {
    standard: 400, // $4.00 per 1M characters
    neural: 1600, // $16.00 per 1M characters
    'long-form': 10000, // $100.00 per 1M characters
    generative: 3000, // $30.00 per 1M characters
};
