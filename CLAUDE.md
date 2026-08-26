## Cloudflare: Workers, nie Pages

`@astrojs/cloudflare` v13 usunął wsparcie dla Cloudflare Pages i `Astro.locals.runtime`. Ten projekt deployuje się jako **Cloudflare Worker**, nie Pages.

- `wrangler pages deploy` jest zakazane w tym repo — użyj `npm run deploy` (= `astro build && wrangler deploy`) albo `npm run preview:upload` (= `astro build && wrangler versions upload`) dla wersji bez ruchu produkcyjnego.
- Dostęp do zmiennych środowiskowych wyłącznie przez `astro:env/server` (patrz `src/lib/supabase.ts`). Nigdy `Astro.locals.runtime` (nie istnieje w v13) ani `process.env`.
- `wrangler.jsonc` → `"name": "intouch"` determinuje subdomenę `*.workers.dev`; produkcyjny URL to `https://intouch.g-ratajczak97.workers.dev`.

## Rollback

`wrangler rollback <VERSION_ID>` cofa **tylko kod Workera** — nie cofa bound resources (KV, D1, R2, Durable Objects) ani migracji Supabase. Jeśli produkcja zostanie cofnięta do starszej wersji kodu, baza zostaje na najnowszym schemacie.

Konsekwencja: migracje Supabase muszą być **wyłącznie forward-compatible**:
- nową kolumnę dodawaj i wypełniaj domyślną wartością zanim kod zacznie jej wymagać
- starą kolumnę usuwaj dopiero co najmniej jeden deploy po tym, jak żaden kod przestał jej używać

`supabase/migrations/` jeszcze nie istnieje, ale ta zasada obowiązuje od pierwszej migracji.

## Sekrety

Sekrety żyją w trzech miejscach:

- `.dev.vars` (gitignored) — lokalny dev
- Workers Secrets (`wrangler secret put`) — **źródło prawdy dla produkcji**
- GitHub Secrets — CI/CD (`wrangler-action`)

Ustawianie/rotacja sekretów produkcyjnych to operacja człowieka, nie agenta.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
