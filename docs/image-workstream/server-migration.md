# 迁移到校园内网服务器

目标：`wangruohan@10.69.50.194`，SSH 端口 `29316`。所有项目文件、权重、数据、重建环境和缓存均放在 `/sdb/data_public/lvjiawen/aigc_platform`。本文与脚本于 2026-10-22 准备；脚本未自动登录目标或执行传输，实际传输后须完成校验。

入口：[源端迁移脚本](../../scripts/migration/migrate.py)、[目标端配置脚本](../../scripts/migration/target.py)。仅使用 Python 标准库、SSH、rsync，不需要打压缩包、不依赖迁移前 commit。

## 迁移范围与目录

本机盘点有效载荷约 **27.89 GiB**，不含随后重建的 Python 环境。目标建议至少留出 **80 GiB**，具体视五个独立环境安装量而定；脚本传输前检查剩余有效载荷加 2 GiB 缓冲，环境安装空间另算。

```text
/sdb/data_public/lvjiawen/aigc_platform/
├── project/                       # 原仓库完整工作区
│   ├── .git/                      # 分支、历史、索引、refs、远端配置
│   ├── .agents/skills/            # 仓库原有 6 个 OpenSpec 技能
│   ├── .env.image-documents.local # 本地密钥，单独传送，权限 0600
│   ├── openspec/                 # 两个工作包、公共规范、需求参考
│   ├── docs/ scripts/ src/ tests/ # 包括所有未提交、未跟踪代码
│   └── tmp/image-workspace/       # PDF/中文材料、CrossCred、FCTM、实验和评审页
├── weights/
│   ├── mirror/                   # Phase1、Phase2、导出的 backbone
│   ├── docshield-9b/             # 完整分片、配置、processor/tokenizer
│   ├── ocr/                      # PP-OCRv6 medium det / rec
│   └── seed/                     # 完整 SEED safetensors 与配置
├── third_party/{mirror,seed}/    # 原始源码及各自 .git
├── datasets/documents/
│   ├── RealText-V1-research/      # 原始下载的图片、元数据
│   ├── CORD-v2-research/          # 官方 test parquet
│   ├── CrossCred -> ../../project/tmp/image-workspace/.../crosscred
│   ├── FCTM-samples -> ../../project/tmp/image-workspace/.../fctm-samples
│   ├── chinese-validation-v1 -> ../../project/tmp/image-workspace/chinese-validation-v1
│   └── pdf-evaluation -> ../../project/tmp/image-workspace/evaluation-20261021
├── skills/
│   ├── user/                     # ~/.agents/skills 全量，当前 12 个 OpenSpec 技能
│   ├── codex/                    # ~/.codex/skills，包括 .system
│   └── plugins/                  # 已安装插件技能文件，保留插件名和版本
├── planning/                     # 用户原始技术方案 RAR，直接复制，不重新压缩
├── metadata/seed/                # 权重来源与校验信息
├── migration/                    # 本次盘点、Git 状态、路径映射、依赖版本
├── runtime/
│   ├── activate.sh               # 统一路径与项目内缓存配置
│   ├── envs/                     # 在这里重建五个 Python 环境
│   ├── wheelhouse/               # 现有完整 wheel，非完整离线依赖库
│   ├── replay/                   # 路径迁移后的新清单/资产账本
│   ├── cache/                    # HF、pip、Paddle 等缓存
│   └── tmp/
└── compat/baselines/             # 全部指向本目标目录内部的相对符号链接
```

迁移的是文件系统工作区，而非 Git clone/archive，所以未 commit 的实现、未跟踪文件、被 Git 忽略的研究结果都保留。源端不执行 commit、push、merge、reset，也不删除源文件。

不迁移 2.1 原始大数据集 `GenImage_eval_all8`、`Chameleon`、`realchain` 等；现有 2.1 小样本报告仍随工作区保留。未用到的其他科研 baseline 和原始 DINO H+ 文件不属于本平台的运行依赖；MIRROR 已实际使用的 Phase2 与 `backbone-from-phase2` 均包含。未取得的 DocTamper 不会被列作已迁移。

忽略 `node_modules`、Python 字节码、下载缓存、下载器分段、`*.part` 和迁移脚本自己的暂存目录，避免不完整下载和递归复制。保留原有 `dist`、OpenSpec、Git 元数据、日志及完整实验记录。

## 源服务器操作

运行前停止**本项目**写入中的实验、下载和编辑，避免 Git 索引或模型输出在传输期间变化。不要停止其他用户任务。两端需要 rsync；目标需要 Python 3.10 或以上用于迁移工具（推理环境另要求 3.10）、SSH 访问权限。目标目录初次须不存在或为空；脚本拒绝覆盖不属于本次迁移的非空目录。

```bash
cd /home/lvjiawen/project/aigc-detection-platform

# 只盘点路径、数量、大小，不连接目标，不读取/打印密钥内容
python3 scripts/migration/migrate.py plan

# 导出五个环境依赖快照、Git HEAD/分支/工作区状态、路径映射，不连接目标
python3 scripts/migration/migrate.py prepare

# 实际传输：会重新盘点与导出环境，SSH 认证由终端处理
python3 scripts/migration/migrate.py transfer

# 传后逐项比较文件内容，包含 .git、未提交代码、权重、数据、密钥文件
python3 scripts/migration/migrate.py verify
```

目标地址与端口已写为脚本默认值。可加 `--identity /本机/SSH私钥路径` 指定 SSH 私钥；私钥本身不复制，也不要在参数、聊天、脚本中填写登录密码。SSH 首次连接保留主机指纹确认。每次 `transfer` / `verify` / `dry-run` 命令先建立独立 SSH 主连接，各组 rsync 共用该连接，正常情况下每条命令只认证一次；也支持 SSH agent/key 认证。控制套接字在源端短路径 `/tmp/aigc-ssh-*` 的 0700 临时目录内，退出时关闭本次主连接并清理，不保存密码、不关闭其他终端的连接。连接每 15 秒保活，连续 3 次没有响应时退出；保活不能保证服务器不主动断开。主连接丢失后子命令禁止再次弹出密码提示，错误退出后由用户重跑。

`--bwlimit 51200` 将 rsync 限速约 50 MiB/s。中断后直接重跑同一个 `transfer` 命令，利用 `.rsync-partial` 续传。使用目标 `.migration-owner.json` 校验目录归属；不使用 `--delete`，不会删除目标多余文件。**同名文件会按源端更新**，因此完成交接后不要在两端同时开发再反向覆盖。只读检查使用 `verify`。

`dry-run` 提供 rsync 差异预览，需要先 `prepare`，且远端父目录已存在；初次空服务器优先使用完全离线的 `plan`，不要把远端目录不存在导致的 dry-run 错误当成传输失败。

默认包含 `.env.image-documents.local`，因为这是用户要求的私有服务器完整迁移。它通过 SSH 加密传输，单独以 0600 权限写入。目标根目录固定 0700；虽然上级名字有 `data_public`，其他普通账号不能穿过本项目目录读取密钥。不会迁移 `~/.ssh`、Codex 登录状态、云凭据或整个用户主目录。若这次暂不传密钥，**所有命令一致加 `--without-secrets`**，随后在目标自行创建 0600 文件。管理员或同一 `wangruohan` 账号下的进程仍具有该账号的访问权限。

`verify` 使用 rsync checksum 内容比较，不仅检查文件大小；所有映射组检查完毕后汇总缺失或内容差异并非零退出；SSH/rsync 本身失败则立即退出，尚未检查的组不能视作通过。它检查所有源文件是否匹配，不删除或报告无关的目标新增文件。首次传输后自动运行目标 `init`，只生成项目内缓存目录、路径配置、数据别名及兼容链接，不安装依赖、不加载模型、不调用 API。

迁移工具已通过 10 项本地回归测试，包括真实本地 rsync 的 Git/未跟踪文件保留、密钥 0600、损坏检测、保留目标新增文件，以及路径边界、符号链接、重复初始化、共享 SSH 会话清理、认证失败阻止传输、全部差异汇总和无 traceback 的断线提示。SSH 会话测试使用模拟调用，不会读取真实密钥或连接服务器。可复跑 `python3 -m unittest discover -s scripts/migration -p 'test_*.py' -v`。这不等于目标 SSH 或模型运行已验收。

## 断线与缺失文件的处理

2026-10-22 用户反馈：旧脚本在 `weights/mirror` 传输时收到 SSH 连接关闭（退出码 255）；随后校验的 `project` 未报告差异，而 MIRROR 的 `checkpoint-h-cur.pth`、`mirror_phase1.pth` 和 `backbone-from-phase2` 文件仍缺失。旧校验在第一组差异处退出，所以不能据此认定后续权重、数据和 skills 已完成迁移。

rsync 校验输出 `<f+++++++++` 表示目标缺少该文件，`cd+++++++++` 表示目标缺少该目录；`verify` 是只读检查，不会补传。不要删除目标目录或已传文件。在源端使用下面的连续命令，只有传输成功才进入校验：

```bash
cd /home/lvjiawen/project/aigc-detection-platform
python3 scripts/migration/migrate.py transfer && python3 scripts/migration/migrate.py verify
```

重跑会检查全部映射组，跳过大小与修改时间均未变化的已传文件，并利用 `.rsync-partial` 补传中断项。最终 `verify` 再以 checksum 检测内容。若校验发现内容不同但大小和修改时间碰巧一致，普通传输可能跳过；这时对具体差异排查后使用 rsync 的 checksum 传输，不能把反复出现的校验差异忽略掉。

“connection is not using a post-quantum key exchange algorithm” 是 [OpenSSH 的算法警告](https://www.openssh.org/pq.html)，单凭该提示不能确定断线原因，不通过关闭警告来修复连接。SSH 的 [ControlMaster / ServerAliveInterval](https://man.openbsd.org/ssh_config) 分别用于连接复用与保活。若修复后的脚本仍在认证时被关闭，可在源端单独诊断：

```bash
ssh -vv -p 29316 -o ConnectTimeout=15 wangruohan@10.69.50.194 true
```

若该命令也断开，需要目标服务器管理员依据时间点查看 SSH 认证/会话日志、账号策略和连接限制；rsync 尚未开始时无法靠续传选项解决。不在聊天或脚本中填写密码，不上传认证配置；分享调试日志前先检查其中的用户名和本地路径。

## 目标服务器：环境恢复

旧机器的 MIRROR/DocShield 是 Conda 环境；OCR 等使用 venv；SEED 又通过 `.pth` 引用旧 MIRROR 路径。因此**不把复制来的 bin/python 当作可运行环境**。迁移包含完整 Python 包版本快照和已有 wheel；目标使用独立 venv 重建，SEED 使用自己的全部依赖并固定 transformers 4.56.1，不再依赖旧机器 `.pth`。

准备 Linux x86_64、Python **3.10**（含 venv）、Node.js **22**（至少 20）、Git、rsync、适配 CUDA 12.4 的 NVIDIA 驱动。系统解释器、GPU 驱动、Node/SSH 为服务器基础设施，不复制旧机器系统文件。用户自行安装 OpenSpec；项目固定兼容版本见下节。

```bash
ssh -p 29316 wangruohan@10.69.50.194
cd /sdb/data_public/lvjiawen/aigc_platform
source runtime/activate.sh
cd project

# 先验收 Git：这些命令不改写分支或提交
git status --short
git branch --show-current
git rev-parse HEAD
git fsck --full
# 与 ../migration/inventory.json 中 branch/head/status/refs 对照

# 环境逐个恢复，Python 如安装在自选目录可增加 --python /路径/bin/python3.10
for env_name in image-download mirror-runtime docshield-runtime ocr-runtime seed-runtime; do
  python3 scripts/migration/target.py bootstrap \
    --root "$AIGC_PLATFORM_ROOT" --env "$env_name" || break
done
```

Git 的项目配置会保留，但原用户的 `~/.gitconfig`、SSH 私钥和 GitHub 登录凭据不会复制。后续需要访问私有远端时在目标自行配置认证；提交署名仍使用实际负责人身份，不因登录账号为 `wangruohan` 而自动改写作者。

在线恢复优先使用本地 `runtime/wheelhouse`，缺包从 pip 源和 PyTorch CUDA 12.4 官方源下载。**现有 wheelhouse 只有三个完整大包，不是完整离线安装包**；目标无外网时需要先补齐各环境依赖 wheel，再加 `--offline`。五个环境的 `*.txt` 固定包版本，`*.json` 保存原 Python/平台和包元数据；源环境通过 Conda 安装的系统库不等同于 pip 包，重建后必须检查实际 import 和模型推理。脚本遇到依赖冲突即退出，不静默升级或改版本。

OCR 恢复结束会执行已有的 PaddleX headless 兼容脚本并保存新补丁记录；不会改动其他环境。环境安装后执行 `pip check`。CUDA 可见设备编号须以新服务器 `nvidia-smi` 为准，不假定新服务器也有 GPU 3；继续遵循单卡顺序运行原则。

## 旧路径、实验清单和复跑

原报告、JSON、HTML 作为历史证据原样保留，没有全仓库字符串替换。原始报告中的旧机器绝对路径仍存在；相对路径的评审页可直接打开。只将用于**新运行**的清单或账本复制到 `runtime/replay`，使用映射替换 JSON 中绝对路径前缀：

```bash
# 以下均在目标 project 目录、已 source ../runtime/activate.sh 后执行
python3 scripts/migration/target.py remap --root "$AIGC_PLATFORM_ROOT" \
  --input "$PWD/tmp/image-workspace/seed-evaluation-20261021/manifest.json" \
  --output "$AIGC_PLATFORM_ROOT/runtime/replay/seed-manifest.json"

python3 scripts/migration/target.py remap --root "$AIGC_PLATFORM_ROOT" \
  --input "$PWD/tmp/image-workspace/reports/docshield-download.json" \
  --output "$AIGC_PLATFORM_ROOT/runtime/replay/docshield-download.json"

python3 scripts/migration/target.py remap --root "$AIGC_PLATFORM_ROOT" \
  --input "$PWD/tmp/image-workspace/reports/mirror-phase2-download.json" \
  --output "$AIGC_PLATFORM_ROOT/runtime/replay/mirror-phase2-download.json"
```

不覆盖原文件；已存在的输出会拒绝写入。资产字节不变，因此权重 SHA256 保留；JSON 文件自身哈希会变化。历史 OCR/融合报告中的摘要引用不能通过路径替换自动“修复”：需要新运行时重新生成整条证据链。2.1 的旧清单仍引用旧数据集位置，需要在目标选用当地数据集另建清单，不猜测目标数据路径。

示例 SEED 新运行（先检查 GPU，以下 `--gpu 0` 仅为示例）：

```bash
"$AIGC_PLATFORM_ROOT/runtime/envs/seed-runtime/bin/python" \
  scripts/image-validation/evaluate_seed.py \
  --source "$AIGC_PLATFORM_ROOT/third_party/seed" \
  --weights "$SEED_WEIGHTS" \
  --manifest "$AIGC_PLATFORM_ROOT/runtime/replay/seed-manifest.json" \
  --output-dir "$AIGC_PLATFORM_ROOT/runtime/replay/seed-first-run" \
  --gpu 0 --max-pixels 40000000
```

该命令没有 DeepSeek API 调用。原密钥配置即使开关开启，解释脚本仍需显式 `--send`；继续只发送脱敏摘要。跨服务器迁移不更改此边界。

## OpenSpec、skills 与继续开发

仓库原有六个技能随 `.agents/skills` 原样保留。用户级 12 个 OpenSpec 技能、Codex system skills、已安装插件 skill 文件分别在目标 `skills` 下备份，不将整个 `.codex` 账号配置复制给新服务器。插件工具连接和账号授权需要新客户端重新配置，复制 SKILL.md 不会迁移服务端连接权限。

先完成传输 checksum 验收。需要在项目内发现额外 OpenSpec 技能时，执行：

```bash
python3 scripts/migration/target.py skills --root "$AIGC_PLATFORM_ROOT"
```

它只为项目缺少的 `openspec-*` 创建指向本目标目录内 `skills/user` 的相对链接，保留仓库自带版本，不覆盖已有技能，不向目标用户主目录安装。新增本地链接可能出现在 Git 未跟踪列表中；不要未经审查提交这些机器配置。其余 Codex/插件技能是备份，按新客户端能力选用，不批量激活。

请新会话先阅读：

1. 仓库 [CONTRIBUTING.md](../../CONTRIBUTING.md)、[团队分工](../TEAM_DEVELOPMENT.md)。
2. [本工作线入口](README.md)、[决策记录](decisions.md)、[数据清单](dataset-inventory.md)、[SEED 实验记录](seed-integration.md)。
3. `openspec/changes/add-image-general/`（2.1）、`openspec/changes/add-image-documents/`（2.3）、`define-shared-foundation` 公共约定。继续这两个已有工作包，不重复创建规格，不因为搬机器创建/切换/合并分支。
4. `migration/inventory.json` 的源端分支、HEAD、未提交状态；当前工作分支以实际快照为准。Git 历史与本地改动分别保留，禁止把未提交文件遗漏在交接之外。

项目约定 OpenSpec **1.13.1**，当前安装版本另存 `migration/openspec-version.txt`。用户可自行在目标安装 CLI；安装位置和 npm 缓存也放入本根目录，例如：

```bash
export npm_config_cache="$AIGC_PLATFORM_ROOT/runtime/cache/npm"
npm install --prefix "$AIGC_PLATFORM_ROOT/runtime/tools/openspec" @fission-ai/openspec@1.13.1
export PATH="$AIGC_PLATFORM_ROOT/runtime/tools/openspec/node_modules/.bin:$PATH"
openspec list --json
openspec validate --all --strict --no-interactive
```

已有 `openspec/` 不需要重新 init；不要先执行可能覆盖指导文件的更新命令。保留 `proposal.md`、`design.md`、`tasks.md`、`specs/*/spec.md`。任务仅在真正实现并验证后勾选；现有公共检查仍限制勾选，不能为了迁移修改公共校验。模型实验完成不等于业务接口或智鉴前端已上线。

## 目标验收与交接完成条件

```bash
npm ci
npm run check
npm test
npm run build
node --test tests/image-documents-*.test.mjs
"$AIGC_PLATFORM_ROOT/runtime/envs/seed-runtime/bin/python" -m unittest discover \
  -s scripts/image-validation -p test_seed_adapter.py
"$AIGC_PLATFORM_ROOT/runtime/envs/ocr-runtime/bin/python" -m unittest discover \
  -s scripts/image-validation -p 'test_pdf*.py'
```

随后使用新清单分别加载 MIRROR、DocShield、OCR、SEED，检查参数严格加载、单卡可用、PDF 渲染和坐标。基础环境/驱动差异可能影响输出，保存新结果，不覆盖旧实验。前端服务启动仍按原工程，当前业务 HTTP 占位状态与已知能力限制不因迁移而改变。

交接完成需要：源端 `verify` 通过、目标 Git HEAD/refs 对上、未提交工作区可见、权重实际加载成功、2.3 材料可读取、OpenSpec 与相关代码检查通过。**本次只已验证迁移工具的本地行为与源端资产盘点；没有把目标服务器安装或模型运行写成已完成。** 原服务器文件在全部验收后再由用户决定是否清理。
