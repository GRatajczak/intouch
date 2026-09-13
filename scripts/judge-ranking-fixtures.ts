// test-plan Phase 3 (Risk #3): an on-demand AI-native sanity check over a
// small set of frozen ranking fixtures. Asks a judge model whether each
// fixture's `reason` text contradicts its own `facts` and whether it reads as
// a genuine, specific judgment rather than generic filler.
//
// Never wired into `npm test`, `vitest.config.ts`, or any CI workflow --
// invoked only by hand, run whenever the ranking prompt changes.
//
// Follows scripts/verify-ranking.ts's shape: assert() + failures[], non-zero
// exit -- but reads local fixture files instead of hitting a deployed URL, and
// its assertions are a judge model's own yes/no answers rather than a hard
// runtime invariant.
//
// Usage: npm run judge:ranking
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export {};

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY -- this script makes real judge-model calls and refuses to run without one.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });
const JUDGE_MODEL = "gpt-5.4-mini";

interface Fixture {
  id: string;
  description: string;
  facts: Record<string, unknown> | null;
  timeWindow: string;
  reason: string;
  expectContradicts: boolean;
  expectGenuine: boolean;
}

const verdictSchema = z.object({
  contradictsFacts: z.boolean(),
  contradictsFactsRationale: z.string(),
  readsAsGenuine: z.boolean(),
  genuineRationale: z.string(),
});

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures/ranking-judge");

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf-8")) as Fixture);
}

async function judgeFixture(fixture: Fixture) {
  console.log(`\n${fixture.id} — ${fixture.description}`);

  const response = await client.responses.parse({
    model: JUDGE_MODEL,
    input: [
      {
        role: "system",
        content:
          "Jesteś rygorystycznym sędzią jakości uzasadnień w systemie rekomendacji kontaktów międzyludzkich. " +
          "Oceniasz jedno uzasadnienie (reason) w świetle podanych faktów o historii kontaktu (facts). " +
          "facts: null oznacza brak jakiejkolwiek zarejestrowanej historii kontaktu z tą osobą.",
      },
      {
        role: "user",
        content: [
          `Fakty (JSON): ${JSON.stringify(fixture.facts)}`,
          `Wybrane okno pilności: ${fixture.timeWindow}`,
          `Uzasadnienie do oceny: "${fixture.reason}"`,
          "",
          "Odpowiedz na dwa pytania:",
          "1. Czy uzasadnienie zaprzecza któremuś z podanych faktów (np. twierdzi coś przeciwnego do daty/liczby prób)?",
          "2. Czy uzasadnienie brzmi jak konkretny, uzasadniony osąd -- w przeciwieństwie do ogólnikowego tekstu zastępczego, który pasowałby do dowolnej osoby bez zmian?",
        ].join("\n"),
      },
    ],
    text: { format: zodTextFormat(verdictSchema, "verdict") },
  });

  const verdict = response.output_parsed;
  if (!verdict) {
    failures.push(`${fixture.id}: judge produced no parsed output`);
    console.error(`  ✗ judge produced no parsed output`);
    return;
  }

  assert(
    verdict.contradictsFacts === fixture.expectContradicts,
    `contradiction check: expected ${String(fixture.expectContradicts)}, got ${String(verdict.contradictsFacts)} (${verdict.contradictsFactsRationale})`,
  );
  assert(
    verdict.readsAsGenuine === fixture.expectGenuine,
    `genuineness check: expected ${String(fixture.expectGenuine)}, got ${String(verdict.readsAsGenuine)} (${verdict.genuineRationale})`,
  );
}

async function main() {
  const fixtures = loadFixtures();
  console.log(`Judging ${String(fixtures.length)} frozen ranking fixture(s) with ${JUDGE_MODEL}...`);

  for (const fixture of fixtures) {
    await judgeFixture(fixture);
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`${String(failures.length)} check(s) failed:`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log("All fixtures judged as expected.");
}

void main();
