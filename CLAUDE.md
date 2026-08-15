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

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
