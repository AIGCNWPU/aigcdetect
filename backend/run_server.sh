#!/bin/bash
# 音频鉴伪服务管理：./run_server.sh start|stop|status|log
BASE=/mnt/vos-6d37s2q0/users/zqy
PYBIN=$BASE/conda/envs/holi/bin/python
PROJ=$BASE/projects/audio-antispoof
PIDFILE=$PROJ/server.pid
PORT=${PORT:-8000}

cd "$PROJ" || exit 1

case "$1" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running: $(cat "$PIDFILE")"; exit 0
    fi
    CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0} TOKENIZERS_PARALLELISM=false \
      nohup "$PYBIN" -m uvicorn server:app --host 0.0.0.0 --port "$PORT" > server.log 2>&1 &
    echo $! > "$PIDFILE"
    echo "started pid $(cat "$PIDFILE") on :$PORT (gpu ${CUDA_VISIBLE_DEVICES:-0})"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; fi
    pkill -f "uvicorn server:app" 2>/dev/null
    echo stopped
    ;;
  status)
    curl -s -m 5 "http://127.0.0.1:$PORT/api/v1/health" || echo "down"
    echo
    ;;
  log)
    tail -f "$PROJ/server.log"
    ;;
  *)
    echo "usage: $0 start|stop|status|log"; exit 1
    ;;
esac
