---
bootstrapped_at: 2026-07-28T20:11:36Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: intouch
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of the frontmatter from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: intouch
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
```

### Why this stack

InTouch is a solo, after-hours web-app MVP on a 3-week budget whose core is an
AI-ranked contact hierarchy over private, per-user data about third parties. That
combination — auth for sensitive data (FR-001), a Postgres store, and AI-friendly
explicit types for the ranking logic — is exactly what the 10x Astro Starter
(Astro + React + TypeScript + Supabase + Cloudflare) delivers out of the box, and
it is the recommended default for the `(web, js)` cell. It clears all four
agent-friendly gates (typed, convention-based, popular in training, well
documented), which matters because the hierarchy and feedback-loop code will be
largely agent-written. Bootstrapper confidence is first-class. Auth and AI flags
are set; payments and realtime are out of scope per Non-Goals. The one seam to
watch is background work — scheduled reminders (FR-008) and non-blocking AI
generation must run off a queue or external worker, since Cloudflare's edge
runtime constrains long-running tasks. CI runs on GitHub Actions with
auto-deploy-on-merge, the starter's default shape.

## Pre-scaffold verification

| Signal      | Value                                                              | Severity | Notes                                                                                       |
| ----------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| npm package | not run                                                            | n/a      | `cmd_template` starts with `git clone`; no `create-*` CLI to resolve                          |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-05-17T10:33:39Z | fresh    | from `card.docs_url`; ~2.4 months old. `gh` CLI not installed — read via GitHub REST API instead |

No stale signal. Proceeded without a heads-up.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 top-level entries (50 project files excluding `node_modules/`, plus the installed `node_modules/` tree — 774 packages, 895 total dependencies)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (no pre-existing `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted
**Upstream `.git/`**: deleted before move-up, per the git-clone strategy — the starter's history did not leak into this project

Top-level entries moved into cwd:

`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `CLAUDE.md.scaffold`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

Preserved untouched in cwd: `context/` (source of truth for the bootstrap chain, never overwritten), `CLAUDE.md`, `.claude/`, `.ai/`. The scaffold shipped no `context/` tree, so no scaffold paths were dropped under the `context/**` rule.

Note: an intermediate cleanup command ran against a stale relative path (the shell's working directory had carried into `.bootstrap-scaffold/`) and was a no-op; it was re-run with an absolute path and the upstream `.git/` was confirmed removed before the move-up. No files were affected by the no-op.

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1 — informational only; npm exits non-zero whenever advisories exist)
**Summary**: 1 CRITICAL, 12 HIGH, 7 MODERATE, 2 LOW (22 total)
**Direct vs transitive**: 0/1/2/0 direct of total 1/12/7/2 — i.e. 3 of 22 findings are in packages `package.json` names directly (`astro`, `supabase`, `wrangler`); the remaining 19 are transitive.
**Dependency counts**: 449 prod, 316 dev, 131 optional, 895 total.

Every finding reports `fixAvailable: true`, so `npm audit fix` is expected to resolve them; bootstrapper does not run it.

#### CRITICAL findings

- **`tar`** — transitive (reached via direct dependency `supabase`). Advisory chain: node-tar decompression/parse DoS via unlimited input (critical); negative tar entry size causes infinite loop in archive replace (high); PAX size override on intermediary GNU long-name/long-link headers causes parser interpretation differential / file smuggling (moderate); process crash via PAX numeric path type confusion (moderate); uncaught-exception DoS via NUL byte in PAX path/linkpath records (moderate); uncontrolled recursion in `mapHas`/`filesFilter` allowing uncatchable stack-overflow DoS (moderate). Fix available.

#### HIGH findings

- **`astro`** — **direct**. Reflected XSS via unescaped slot name (high); host-header SSRF in prerendered error-page fetch (high); XSS via unescaped attribute names in spread props (moderate); reflected XSS via unescaped View Transition animation properties (moderate); XSS via unescaped spread attribute names in `renderHTMLElement`, incomplete fix for CVE-2026-54298 (moderate); XSS via unescaped `transition:*` directive values on hydrated islands (low). Also pulls advisories via `esbuild` and `sharp`. Fix available.
- **`brace-expansion`** — transitive. DoS via exponential-time expansion of consecutive non-expanding `{}` groups (high, two advisories); DoS via unbounded expansion length causing OOM crash (high). Fix available.
- **`devalue`** — transitive. Svelte devalue DoS via sparse-array deserialization (high). Fix available.
- **`fast-uri`** — transitive. Host confusion via literal backslash authority delimiter (high); host confusion via failed IDN canonicalization (high). Fix available.
- **`js-yaml`** — transitive. YAML merge-key chains force quadratic CPU consumption (high); quadratic-complexity DoS in merge-key handling via repeated aliases (moderate). Fix available.
- **`miniflare`** — transitive. Inherits from `sharp`, `undici`, `ws`. Fix available.
- **`postcss`** — transitive. Path traversal in previous-source-map auto-loading (`sourceMappingURL`) leading to arbitrary `.map` file disclosure (high). Fix available.
- **`sharp`** — transitive. Inherited libvips vulnerabilities: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (high). Fix available.
- **`svgo`** — transitive. `removeScripts` plugin leaves some executable scripts intact (high). Fix available.
- **`undici`** — transitive. TLS certificate-validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent (high); WebSocket DoS via fragment-count bypass (high); cross-origin request routing via SOCKS5 proxy pool reuse (high); HTTP header injection via Set-Cookie percent-decoding (moderate); cross-user information disclosure via shared cache whitespace bypass (moderate); HTTP response-queue poisoning via keep-alive socket reuse (low); Set-Cookie SameSite downgrade via permissive substring matching (low). Fix available.
- **`vite`** — transitive. `server.fs.deny` bypass on Windows alternate paths (high); `launch-editor` NTLMv2 hash disclosure via UNC path handling on Windows (moderate). Fix available.
- **`ws`** — transitive. Memory-exhaustion DoS from tiny fragments and data chunks (high); uninitialized memory disclosure (moderate). Fix available.

#### MODERATE findings

- **`supabase`** — **direct**. Inherits from `tar` (see CRITICAL). Fix available.
- **`wrangler`** — **direct**. Inherits from `esbuild`, `miniflare`. Fix available.
- **`@astrojs/language-server`** — transitive, via `volar-service-yaml`. Fix available.
- **`@cloudflare/vite-plugin`** — transitive, via `miniflare`, `wrangler`, `ws`. Fix available.
- **`volar-service-yaml`** — transitive, via `yaml-language-server`. Fix available.
- **`yaml`** — transitive. Stack overflow via deeply nested YAML collections (moderate). Fix available.
- **`yaml-language-server`** — transitive, via `yaml`. Fix available.

#### LOW / INFO findings

- **`@babel/core`** — transitive. Arbitrary file read via `sourceMappingURL` comment (low). Fix available.
- **`esbuild`** — transitive. Arbitrary file read when running the development server on Windows (low). Fix available.

Reading note: the direct/transitive split matters here. Only `astro`, `supabase`, and `wrangler` are packages this project chose; the rest arrive through the dependency graph and are advisory until upstream ships. A large share of the HIGH tier is Windows-specific or dev-server-only (`vite`, `esbuild`, `launch-editor`), which is lower-exposure for a Cloudflare-deployed app built on macOS — but that is a judgement call for the project owner, not bootstrapper.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | true                 |

None of these altered the scaffold in v1. Note that the starter shipped its own `.github/` directory — that is the starter's content, not CI generated by bootstrapper in response to `ci_provider`.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. Here: `diff CLAUDE.md CLAUDE.md.scaffold` — your existing `CLAUDE.md` (the lesson's project instructions) won; the starter's version is sidelined.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. Every finding reports a fix as available.
- Copy `.env.example` to `.env` and fill in Supabase credentials before the first run.
