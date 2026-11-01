# 售后视频测试素材

`aftersales.mp4` 与 `aftersales.webm` 是本地生成的 3 秒、640 × 360、12 fps 无声测试图案。仅用于解码、播放、定位和资源生命周期验收，不是用户凭证或检测结果。文件合计约 230 KiB。

使用 FFmpeg 7.1 生成，不要求产品安装 FFmpeg；生成工具安装在被忽略的 `tmp/video-tools`，不进入产品依赖。

```powershell
ffmpeg -f lavfi -i 'testsrc2=size=640x360:rate=12:duration=3' -c:v libx264 -pix_fmt yuv420p -movflags +faststart tests/fixtures/aftersales.mp4
ffmpeg -f lavfi -i 'testsrc2=size=640x360:rate=12:duration=3' -c:v libvpx-vp9 -b:v 160k tests/fixtures/aftersales.webm
```
