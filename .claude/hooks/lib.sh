# Shared helpers for the per-edit hooks.
#
# Every hook reads the same PostToolUse payload on stdin and cares about the same
# field, so the parsing lives here once. Sourced, never executed.

# Reads the whole stdin payload once and prints the edited file's path, relative
# to the project root. Empty when the tool use carried no file path.
hook_file_path() {
  jq -r '.tool_input.file_path // empty' 2>/dev/null
}

# Exit 2 is the only code Claude Code treats as blocking: stderr is fed back into
# the agent's context, which is what lets it fix the problem on the next turn.
# Any other non-zero code is logged and ignored, so failures must route here.
hook_block() {
  printf '%s\n' "$*" >&2
  exit 2
}
