import { Ollama, type EmbedResponse } from 'ollama';

/**
 * Generates embeddings for the given input using the specified model.
 *
 * @param model - Ollama model name to use for embedding
 * @param input - Text or array of texts to embed
 * @param host - Ollama server URL; defaults to the ollama SDK default (localhost:11434)
 */
export const embed = async (model: string, input: string | string[], host?: string): Promise<EmbedResponse> => {
	const client = new Ollama(host ? { host } : {});
	return client.embed({ model, input });
};