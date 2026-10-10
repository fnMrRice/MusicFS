# 启动 MusicFS

先完整解压安装包。运行时不需要 Go、Node.js 或 npm。

- **Windows**：双击根目录的 `start.bat`。
- **Linux**：在安装目录运行 `sh ./start.sh`。

首次启动会把 `configs/server.example.yaml` 复制为 `configs/server.yaml`，并创建空的 `music/` 目录；已有配置会保留。控制台显示管理员登录令牌，打开 <http://127.0.0.1:8080> 后输入该令牌。服务默认只监听本机，按 Ctrl+C 停止。

未设置 `MUSICFS_ADMIN_TOKEN` 时，每次新启动都会生成新令牌，仅保存在当前进程环境和控制台中。请勿分享控制台截图；如需固定令牌，在启动前通过自己的环境配置设置此变量，不要把凭据写进脚本或提交到 Git。已有登录会话不保证跨重启保留。

## 加入音乐

初始配置的插件默认关闭，所以首次打开会显示空库。先停止服务，编辑 `configs/server.yaml`：

1. 找到 `pluginId: 'musicfs.localfiles'`，将该插件及其 `local` 实例的 `enabled` 都设为 `true`。
2. 将 `musicRoots` 下的 `path` 设置为自己的音乐目录；默认 `../music` 对应安装目录内的 `music/`。Windows 路径可用单引号，例如 `'D:/Music'`。
3. 重新运行启动脚本，使用新的登录令牌。在另一个 PowerShell 窗口设置同一个 `MUSICFS_ADMIN_TOKEN`，然后运行包内 `scripts/scan.ps1` 发起扫描；具体参数与 API 用法见 `docs/running.md`。完成后刷新 Web 曲目列表。

普通兼容格式可用原流播放。NCM 需要同时启用 `musicfs.ncm` 插件及实例；需要转码时，安装 FFmpeg/ffprobe，在 `musicfs.audio.ffmpeg` 中填写工具路径，再启用插件和实例。FFmpeg/ffprobe 不包含在此包内。完整配置见 `docs/configuration.md`、`docs/ncm.md` 和 `docs/deployment.md`。

如端口被占用，修改 `listen` 和 `allowedOrigins`，然后打开修改后的地址。远程访问需按部署文档配置 TLS；默认启动脚本面向本机运行。
