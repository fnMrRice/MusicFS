# 本地打包

主仓库提供 Server、七个官方插件和 Web 的组合打包入口。当前没有桌面 Client 可执行程序。编译在各子模块中进行，产物默认保存在主仓库根目录的 `deploy/`；该目录由 Git 忽略，不会上传或发布。

## 构建环境

先执行 `git submodule update --init --recursive`，再准备 Git、Go、Node.js 和 npm，并加入 PATH。版本以 `server/go.mod` 和 `web/package.json` 为准：当前为 Go 1.26.9、Node.js 26.3.1、npm 11.16.0。脚本使用已有工具，不自动更改系统环境；首次构建需要联网下载锁定依赖。

Windows 使用 PowerShell 5.1 或更新版本；Linux 使用 POSIX Shell、tar 和 gzip。Shell 生成 Windows ZIP 时还需 zip。两个平台都只生成 amd64 程序，交叉编译成功不代表已在目标系统运行验证。

## PowerShell

在主仓库执行：

```powershell
./scripts/package.ps1
# 指定目标和新的输出目录
./scripts/package.ps1 -TargetOS windows -Output ./deploy/musicfs-windows-amd64
```

默认生成 Windows 安装目录、同名 ZIP 及 ZIP 的 `.sha256` 校验文件。也可用 `-TargetOS linux` 生成 Linux 目录和 tar.gz。

## Shell

```sh
sh scripts/package.sh
sh scripts/package.sh --os linux --output ./deploy/musicfs-linux-amd64
```

默认生成 Linux 安装目录、同名 tar.gz 及 `.sha256`；`--os windows` 生成 Windows ZIP。

## 行为与参数

- 默认执行 `npm ci`、Web 类型检查与生产构建，再调用 Server 已有发布构建器；不修改锁文件。
- 输出目录和压缩包不得已存在，避免覆盖旧安装或用户数据。相对输出路径按调用时的当前目录解析。
- Server 与 Web 默认要求工作树干净；主仓库的文档/脚本改动不影响打包。开发验证可用 `-AllowDirty` / `--allow-dirty`，Server 的 `release.json` 与 Web 的 `web-source.json` 分别记录状态。
- 已单独完成 Web 构建时，可用 `-SkipWebBuild` / `--skip-web-build` 复用 `web/dist`；调用者须确认它与源码一致，清单会标记未重建。
- 包含配置示例、文档、依赖许可证、专用启动入口和全部文件的 `SHA256SUMS`。FFmpeg/ffprobe、可选 fpcalc 仍为外部依赖；转码与指纹功能需另行配置。
- 打包脚本不会自动执行完整测试。可在 Web 中运行 `npm test`；Server 的安装包回归使用 `MUSICFS_RELEASE_ROOT` 指定生成目录，按其测试要求配置 FFmpeg/ffprobe。

解压后的运行方式见 [启动说明](packaging-start.md)，该说明同时复制为安装包根目录的 `START.md`。只有未出现 `.incomplete` 标记且校验通过的目录才是完成的安装包。

## 本次 Windows 验证

2026-10-10：使用上述固定工具链完成生产构建，Web 的 33 项测试通过。从 ZIP 解压到含空格的目录后，89 个文件校验通过；实际运行 `start.bat`，首次配置、自动生成令牌、就绪接口、Web 首页、管理员登录及正常退出均通过。

完整安装包音频回归在本机外部 FFmpeg/ffprobe 9.0.2 环境中未通过：FLAC 处理流返回 `seekMode: none`，不满足测试要求的定位能力。本次只确认打包与启动可用，不将该失败记为音频定位验收通过。Linux 启动脚本完成语法检查，尚未在本轮运行 Linux 安装包。
