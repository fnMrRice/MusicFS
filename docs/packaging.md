# Web + Server 本地打包

主仓库提供 Server、官方插件和 Web 的组合打包入口。当前没有桌面 Client 可执行程序。编译在各子模块中进行，产物默认保存在根仓库的 `deploy/`；该目录由 Git 忽略。脚本只打包，不启动服务或上传产物。

## 构建环境

先执行 `git submodule update --init --recursive`，再准备 Git、Go、Node.js 和 npm，并加入 PATH。版本以 `server/go.mod` 和 `web/package.json` 为准：当前为 Go 1.26.9、Node.js 26.3.1、npm 11.16.0。首次构建需要联网下载锁定依赖或 Go 工具链。

Windows 使用 PowerShell 5.1 或更新版本；Linux 使用 POSIX Shell、tar 和 gzip。Shell 生成 Windows ZIP 时还需 zip。两个平台都只生成 amd64 程序，交叉编译成功不代表已在目标系统运行验证。

## PowerShell

在主仓库执行：

```powershell
./scripts/package.ps1
# Choose a new output directory.
./scripts/package.ps1 -TargetOS windows -Output ./deploy/musicfs-windows-amd64
# Rebuild with dependencies already installed from the current lock file.
./scripts/package.ps1 -SkipInstall
```

默认生成 Windows 安装目录、同名 ZIP 及 ZIP 的 `.sha256` 校验文件。也可用 `-TargetOS linux` 生成 Linux 目录和 tar.gz。打包入口仅放在 `scripts/`，相对输出路径以调用时的当前目录为基准。

## Shell

```sh
sh scripts/package.sh
sh scripts/package.sh --os linux --output ./deploy/musicfs-linux-amd64
sh scripts/package.sh --skip-install
```

默认生成 Linux 安装目录、同名 tar.gz 及 `.sha256`；`--os windows` 生成 Windows ZIP。相对输出路径以调用时的当前目录为基准。

## 行为与参数

- 默认执行 `npm ci`、Web 类型检查与生产构建，再调用 Server 已有发布构建器；不修改锁文件。
- `-SkipInstall` / `--skip-install` 仅跳过 `npm ci`，仍重新构建 Web 和 Server。调用者须保证依赖与当前锁文件一致。
- 已单独完成 Web 构建时，可用 `-SkipWebBuild` / `--skip-web-build` 复用 `web/dist`；调用者须确认它与源码一致，清单会标记未重建。
- Server 与 Web 默认要求工作树干净；主仓库的文档/脚本改动不影响打包。开发验证可用 `-AllowDirty` / `--allow-dirty`，Server 的 `release.json` 与 Web 的 `web-source.json` 分别记录状态。
- 输出目录、压缩包及其校验文件不得已存在，避免覆盖旧安装或用户数据。失败时换用新的输出目录重试；有 `.incomplete` 标记的目录不可使用。
- 打包脚本不会自动执行完整测试。可在 Web 中运行 `npm test`；Server 的安装包回归使用 `MUSICFS_RELEASE_ROOT` 指定生成目录，并按测试要求配置 FFmpeg/ffprobe。

## 安装目录

```text
musicfs-windows-amd64-时间戳/
  bin/                         musicfs.exe 与 musicfs-plugins.exe
  web/                         Web 静态文件
  configs/server.example.yaml  安装配置示例
  configs/server.schema.json   配置 Schema
  scripts/scan.ps1             手动扫描脚本
  licenses/                    依赖许可证
  start.bat                    Windows 启动入口
  START.md                     启动与配置说明
  README.md
  release.json
  web-source.json
  SHA256SUMS
```

Linux 包内程序没有 `.exe` 后缀，启动入口为 `start.sh`。新版只分发主程序和统一插件程序两个可执行文件；七种内置插件角色仍以独立进程运行。整个安装目录可以一起搬走，运行机器不需要 Go、Node.js 或 npm。只有未出现 `.incomplete` 标记且校验通过的目录才是完成的安装包。

包中不包含 `docs/`，也不复制开发环境的配置、音乐、数据库或登录令牌。FFmpeg/ffprobe、可选 fpcalc 仍是外部依赖，需要相关功能时另行安装并配置。

## 启动与音乐目录

解压后 Windows 双击 `start.bat`，Linux 运行 `sh ./start.sh`。默认页面为 `http://127.0.0.1:8080`。启动脚本保留已有配置，优先使用环境变量 `MUSICFS_ADMIN_TOKEN`；未设置时生成或复用 `configs/admin-token.txt`。Windows 会把文件中的令牌复制到剪贴板，Linux 会限制令牌文件权限。该文件是运行时明文凭据，不会由打包脚本复制或提交到 Git。

插件启动时自动发现，配置齐全且未显式禁用的实例自动启动；缺少音乐目录或工具路径的实例显示 `pending_configuration`，不阻止 Web 打开。已有 `enabled: false` 继续生效。

本地音乐目录由管理员 API 管理并存入数据库；YAML 的 `permissions.readDirectories` 只规定目录授权范围，不会自动加入曲库。Web 当前没有目录编辑表单。完整流程见[启动说明](packaging-start.md)，该文件会复制为包根目录的 `START.md`；接口与迁移规则见 [Server 插件配置说明](../server/docs/plugin-configuration.md)。

## 验证记录

2026-10-10 更新后：Server `f114842`、Web `e51d170` 的 Windows 包生产构建通过；Web 43 项测试通过，统一插件角色隔离、自动发现/待配置与禁用状态恢复三项定向回归通过。ZIP 与解压后 46 个文件校验通过，包内只有两个程序且无 `docs/`。从含空格的目录实际运行 `start.bat`，首次配置、环境令牌登录、Web 首页、七种插件状态及正常退出均通过；另以隔离模拟包验证 BAT 令牌持久化、复用、环境变量优先和生成失败清理。本轮没有重新验收音频定位或 Linux 原生安装。

2026-10-10 的旧包（八个可执行文件）曾完成 Web 33 项测试、解压后 89 个文件校验、首次配置、令牌生成、就绪接口、Web 首页、管理员登录和正常退出验证。这些记录属于更新前制品，不作为当前两个可执行文件版本的验收结果。

同一旧包在外部 FFmpeg/ffprobe 9.0.2 环境中的完整音频回归未通过：FLAC 处理流返回 `seekMode: none`，未达到定位能力要求。旧包 Linux 启动脚本只完成语法检查，未进行 Linux 安装包运行验证。
