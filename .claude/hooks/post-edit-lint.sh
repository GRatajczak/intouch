#!/usr/bin/env bash
# PostToolUse(Write|Edit): ESLint on the file the agent just touched.
#
# The cheapest gate in test-plan.md §5 ("lint + typecheck", required), run at the
# only layer that can hand feedback back mid-session. --fix means the agent rarely
# has to act on it at all: formatting and auto-fixable rules are gone before the
# hook returns, and only what ESLint cannot fix reaches the context.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source .claude/hooks/lib.sh

FILE=$(hook_file_path)
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

# eslint.config.js covers these; anything else (md, json, sql, .env) is prettier's
# job at pre-commit, not a per-edit blocker.
case "$FILE" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.astro) ;;
  *) exit 0 ;;
esac

# --cache halves the run (~6s -> ~3s); the cache lives under node_modules, so it is
# already gitignored and dies with a reinstall.
OUTPUT=$(npx eslint --cache --cache-location node_modules/.cache/eslint/ --fix "$FILE" 2>&1) || {
  hook_block "ESLint failed on ${FILE}:

${OUTPUT}

Fix the reported rules. Formatting and auto-fixable rules were already applied."
}
exit 0
