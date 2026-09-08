#!/usr/bin/env bash
# PostToolUse(Write|Edit): TypeScript typecheck after the agent touches a .ts file.
#
# Two typecheckers exist in this project and they are deliberately split across
# layers (measured 2026-09-08, 168 files):
#
#   tsc --noEmit   ~3.4s   .ts/.tsx only        -> here, per-edit
#   astro check   ~11.8s   .ts/.tsx + .astro    -> .husky/pre-commit
#
# tsc has no notion of .astro syntax, so a template-only type error is invisible
# here and is caught by the pre-commit `astro check`. That is the trade the lesson
# asks for: a ~12s gate on every single edit would stall the agent loop three times
# a turn, so the slower, broader checker moves one layer up.
#
# The check is project-wide, not file-scoped -- tsc has no cheap single-file mode
# under `paths`, and a type error usually lands in the *consumer* of the edited
# file anyway. The baseline is 0 errors, so anything reported belongs to this edit.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source .claude/hooks/lib.sh

FILE=$(hook_file_path)
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.ts | *.tsx | *.mts) ;;
  *) exit 0 ;;
esac

OUTPUT=$(npx tsc --noEmit --pretty false 2>&1) || {
  hook_block "tsc --noEmit failed after editing ${FILE}:

${OUTPUT}

The error may sit in a consumer of that file rather than in the file itself.
.astro templates are not covered here -- pre-commit runs \`astro check\` for those."
}
exit 0
