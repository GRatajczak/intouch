#!/usr/bin/env bash
# PostToolUse(Write|Edit): scoped tests, but only for the top risk area.
#
# test-plan.md §2 Risk #1 -- "a signed-in user reads or mutates another user's
# people, rankings or contact events through a normal API path" -- is the highest
# risk on the map and the one Phase 1 already has real tests for. Those tests are
# the only ones worth paying for on every edit, so this hook fires on that risk
# area and stays silent everywhere else. Editing a helper, a style, or a config
# runs nothing.
#
# `related` is a subcommand, not a flag, and --run keeps it out of watch mode --
# a watching hook never returns and hangs the agent.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source .claude/hooks/lib.sh

FILE=$(hook_file_path)
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

# Path is absolute in the payload; vitest's related graph wants it repo-relative.
FILE=${FILE#"$PWD"/}

# The Risk #1 surface: the API routes themselves, the auth pages in front of them,
# the middleware that gates every request, and the two modules every owner-scoped
# query goes through.
case "$FILE" in
  src/pages/api/* | src/pages/auth/* | src/middleware.ts | src/db/* | src/lib/supabase.ts) ;;
  *) exit 0 ;;
esac

# tests/rls/ is excluded on purpose: it is the one suite with an external
# prerequisite (`supabase start`), and it fails hard rather than skipping when the
# stack is down. Running it per-edit would produce a red hook on a developer
# machine with no local Postgres -- a false alarm, which is exactly what makes
# people switch hooks off. tests/http/ needs no exclusion: it self-skips on an
# unset TEST_BASE_URL. Both still run in full via `npm test`.
#
# AI_AGENT=1 asks Vitest for its compact, agent-oriented output. Measured on
# vitest 5.0.0 it changes nothing (56 lines either way on a failing run) -- kept
# because it is free and forward-compatible, not because it is doing work today.
OUTPUT=$(AI_AGENT=1 npx vitest related "$FILE" --run --exclude 'tests/rls/**' 2>&1) || {
  hook_block "Tests related to ${FILE} failed:

${OUTPUT}

This file is in test-plan.md Risk #1 (cross-user access boundary). If the
assertion is right and the code is wrong, fix the code -- do not relax the test.
Not run here: tests/rls (needs \`supabase start\`) and tests/http (needs
TEST_BASE_URL). Run \`npm test\` with those up before calling the boundary proven."
}
exit 0
