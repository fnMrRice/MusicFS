# Web + Server 本地打包

在 MusicFS 根目录运行：

```powershell
./package.ps1
```

脚本执行 `npm ci`、`npm run build`，再调用 Server 已有的打包工具，编译主程序和承载七种内置角色的统一插件程序，并把 `web/dist` 的内容放入同一个安装目录。默认输出到 `packages/musicfs-windows-amd64-时间戳/`，完成时打印完整路径。只打包，不启动服务。

前提：根目录旁有独立检出的 `server/` 与 `web/`，安装 Git、Go（工具链按 `server/go.mod` 自动选择）、Node.js 和 npm（版本按 `web/package.json`）；首次安装依赖或下载 Go 工具链需要网络。当前 Web 固定 Node.js 26.3.1、npm 11.16.0，Server 固定 Go 1.26.9。

其他用法：

```powershell
# 指定新的输出目录；相对路径始终以 package.ps1 所在目录为基准。
./package.ps1 -Output ./packages/my-build

# 已按当前锁文件安装过依赖时，可跳过安装，仍会重新构建两端。
./package.ps1 -SkipInstall

# 生成 Linux amd64 安装目录；交叉编译成功不代表已完成目标系统运行验收。
./package.ps1 -TargetOS linux
```

这是本地工作区打包，包含未提交代码；Server 的 `release.json` 记录其提交与脏树状态，不代表 Web 的提交状态。已有输出目录会直接报错，避免覆盖已修改的配置、数据或正在使用的程序。失败产物中的 `.incomplete` 标记表示不可使用；修复原因后指定新目录重试。

## 安装目录

```text
musicfs-windows-amd64-时间戳/
  bin/                         Server 主程序和 musicfs-plugins 统一插件程序
  web/                         web/dist 的静态文件
  configs/server.example.yaml  已调整程序、Web 和数据相对路径的示例
  configs/server.schema.json   配置 Schema
  scripts/scan.ps1             手动扫描脚本
  licenses/                   Server 依赖许可
  start.bat                   Windows 双击启动入口
  README.md
  release.json
  SHA256SUMS
```

整个目录可以一起搬走；运行机器无需 Node.js、npm 或 Go。FFmpeg/ffprobe 和可选的 fpcalc 不随包提供，需要相关功能时另行安装并配置。打包不包含 `docs/` 目录，也不复制开发环境的配置、音乐、数据库或登录令牌；文档保留在源码仓库中。

## Windows 手动启动

双击安装目录中的 `start.bat` 即可启动 Server 和 Web 页面。首次运行会从示例创建 `configs/server.yaml`，已有配置不会覆盖。默认页面为 `http://127.0.0.1:8080`；保持启动窗口打开，按 Ctrl+C 停止。

未设置 `MUSICFS_ADMIN_TOKEN` 时，脚本首次生成登录令牌保存在 `configs/admin-token.txt`，以后重复使用，并将令牌复制到剪贴板以便粘贴登录。该文件是本机明文凭据，请妥善保存，不要分享或提交。若已通过环境变量提供令牌，脚本直接使用它，不修改文件或剪贴板。启动失败时窗口会保留错误信息。

启动时自动发现内置插件，未显式禁用且配置齐全的自动启动；缺少音乐目录或工具路径的显示待配置，不阻止页面打开。旧配置中的 enabled: false 继续生效。

编辑 `configs/server.yaml`：

- 在 `musicfs.localfiles` 下填写自己的 `config.musicRoots[].path`，并把该插件及其 `local` 实例的 `enabled` 都改成 `true`。默认 `../music` 只是待替换目录，不包含音乐。
- NCM 与本地歌词/封面插件默认可用；不需要时可通过 enabled: false 禁用。
- 需要转码/DSP 或当前 NCM FLAC 播放路径时，填写 `musicfs.audio.ffmpeg` 的 `ffmpegPath`、`ffprobePath`，若曾显式禁用，再启用插件和实例。
- `webRoot` 已指向 `../web`，插件程序指向 `../bin`，无需另外运行 Web 服务。相对路径均以配置文件所在目录为基准。

首次导入音乐需要扫描。在另一个终端进入同一安装目录，把同一令牌放入 `MUSICFS_ADMIN_TOKEN`，执行：

```powershell
$env:MUSICFS_ADMIN_TOKEN = (Get-Content ./configs/admin-token.txt -Raw).Trim()
./scripts/scan.ps1 -ProviderID local
```

若启动时用了外部环境变量令牌，在扫描终端使用该值，无需读取文件。

扫描完成后刷新页面。音乐根、实例开关、音频工具与扫描选项详见源码仓库的 [Server 配置说明](../server/docs/configuration.md)和[运行说明](../server/docs/running.md)。

## Linux 手动启动

使用 Linux 制品，复制并编辑同一配置示例、启用所需插件后运行：

```sh
export MUSICFS_ADMIN_TOKEN="$(./bin/musicfs token)"
./bin/musicfs serve --config ./configs/server.yaml
```

登录使用环境中的同一令牌。若安装目录通过 Windows 文件系统或复制工具传输后丢失执行权限，先运行 `chmod +x bin/*`。默认监听地址和页面 URL 与 Windows 相同；远程访问的 TLS 和 Origin 设置见源码仓库的 [Server 部署说明](../server/docs/deployment.md)。
