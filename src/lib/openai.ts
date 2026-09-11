import OpenAI from "openai";
import { OPENAI_API_KEY } from "astro:env/server";

/**
 * S-17: an explicit `apiKey` bills the call to that key (a user's own,
 * resolved by src/lib/openai-key.ts). Omitted, it falls back to the app's
 * OPENAI_API_KEY exactly as before -- every existing caller is unaffected.
 */
export function createOpenAIClient(apiKey?: string) {
  const key = apiKey ?? OPENAI_API_KEY;
  if (!key) {
    return null;
  }
  return new OpenAI({ apiKey: key });
}
