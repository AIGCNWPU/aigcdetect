#!/usr/bin/env bash
# Local, pinned compatibility runtime. Does not install or replace system libraries.
set -euo pipefail
: "${AIGC_PLATFORM_ROOT:?Source runtime/activate.sh first}"
aigc_c2pa_dir="$AIGC_PLATFORM_ROOT/runtime/tools/c2pa-cli"
mkdir -p "$aigc_c2pa_dir/glibc"
if [ ! -f "$aigc_c2pa_dir/release.tar.gz" ]; then
 curl -fL https://github.com/contentauth/c2patool/releases/download/v0.28.2/v0.28.2-x86_64-unknown-linux-gnu.tar.gz -o "$aigc_c2pa_dir/release.tar.gz"
fi
if [ ! -f "$aigc_c2pa_dir/glibc/libc.deb" ]; then
 curl -fL https://archive.ubuntu.com/ubuntu/pool/main/g/glibc/libc6_2.39-0ubuntu8.9_amd64.deb -o "$aigc_c2pa_dir/glibc/libc.deb"
fi
(cd "$aigc_c2pa_dir" && sha256sum -c <<'SUMS'
ff9f05d0f985a77995ec18956671f331d619c804e033c9929972a8d4f479e93a  release.tar.gz
ff5557d99b51f761c4b7c92368b9cc45565eda17df9bf9eb4b134d09825008be  glibc/libc.deb
SUMS
)
tar -xzf "$aigc_c2pa_dir/release.tar.gz" -C "$aigc_c2pa_dir" c2patool/c2patool c2patool/README.md c2patool/sample/C.jpg
dpkg-deb -x "$aigc_c2pa_dir/glibc/libc.deb" "$aigc_c2pa_dir/glibc"
cat > "$aigc_c2pa_dir/offline.json" <<'JSON'
{"verify":{"verify_after_reading":true,"verify_trust":true,"remote_manifest_fetch":false,"ocsp_fetch":false}}
JSON
"$aigc_c2pa_dir/glibc/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" --library-path "$aigc_c2pa_dir/glibc/usr/lib/x86_64-linux-gnu" "$aigc_c2pa_dir/c2patool/c2patool" --version
