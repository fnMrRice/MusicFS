# 启动 MusicFS

先完整解压安装包。运行时不需要 Go、Node.js 或 npm。

- **Windows**：双击根目录的 `start.bat`。
- **Linux**：在安装目录运行 `sh ./start.sh`。

首次启动会把 `configs/server.example.yaml` 复制为 `configs/server.yaml`，已有配置会保留。自行打开 <http://127.0.0.1:8080>，输入管理员令牌登录；服务默认只监听本机，保持启动窗口打开，按 Ctrl+C 停止。启动失败时错误信息保留在窗口中。

## 登录令牌

启动脚本优先使用环境变量 `MUSICFS_ADMIN_TOKEN`。未设置时，首次生成令牌并写入 `configs/admin-token.txt`，以后复用该文件；Windows 会复制令牌到剪贴板，Linux 新建令牌文件仅允许当前用户读写。若使用外部环境变量，不修改令牌文件或剪贴板。令牌文件是本机明文凭据，请勿分享、打包或提交到 Git。

## 加入音乐

随包插件会被自动发现。未显式禁用且配置齐全的实例自动启动；缺少音乐目录或工具路径时显示 `pending_configuration`，页面仍可打开。旧配置中的 `enabled: false` 会继续生效，需要使用该实例时先移除显式禁用或改为 `true`。

本地音乐目录使用以下流程：

1. 停止服务，编辑 `configs/server.yaml` 中 `musicfs.localfiles` 的 `local` 实例，设置 `permissions.readDirectories`，例如 `['D:/Music']`。这是允许访问的目录范围，不会自动加入曲库；相对路径以配置文件所在目录为基准。重启使授权生效。
2. 使用管理员 API 读取并更新 `/api/v1/admin/plugin-instances/local/configuration`，选择授权范围内的实际音乐目录。新增目录须提供 Server 上的绝对路径。设置保存在 Server 的数据库中，不回写 YAML；Web 当前没有目录编辑表单。请求所需的管理员会话、CSRF、ETag 与 `If-Match`、`Idempotency-Key` 及完整示例见源码仓库的 [插件配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugin-configuration.md)。
3. 等待配置操作完成后，在另一个终端进入安装目录，使用同一管理员令牌运行包内扫描脚本。扫描成功后刷新 Web 曲目列表。

Windows 扫描示例（启动时未使用外部环境变量令牌）：

```powershell
$env:MUSICFS_ADMIN_TOKEN = (Get-Content ./configs/admin-token.txt -Raw).Trim()
./scripts/scan.ps1 -ProviderID local
```

若启动时使用了外部环境变量，在扫描终端使用该值。Linux 可以用 PowerShell 7 运行 `scripts/scan.ps1`，或通过管理 API 发起扫描。参数和 API 用法见源码仓库的 [运行说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/running.md)；本地目录管理以较新的[插件配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugin-configuration.md)为准。

## 音频与其他配置

普通兼容格式可用原流播放。本地 NCM 由随包插件处理；需要转码/DSP 或当前 NCM FLAC 播放路径时，另行安装 FFmpeg/ffprobe，并填写 `musicfs.audio.ffmpeg` 实例的 `config.ffmpegPath` 和 `config.ffprobePath`。这两个外部工具不包含在包中。NCM 和本地歌词/封面插件无需 FFmpeg 即可启动，具体媒体操作仍取决于格式和工具配置。

`webRoot` 已指向 `../web`，插件程序指向 `../bin`，无需另外运行 Web 服务。如端口被占用，修改 `listen` 和 `allowedOrigins`，然后打开新地址。安装包不含 `docs/`，其他说明见源码仓库的 [配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/configuration.md)、[NCM 说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/ncm.md)和[部署说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/deployment.md)。远程访问需配置 TLS；默认启动脚本面向本机运行。
