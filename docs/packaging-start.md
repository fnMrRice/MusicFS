# 启动 MusicFS

先完整解压安装包。运行时不需要 Go、Node.js 或 npm。

- **Windows**：双击根目录的 `start.bat`。
- **Linux**：在安装目录运行 `sh ./start.sh`。

首次启动会把 `configs/server.example.yaml` 复制为 `configs/server.yaml`，已有配置会保留。自行打开 <http://127.0.0.1:8080>，输入管理员令牌登录；服务默认只监听本机，保持启动窗口打开，按 Ctrl+C 停止。启动失败时错误信息保留在窗口中。

## 登录令牌

启动脚本优先使用环境变量 `MUSICFS_ADMIN_TOKEN`。未设置时，首次生成令牌并写入 `configs/admin-token.txt`，以后复用该文件；Windows 会复制令牌到剪贴板，Linux 新建令牌文件仅允许当前用户读写。若使用外部环境变量，不修改令牌文件或剪贴板。令牌文件是本机明文凭据，请勿分享、打包或提交到 Git。

## 加入音乐

安装包示例在插件和实例两层显式设置 `enabled: true`，配置齐全后启动；缺少音乐目录或工具路径时显示 `pending_configuration`，页面仍可打开。已有配置会保留：显式列出的插件或实例省略 `enabled` 与设为 `false` 都表示禁用。若本地音乐显示禁用，在「设置 → 插件管理」启用插件及其实例，再添加目录和扫描；只删除开关字段不会启用。

本地音乐目录使用以下流程：

1. 默认允许当前 Server 运行用户的 Music 目录；Windows 首次启动还会检查各磁盘根目录下的常见音乐下载目录。「设置 → 插件管理」的本地音乐摘要显示“n 个允许访问的目录”，初次没有已添加的音乐目录。若需调整允许范围，停止服务并编辑 `configs/server.yaml` 中 `musicfs.plugin.source.localfiles` 的唯一实例，设置 `permissions.readDirectories`，例如 `['D:/Music']`，再重启生效；实例 ID 为 UUID，相对路径以配置文件所在目录为基准。
2. 使用管理员账号打开 Web「设置 → 音乐源」，点击「本地音乐」标题右侧的「添加本地目录」。弹窗目录树只能展开并选择允许访问的根或子目录；已添加目录显示在标题下方，每行右侧用减号删除、用编辑修改该目录的名称与查找设置。递归启用时默认不限深度；「高级选项」内勾选「限制递归深度」后可编辑数字，未限制或填 0 表示全部递归。默认跳过点开头及 Windows 隐藏项，并遵循 .nomedia 跳过标记所在目录及子树。配置保存到 Server 数据库，不回写 YAML；添加或编辑成功后自动扫描。删除目录配置不删除文件或撤销访问授权。也可使用管理员目录浏览与配置 API，完整示例见源码仓库的 [插件配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugins/plugin-configuration.md)。
3. 自动扫描所有已添加目录并沿用各目录的查找设置，页面显示排队、扫描进度和结果；完成后刷新曲库，可直接返回「曲目列表」查看。需要重新扫描时，点击「音乐源 → 本地音乐」标题行的「扫描音乐」。扫描中不能重复提交，刷新页面后可继续查看当前任务；连接异常时点击「继续确认扫描结果」，不会另建重复任务。尚未添加目录或本地音乐未就绪时，先按页面提示完成配置。

也可使用包内脚本。Windows 扫描示例（启动时未使用外部环境变量令牌）：

```powershell
$env:MUSICFS_ADMIN_TOKEN = (Get-Content ./configs/admin-token.txt -Raw).Trim()
./scripts/scan.ps1 -ProviderID b1548e96-3081-5c9c-8376-bf290e369d51
```

示例使用随包本地音乐实例的 UUID；如果更换过实例，使用实际实例 ID。若启动时使用了外部环境变量，在扫描终端使用该值。Linux 可以用 PowerShell 7 运行 `scripts/scan.ps1`，或通过管理 API 发起扫描。参数和 API 用法见源码仓库的 [运行说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/operations/running.md)；本地目录管理以较新的[插件配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugins/plugin-configuration.md)为准。

## 音频与其他配置

普通兼容格式可用原流播放。本地 NCM 由随包插件处理；需要转码/DSP 或当前 NCM FLAC 播放路径时，另行安装 FFmpeg/ffprobe，并填写 `musicfs.plugin.decoder.ffmpeg` 实例的 `config.ffmpegPath` 和 `config.ffprobePath`。这两个外部工具不包含在包中。NCM 和本地歌词/封面插件无需 FFmpeg 即可启动，具体媒体操作仍取决于格式和工具配置。

`webRoot` 已指向 `../web`，插件程序指向 `../bin`，无需另外运行 Web 服务。如端口被占用，修改 `listen` 和 `allowedOrigins`，然后打开新地址。安装包不含 `docs/`，其他说明见源码仓库的 [配置说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/operations/configuration.md)、[NCM 说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/playback/ncm.md)和[部署说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/operations/deployment.md)。远程访问需配置 TLS；默认启动脚本面向本机运行。
