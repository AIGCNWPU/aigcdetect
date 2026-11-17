#!/bin/bash
# 模型缓存预热：把 2.1/2.3 推理要用的权重与 torch 共享库读入页缓存。
# 背景：正式服务器 conda/weights 位于 vos 网络盘（实测 ~14MB/s），冷缓存时
# torch 导入 52s + 3.2GB DDA 权重 3m49s，远超旧 300s 超时；预热后命中页缓存
# （服务器 188GB 内存，可用 ~87GB，驻留 ~10GB 无压力），冷启动回到秒级。
# 手动执行：bash runtime/tools/bin/warm-model-cache.sh [once|status]
set -u
ROOT="${AIGC_PLATFORM_ROOT:-/mnt/vos-6d37s2q0/users/ljw/projects/aigc_platform}"
WARM_LOG="$ROOT/runtime/logs/model-warm.log"
mkdir -p "$(dirname "$WARM_LOG")"

TARGETS=(
  "$ROOT/weights/dda_hplus"
  "$ROOT/weights/trufor"
  "$ROOT/weights/vlaforge"
  "$ROOT/weights/rpa"
  "$ROOT/weights/mirror"
  "$ROOT/weights/seed"
  "$ROOT/weights/ocr"
)

# torch 等大体积共享库：两个真实环境（forensics 是 venv，落在 mirror-runtime）
for env in aigc-mirror-runtime aigc-forensics-runtime; do
  base="/mnt/vos-6d37s2q0/users/ljw/conda/envs/$env/lib"
  [ -d "$base" ] && find "$base" -maxdepth 3 -type f \( -name "*.so" -o -name "*.pth" \) -size +1M -print 2>/dev/null
done | head -400 > /tmp/warm-libs.txt

warm() {
  local started=$SECONDS bytes=0
  {
    echo "=== $(date '+%F %T') warm start ==="
    for dir in "${TARGETS[@]}"; do
      [ -d "$dir" ] || continue
      while IFS= read -r -d '' f; do
        cat -- "$f" > /dev/null 2>/dev/null && bytes=$((bytes + $(stat -c%s -- "$f" 2>/dev/null || echo 0)))
      done < <(find "$dir" -type f -size +512k -print0 2>/dev/null)
    done
    while IFS= read -r f; do
      [ -f "$f" ] || continue
      cat -- "$f" > /dev/null 2>/dev/null && bytes=$((bytes + $(stat -c%s -- "$f" 2>/dev/null || echo 0)))
    done < /tmp/warm-libs.txt
    echo "warmed $((bytes / 1024 / 1024)) MB in $((SECONDS - started))s"
  } >> "$WARM_LOG" 2>&1
}

case "${1:-}" in
  status) tail -5 "$WARM_LOG" 2>/dev/null || echo "尚无预热记录";;
  *) warm;;
esac
