---
project: "InTouch"
version: 1
status: active
created: 2026-08-17
updated: 2026-08-17
source: context/foundation/roadmap.md
source_version: 1
repo: GRatajczak/intouch
issues_url: https://github.com/GRatajczak/intouch/issues
linear_workspace: https://linear.app/gratajczak
linear_team: GRA
linear_project: https://linear.app/gratajczak/project/intouch-mvp-v1-b1b8d2f12cac
---

# Tracker mapping ← Roadmap

> Zrzut `context/foundation/roadmap.md` (v1) do dwóch trackerów, wykonany 2026-08-17:
> **GitHub Issues** (przez `gh` CLI) i **Linear** (przez MCP).
> Ten plik jest **mapą**, nie trzecią roadmapą. Treść pozycji żyje w `roadmap.md`; ten dokument
> mówi wyłącznie, gdzie każda pozycja wylądowała i jaką ma tam reprezentację.

## Task management systems

Roadmapa żyje równolegle w dwóch trackerach. **To jest świadoma duplikacja** — patrz
`## Znane ograniczenia`, bo bez dyscypliny oba się rozjadą.

### GitHub Issues (primary) — repo [`GRatajczak/intouch`](https://github.com/GRatajczak/intouch)

Wybrany dlatego, że repo już tam jest, ma włączone Issues, a CI/CD (`ci.yml`, `deploy.yml`)
i tak żyje w GitHub Actions — commity i PR-y linkują się do issues bez dodatkowej integracji.
Stan przed migracją: 0 issues, 1 zamknięty PR, tylko 9 domyślnych labelek, 0 milestone'ów.

Świadomie **nie** użyto GitHub Projects (board) — obecny token nie ma scope'u `project`,
a przy 11 pozycjach filtr po labelkach daje to samo bez dodatkowej konfiguracji.
Jeśli board będzie potrzebny: `gh auth refresh -s project`, potem `gh project create`.

### Linear — workspace [`GRatajczak`](https://linear.app/gratajczak), team `GRA`

Dodany 2026-08-17 przez Linear MCP, na podstawie już istniejących issues GitHubowych.
Stan przed migracją: 1 team, 0 projektów, 3 domyślne labelki (`Bug`, `Feature`, `Improvement`),
domyślne statusy, 4 onboardingowe zadania Linear (`GRA-1`…`GRA-4`).

Utworzony projekt: **[InTouch MVP v1](https://linear.app/gratajczak/project/intouch-mvp-v1-b1b8d2f12cac)**
— odpowiednik milestone'u `MVP v1` z GitHuba, z opisem vision / north star / kolejności streamów
i linkami do `roadmap.md` oraz GitHub Issues.

## Mapa: roadmap ID → issue

| Roadmap ID | Change ID | GitHub | Linear | Tytuł (wspólny w obu) |
| ---------- | --------- | ------ | ------ | --------------------- |
| F-01 | `per-user-data-isolation` | [#2](https://github.com/GRatajczak/intouch/issues/2) | [GRA-5](https://linear.app/gratajczak/issue/GRA-5) | `[F-01] Migration path + default-deny RLS for user-owned data` |
| F-02 | `openai-ranking-call-path` | [#3](https://github.com/GRatajczak/intouch/issues/3) | [GRA-6](https://linear.app/gratajczak/issue/GRA-6) | `[F-02] Non-blocking OpenAI call path from the Worker` |
| S-01 | `profile-and-first-people` | [#4](https://github.com/GRatajczak/intouch/issues/4) | [GRA-7](https://linear.app/gratajczak/issue/GRA-7) | `[S-01] Self-profile + add people with description and weight` |
| S-02 | `ai-contact-hierarchy` | [#5](https://github.com/GRatajczak/intouch/issues/5) | [GRA-8](https://linear.app/gratajczak/issue/GRA-8) | `[S-02] AI-ranked contact hierarchy with suggested time windows` |
| S-03 | `did-it-happen-feedback-loop` | [#6](https://github.com/GRatajczak/intouch/issues/6) | [GRA-9](https://linear.app/gratajczak/issue/GRA-9) | `[S-03] Did-it-happen confirmation feeding the next ranking` |
| S-04 | `decay-driven-reminders` | [#7](https://github.com/GRatajczak/intouch/issues/7) | [GRA-10](https://linear.app/gratajczak/issue/GRA-10) | `[S-04] Decay-driven reminders, at most once per day` |
| S-05 | `person-lifecycle-and-erasure` | [#8](https://github.com/GRatajczak/intouch/issues/8) | [GRA-11](https://linear.app/gratajczak/issue/GRA-11) | `[S-05] Edit, deactivate and irreversibly delete a person` |

Wszystkie 7 są w milestone `MVP v1` (GitHub) i projekcie `InTouch MVP v1` (Linear).
Każde zadanie w Linear ma link-attachment do swojego odpowiednika na GitHubie.

## Mapa: Open Roadmap Questions → issue

Pytania z `## Open Roadmap Questions` dostały własne issues, bo są **decyzjami do odhaczenia**,
a nie pracą do dostarczenia. Dlatego są poza milestone'em `MVP v1` — inaczej zafałszowałyby
pasek postępu MVP.

| Q | Pytanie | GitHub | Linear | Blokuje | Blokująco? |
| - | ------- | ------ | ------ | ------- | ---------- |
| Q-01 | AI-suggestion explainability | [#9](https://github.com/GRatajczak/intouch/issues/9) | [GRA-12](https://linear.app/gratajczak/issue/GRA-12) | S-02 | nie |
| Q-02 | Pola self-profile i formularza osoby | [#10](https://github.com/GRatajczak/intouch/issues/10) | [GRA-13](https://linear.app/gratajczak/issue/GRA-13) | S-01 | nie |
| Q-03 | Reminder cadence | [#11](https://github.com/GRatajczak/intouch/issues/11) | [GRA-14](https://linear.app/gratajczak/issue/GRA-14) | S-04 | **tak** |
| Q-04 | Reminder delivery channel | [#12](https://github.com/GRatajczak/intouch/issues/12) | [GRA-15](https://linear.app/gratajczak/issue/GRA-15) | S-04 | **tak** |

Numeracja GitHub zaczyna się od `#2`, bo `#1` zajął wcześniejszy PR `test: verify PR deploy is preview-only`.
Numeracja Linear zaczyna się od `GRA-5`, bo `GRA-1`…`GRA-4` to onboardingowe zadania Linear
("Get familiar with Linear", "Connect your tools", "Import your data", "Set up your teams") —
zostawione nietknięte, nie należą do roadmapy.

## Konwencje (GitHub)

### Tytuł

`[<ROADMAP-ID>] <Suggested issue title z sekcji Backlog Handoff>`

Prefiks ID jest po to, żeby lista issues dała się czytać w kolejności zależności bez otwierania
każdej pozycji, i żeby `roadmap.md` ↔ GitHub dały się skojarzyć w obie strony.

### Labelki (13 nowych; 9 domyślnych labelek repo nietknięte)

| Label | Kolor | Znaczenie |
| ----- | ----- | --------- |
| `roadmap` | `#5319e7` | pozycja pochodzi z `roadmap.md` (7 sztuk) |
| `type:foundation` | `#8b5cf6` | bounded enabler, F-* |
| `type:slice` | `#1d76db` | vertical slice, S-* |
| `stream:A` | `#0e8a16` | The loop — ścieżka must-have |
| `stream:B` | `#fbca04` | AI call path |
| `stream:C` | `#d4c5f9` | Data lifecycle & erasure |
| `stream:D` | `#c2e0c6` | Proactive reminders |
| `status:ready` | `#0e8a16` | można planować teraz |
| `status:proposed` | `#fbca04` | zsekwencjonowane, czeka na prerequisites |
| `status:blocked` | `#b60205` | zablokowane na nierozstrzygniętej decyzji |
| `north-star` | `#ffd700` | tylko S-03 |
| `plan-ready` | `#006b75` | gotowe pod `/10x-plan` (F-01, F-02) |
| `decision` | `#e99695` | Open Roadmap Question, nie praca do dostarczenia |

### Struktura body

Każde issue roadmapowe ma stałe sekcje odwzorowujące pola z `roadmap.md`:

```
> Roadmap item **<ID>** · Change ID `<change-id>` · Stream **<X — nazwa>**
> Źródło: <link do roadmap.md na main>

## Outcome          — dosłownie z roadmapy
## Prerequisites    — "Blocked by #N (ID) — nazwa"
## Unlocks          — "#N (ID), #M (ID)" + "Parallel with:"
## PRD refs         — FR/NFR/US
## Unknowns         — checkboxy z ownerem i flagą "Blokuje: tak/nie"
## Risk             — dosłownie z roadmapy
---
**Ready for `/10x-plan`:** ✅/❌ + komenda albo powód
```

Acceptance criteria z sekcji Risk (np. dwie osoby o równej wadze nie mogą być uszeregowane
identycznie — S-02) są zapisane jako checkboxy, żeby dało się je odhaczyć w trakcie pracy.

## Konwencje (Linear) — czym się różni od GitHuba

Tytuły i treść są **identyczne** w obu trackerach (poza referencjami — patrz niżej). Różnice
biorą się z tego, że Linear ma natywnie to, co na GitHubie trzeba było udawać tekstem.

| Aspekt | GitHub | Linear |
| ------ | ------ | ------ |
| Status | labelki `status:ready` / `status:proposed` / `status:blocked` | natywne statusy: **Todo** (ready), **Backlog** (proposed / blocked) |
| Zależności | tekst `Blocked by #N` w body | natywne relacje **blockedBy / blocks** |
| Pytania nieblokujące | tekst | relacja **relatedTo** |
| Grupowanie | milestone `MVP v1` | projekt `InTouch MVP v1` |
| Priorytet | brak | pole Priority |
| Referencje w opisie | `#N (ID)` | gołe ID roadmapy (`S-01`), bo `#N` w Linear czytałoby się jako inny numer |

**Labelki w Linear:** te same 10 co na GitHubie **minus `status:*`** (zastąpione statusami),
z identycznymi nazwami i kolorami — żeby słownik obu trackerów był ten sam.
3 domyślne labelki Linear zostały nietknięte.

**Priorytet** wynika z tego, co dana pozycja odblokowuje, nie z jej wielkości:

| Priority | Pozycje | Dlaczego |
| -------- | ------- | -------- |
| Urgent (1) | S-03 | north star |
| High (2) | F-01, F-02, S-01, S-02 | łańcuch must-have Stream A + jego enabler |
| Medium (3) | S-05, Q-01, Q-02 | równoległe / decyzje dotyczące Stream A |
| Low (4) | S-04, Q-03, Q-04 | zablokowany slice i decyzje, które tylko jego dotyczą |

**Graf zależności w Linear** (natywny, wyklikalny):

```
GRA-5  (F-01) ─┬─blocks→ GRA-7  (S-01) ─┬─blocks→ GRA-8 (S-02) ─blocks→ GRA-9 (S-03) ─┐
               │                        └─blocks→ GRA-11 (S-05)                        │
GRA-6  (F-02) ──────────blocks→ GRA-8 (S-02)                                           │
GRA-14 (Q-03) ─┐                                                                       │
GRA-15 (Q-04) ─┴──────────────────blocks→ GRA-10 (S-04) ←───────────────────────────────┘

relatedTo (nieblokujące): GRA-12 (Q-01) ↔ GRA-8 (S-02) · GRA-13 (Q-02) ↔ GRA-7 (S-01)
```

Q-01…Q-04 celowo **poza projektem** `InTouch MVP v1` — tak samo jak są poza milestone'em na
GitHubie. To decyzje, nie praca do dostarczenia; wliczone do projektu zafałszowałyby postęp MVP.

## Jak to zostało zrobione

### GitHub

Dwuprzebiegowo, bo numery issues nie są znane przed utworzeniem, a `#2` musi odsyłać w przód
do `#4`, `#5` i `#8`:

1. **Pass 1** — `gh issue create` w kolejności topologicznej (F-01 → F-02 → S-01…S-05 → Q-01…Q-04),
   body z placeholderami `{{S-01}}`; numery zapisane do mapy `id → number`.
2. **Pass 2** — podstawienie `{{ID}}` → `#N (ID)` z mapy, guard na pozostałe `{{`,
   `gh issue edit --body-file`.

### Linear (MCP)

Też dwuprzebiegowo, ale z innego powodu — identyfikatory `GRA-N` są potrzebne do relacji:

1. `save_project` → `InTouch MVP v1`, potem 10× `create_issue_label`.
2. **Pass 1** — 11× `save_issue` (projekt, status, priority, labelki, link-attachment do GitHuba).
   Opisy nie miały placeholderów, bo referują do ID roadmapy, nie do numerów trackera.
3. **Pass 2** — 5× `save_issue` z `blockedBy` / `relatedTo` na zwróconych `GRA-N`.

Oba schematy zadziałają przy dodawaniu kolejnych pozycji do roadmapy.

## Znane ograniczenia

**Trzy miejsca, jedna prawda.** Roadmapa żyje teraz w `roadmap.md`, na GitHubie i w Linear.
Bez reguły rozjedzie się w ciągu tygodnia. Reguła przyjęta przy migracji:

- **`roadmap.md` jest źródłem prawdy dla treści** — Outcome, Risk, Unknowns, PRD refs, sekwencjonowanie.
- **Linear jest źródłem prawdy dla bieżącego statusu i kolejności pracy** — ma natywne statusy,
  relacje blokujące i priorytety, więc to tam widać realnie, co jest odblokowane.
- **GitHub Issues są lustrem** — pod linkowanie commitów i PR-ów (`Fixes #4`), nie pod planowanie.
- Przy zamykaniu pozycji: Linear → Done, GitHub → closed, `roadmap.md` → sekcja `## Done`
  (pisze tylko `/10x-archive`).

Jeśli utrzymywanie dwóch trackerów okaże się kosztem bez zwrotu, **usuń GitHub Issues, nie Linear** —
tam jest graf zależności, którego GitHub nie odwzorował.

**`Blocked by #N` na GitHubie to zwykły tekst, nie natywna relacja.** Nie użyto issue dependencies
ani sub-issues, więc GitHub nie wymusi kolejności i nie narysuje grafu. W Linear te same zależności
są natywnymi relacjami `blockedBy` — to główny powód, dla którego Linear dostał rolę primary dla statusu.

**Link jest jednokierunkowy.** Zadania w Linear mają link-attachment do GitHuba; issues na GitHubie
nie wiedzą o Linear. Dwukierunkowe wiązanie dałaby oficjalna integracja Linear ↔ GitHub
(Settings → Integrations), która przy okazji synchronizuje statusy przez magic words w PR-ach.
Nie została włączona — to operacja w UI, nie przez MCP.

**Ten plik trzeba odświeżyć**, jeśli roadmapa dostanie nowe pozycje albo pozycje zmienią Change ID.
Numery issues (`#N`, `GRA-N`) są stałe i się nie przenumerują.

## Odtworzenie / weryfikacja

### GitHub

```bash
# lista wszystkich pozycji roadmapy z labelkami i milestone'em
gh issue list --label roadmap --limit 20 \
  --json number,title,labels,milestone \
  --template '{{range .}}#{{.number}}  {{.title}}
        {{range .labels}}{{.name}} {{end}}| {{if .milestone}}{{.milestone.title}}{{else}}—{{end}}
{{end}}'

# co można planować teraz
gh issue list --label "status:ready"

# co blokuje S-04
gh issue list --label decision --label "status:blocked"
```

### Linear (MCP)

- wszystkie pozycje roadmapy → `list_issues` z `project: "InTouch MVP v1"`
- co można planować teraz → `list_issues` z `state: "Todo"` (dziś: F-01, F-02)
- czym zablokowana jest pozycja → `get_issue` z `includeRelations: true`
- decyzje do rozstrzygnięcia → `list_issues` z `label: "decision"`
