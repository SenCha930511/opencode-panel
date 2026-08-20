#!/usr/bin/env bash
# scripts/uninstall.sh — install policy & undo log for opencode-panel.
# Policy: isolated/virtual-env installs ONLY (node_modules, npx, .tools/, venv);
set -euo pipefail
# global installs (npm i -g / brew / apt ...) are allowed ONLY when genuinely
# unavoidable, and every such install MUST be logged in this file the same step
# it runs, with a removal command verified to target only what was installed.
#
# Pinned appended format (each entry is a COMMENTED block — appended entries are
# never live top-level commands and never execute on their own):
#
#   # installed: <exact install command> @ <ISO-8601 date>
#   # removal: <exact removal command>
#   # end
#
# A block may hold several `# removal:` lines; they replay in written order.
# Running `bash scripts/uninstall.sh` invokes undo_last(), which parses this
# file and executes the removal payload of the NEWEST `# end`-terminated block.
# Later todos that install anything globally MUST append their block below the
# existing ones (append-only; never edit or delete past entries).

undo_last() {
  local file="${BASH_SOURCE[0]:-$0}"
  local removals
  removals=$(awk '
    /^# installed:[[:space:]]/ { pending = "" }
    /^# removal:[[:space:]]/ {
      line = $0
      sub(/^# removal:[[:space:]]*/, "", line)
      pending = pending line "\n"
    }
    /^# end[[:space:]]*$/ { newest = pending }
    END { printf "%s", newest }
  ' "$file")

  if [ -z "$removals" ]; then
    echo "undo_last: no install blocks logged in $file; nothing to undo."
    return 0
  fi

  echo "undo_last: replaying newest removal block from $file"
  printf '%s\n' "$removals" | while IFS= read -r removal; do
    [ -n "$removal" ] || continue
    echo "+ $removal"
    bash -c "$removal"
  done
}

case "${1:-undo}" in
  undo) undo_last ;;
  *) echo "usage: $0 [undo]" >&2; exit 2 ;;
esac

# --- append-only install log (newest entry last; comments only) ---

# installed: self-test @ creation
# removal: true
# end

# installed: npm i -D @vscode/test-electron mocha @types/mocha @ 2026-08-20
# removal: npm rm -D @vscode/test-electron mocha @types/mocha
# end
