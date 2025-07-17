import { OpenAIStyleStreamAdapter } from "../airouter.js";

/**
 * OpenAIStreamAdapter extends OpenAIStyleStreamAdapter without overriding
 * any methods instead. It's redundant in terms of functionality, as
 * OpenAIStreamAdapter could be used directly. However, this makes the
 * intended architecture clearer and more consistent with other integrations,
 * where each provider has its own adapter class.
 */
export class OpenAIStreamAdapter extends OpenAIStyleStreamAdapter {}
