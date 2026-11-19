#!/usr/bin/env bash
# 停止 ./deploy/start-all.sh 拉起的进程（按 pid 文件，先 TERM 再 KILL）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-$ROOT/run}"

stop_one() {
  local name="$1" pidfile="$RUN_DIR/$name.pid"
  [[ -f "$pidfile" ]] || { echo "$name: 无 pid 文件，跳过"; return 0; }
  local pid
  pid="$(cat "$pidfile")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name: 进程 $pid 已不存在"
    rm -f "$pidfile"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name: 未响应 TERM，强杀 $pid"
    kill -9 "$pid" 2>/dev/null || true
  fi
  echo "$name: 已停止（$pid）"
  rm -f "$pidfile"
}

stop_one web
stop_one audio
