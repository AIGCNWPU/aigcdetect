#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
  general) export VIDEO_MODULE=general VIDEO_MCP_PORT=18610 ;;
  deepfake) export VIDEO_MODULE=deepfake VIDEO_MCP_PORT=18611 ;;
  *) echo 'Usage: run.sh general|deepfake' >&2; exit 2 ;;
esac
export VIDEO_PUBLIC_HOSTS="$(.venv/bin/python -c 'import json,os,urllib.parse;d=json.load(open("bailian-"+os.environ["VIDEO_MODULE"]+".json"));print(urllib.parse.urlsplit(next(iter(d["mcpServers"].values()))["url"]).hostname)')"
exec .venv/bin/python server.py
