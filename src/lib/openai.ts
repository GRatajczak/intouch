import OpenAI from "openai";
import { OPENAI_API_KEY } from "astro:env/server";

export function createOpenAIClient() {
  if (!OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}
