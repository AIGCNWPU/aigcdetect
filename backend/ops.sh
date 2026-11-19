#!/bin/bash
# 音频鉴伪服务 · 一键运维脚本
#
#   ./ops.sh status          查看服务与磁盘状态
#   ./ops.sh start           磁盘可用时启动服务（否则报错退出）
#   ./ops.sh start --wait 30 磁盘慢时最多等 30 分钟，恢复即启动
#   ./ops.sh verify          跑四条样例自检并比对期望分数
#   ./ops.sh all             启动 + 等就绪 + 自检
#   ./ops.sh watch           后台守护：等磁盘恢复后自动启动并自检（nohup 用）
#   ./ops.sh stop            停止服务
#
set -u

BASE=${BASE:-/mnt/vos-6d37s2q0/users/zqy}
PROJ="$BASE/projects/audio-antispoof"
SHARD="$BASE/models/Qwen2.5-Omni-7B/model-00005-of-00005.safetensors"
HEALTH="http://127.0.0.1:8000/api/v1/health"
API="http://127.0.0.1:8000/api/v1/audio/forgery"
IO_MIN_MBPS=${IO_MIN_MBPS:-20}
cd "$PROJ" || { echo "找不到项目目录 $PROJ"; exit 1; }

log() { echo "[$(date '+%F %T')] $*"; }

# 磁盘读速（32 MB 采样，超时 20 秒）
disk_mbps() {
  local t0 t1
  t0=$(date +%s%N)
  timeout 20 dd if="$SHARD" of=/dev/null bs=1M count=32 2>/dev/null
  t1=$(date +%s%N)
  echo $(( 32 * 1000000000 / (t1 - t0) / 1024 / 1024 ))
}

health_ok() {
  curl -s -m 3 "$HEALTH" 2>/dev/null | grep -q '"modelLoaded":true'
}

cmd_status() {
  echo "== 服务 =="
  if health_ok; then
    curl -s -m 3 "$HEALTH"; echo
  else
    echo "未运行（端口 $(ss -ltn 2>/dev/null | grep -q ':8000' && echo 占用 || echo 空闲)）"
  fi
  echo "== 磁盘 =="
  log "模型分片读速约 $(disk_mbps) MB/s（阈值 ${IO_MIN_MBPS} MB/s）"
  echo "== 负载 =="
  cut -d' ' -f1-3 /proc/loadavg
  echo "== GPU =="
  nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader 2>/dev/null | head -4
}

cmd_start() {
  local wait_min=${1:-0}
  if health_ok; then log "服务已在运行"; return 0; fi

  local waited=0
  while :; do
    local mbps
    mbps=$(disk_mbps)
    if [ "$mbps" -ge "$IO_MIN_MBPS" ]; then
      log "磁盘 ${mbps} MB/s，开始启动"
      break
    fi
    log "磁盘仅 ${mbps} MB/s，低于阈值 ${IO_MIN_MBPS}；已等 ${waited} 分钟"
    if [ "$waited" -ge "$wait_min" ]; then
      log "达到等待上限，放弃启动（可加大 --wait，或用 ./ops.sh watch 后台等）"
      return 1
    fi
    sleep 60
    waited=$((waited + 1))
  done

  CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0} ./run_server.sh start

  local pid rss
  for _ in $(seq 1 60); do
    sleep 10
    if health_ok; then log "服务就绪"; return 0; fi
    pid=$(cat server.pid 2>/dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      log "进程已退出，启动失败（见 server.log）"; tail -5 server.log; return 1
    fi
    rss=$(awk '/VmRSS/{print int($2/1024)}' "/proc/$pid/status" 2>/dev/null)
    log "加载中… RSS ${rss:-0} MB"
  done
  log "等待超时（10 分钟）"
  return 1
}

cmd_verify() {
  if ! health_ok; then log "服务未就绪，先执行 ./ops.sh start"; return 1; fi
  echo "样例        pFake    判定     耗时      期望"
  local fail=0
  while read -r sid expect; do
    local out
    out=$(curl -s -m 180 -X POST "$API" -H 'Content-Type: application/json' \
          -d "{\"sampleId\":\"$sid\"}")
    echo "$out" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data',{})
p=d.get('pFake'); v=d.get('verdict'); ms=d.get('latencyMs')
print(f\"{d.get('fileName','?'):10s}  {p:<8} {v:<8} {str(ms)+'ms':<9} $expect\")
ok = p is not None and abs(float(p)-float('$expect')) <= 0.05
sys.exit(0 if ok else 1)
" || fail=$((fail + 1))
  done <<'EOF'
wav1 0.999
wav2 0.001
wav3 1.000
wav4 0.000
EOF
  if [ "$fail" -eq 0 ]; then log "自检通过：4/4 与迁移前一致"; else log "自检有 $fail 条偏差超过 0.05"; fi
  return "$fail"
}

cmd_watch() {
  local hours=${WATCH_HOURS:-12}
  local rounds=$((hours * 30))
  log "守护启动：每 2 分钟探测一次磁盘（最多 ${hours} 小时），恢复即拉起服务并自检"
  for _ in $(seq 1 "$rounds"); do
    if health_ok; then log "服务已在运行"; return 0; fi
    if [ "$(disk_mbps)" -ge "$IO_MIN_MBPS" ]; then
      if cmd_start 0; then cmd_verify; return 0; fi
    fi
    sleep 120
  done
  log "${hours} 小时后仍未恢复，退出"
  return 1
}

action=${1:-status}
shift 2>/dev/null || true

case "$action" in
  status) cmd_status ;;
  start)
    wait=0
    [ "${1:-}" = "--wait" ] && wait=${2:-0}
    cmd_start "$wait"
    ;;
  stop) ./run_server.sh stop ;;
  verify) cmd_verify ;;
  all) cmd_start 0 && cmd_verify ;;
  watch) cmd_watch ;;
  *) echo "用法: $0 {status|start [--wait N]|stop|verify|all|watch}"; exit 1 ;;
esac
