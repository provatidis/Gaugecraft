#!/bin/zsh
set -eu
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  gaugecraft_node="$(command -v node)"
else
  gaugecraft_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$gaugecraft_node" || ! -d node_modules/tsx ]]; then
  print 'Install Node.js 24+ and run pnpm install in this folder first.'
  exit 1
fi
exec "$gaugecraft_node" --env-file-if-exists=.env --import tsx server/index.ts
