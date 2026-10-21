# Web + Server 本地打包

主仓库提供 Server、官方插件和 Web 的组合打包入口。当前没有桌面 Client 可执行程序。编译在各子模块中进行，产物默认保存在根仓库 `deploy/` 下的固定目录；该目录由 Git 忽略。脚本只编译并更新运行目录，不生成压缩包、不启动服务或上传产物。

## 构建环境

先执行 `git submodule update --init --recursive`，再准备 Git、Go、Node.js 和 npm，并加入 PATH。版本以 `server/go.mod` 和 `web/package.json` 为准：当前为 Go 1.26.9、Node.js 26.3.1、npm 11.16.0。首次构建需要联网下载锁定依赖或 Go 工具链。

Windows 使用 PowerShell 5.1 或更新版本；Linux 使用 POSIX Shell。两个平台都只生成 amd64 程序，交叉编译成功不代表已在目标系统运行验证。

## PowerShell

在主仓库执行：

```powershell
./scripts/package.ps1
# Include local development changes.
./scripts/package.ps1 -AllowDirty
# Choose another fixed output directory.
./scripts/package.ps1 -TargetOS windows -Output ./deploy/musicfs-dev -AllowDirty
# Rebuild with dependencies already installed from the current lock file.
./scripts/package.ps1 -SkipInstall
```

默认更新 `deploy/musicfs-windows-amd64/`；`-TargetOS linux` 更新 `deploy/musicfs-linux-amd64/`。打包入口仅放在 `scripts/`，相对输出路径以调用时的当前目录为基准。

## Shell

```sh
sh scripts/package.sh
sh scripts/package.sh --allow-dirty
sh scripts/package.sh --os linux --output ./deploy/musicfs-dev --allow-dirty
sh scripts/package.sh --skip-install
```

默认更新 `deploy/musicfs-linux-amd64/`；`--os windows` 更新 `deploy/musicfs-windows-amd64/`。相对输出路径以调用时的当前目录为基准。

## 行为与参数

- 默认执行 `npm ci`、Web 类型检查与生产构建，再调用 Server 已有发布构建器；不修改锁文件。
- `-SkipInstall` / `--skip-install` 仅跳过 `npm ci`，仍重新构建 Web 和 Server。调用者须保证依赖与当前锁文件一致。
- 已单独完成 Web 构建时，可用 `-SkipWebBuild` / `--skip-web-build` 复用 `web/dist`；调用者须确认它与源码一致，清单会标记未重建。
- Server 与 Web 默认要求工作树干净；主仓库的文档/脚本改动不影响打包。开发验证可用 `-AllowDirty` / `--allow-dirty`，Server 的 `release.json` 与 Web 的 `web-source.json` 分别记录状态。
- 开发时每次更新前先关闭正在运行的 MusicFS。构建先写入同级临时目录，编译及组装成功后才更新固定输出目录；构建失败不会改动已有运行目录，临时目录保留用于排查。
- 更新仅覆盖构建文件，并根据旧 `SHA256SUMS` 清理不再分发的资产；保留 `configs/server.yaml`、`configs/admin-token.txt`、数据库、缓存及其他运行数据。已有非空输出目录须具有有效的构建清单，不能直接覆盖任意目录。
- 更新失败时可能留下 `.incomplete` 标记，此时不要启动程序，排除问题后重新构建。旧的时间戳目录不会自动迁移或删除；需要沿用其中的运行配置或数据时，请关闭程序后自行迁移到固定目录。
- 编译进程若被强制结束，可能遗留同级的 `<输出目录名>.update-lock` 空目录；确认没有编译任务运行后删除该空目录，再重新构建。不要手动移除 `.incomplete` 来跳过检查。
- 打包脚本不会自动执行完整测试。可在 Web 中运行 `npm test`；Server 的安装包回归使用 `MUSICFS_RELEASE_ROOT` 指定生成目录，并按测试要求配置 FFmpeg/ffprobe。

## 安装目录

```text
musicfs-windows-amd64/
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

进入编译输出目录后，Windows 双击 `start.bat`，Linux 运行 `sh ./start.sh`。默认页面为 `http://127.0.0.1:8080`。启动脚本保留已有配置，优先使用环境变量 `MUSICFS_ADMIN_TOKEN`；未设置时生成或复用 `configs/admin-token.txt`。Windows 会把文件中的令牌复制到剪贴板，Linux 会限制令牌文件权限。该文件是运行时明文凭据，不会由打包脚本复制或提交到 Git。

插件启动时自动发现，配置齐全且未显式禁用的实例自动启动；缺少音乐目录或工具路径的实例显示 `pending_configuration`，不阻止 Web 打开。已有 `enabled: false` 继续生效。

本地音乐默认没有选定的导入目录，也不会在安装目录创建示例 music 文件夹。允许访问的范围默认采用运行用户的 Music 目录与 Windows 首次探测结果；YAML 的 `permissions.readDirectories` 可显式覆盖该范围，插件管理摘要显示允许访问的目录数量。音乐源中点击「本地音乐」标题右侧的「添加本地目录」，只能从弹窗目录树选择授权根或子目录；下方单独列出已添加目录，每行提供减号删除和编辑。编辑可修改该目录的名称、递归与高级选项，不影响其他目录。递归默认深度 0 不限，默认跳过隐藏内容并遵循 .nomedia，保存到数据库后再显式扫描导入；移除音乐目录不会撤销授权或删除文件。完整流程见[启动说明](packaging-start.md)，该文件会复制为包根目录的 `START.md`；接口与迁移规则见 [Server 插件配置说明](../server/docs/plugin-configuration.md)。

## 验证记录

2026-10-13 推送前检查：Windows 上 21 项打包文件测试通过，新增资产文件名仅改变大小写的更新与中断恢复回归；清理旧资产时按文件系统解析后的真实路径区分同一文件与独立文件。JavaScript、PowerShell 和 Shell 语法检查通过。本轮未重新生成完整安装包或在 Linux 原生文件系统上运行回归。

2026-10-11 固定目录构建：Server `7cffd3c`、Web `2fd2326` 的 Windows amd64 编译成功，固定目录中 46 个分发文件校验通过，未生成压缩包。19 项打包文件测试通过，覆盖连续更新、保留配置/令牌/数据库、删除旧资源、校验失败保护、平台与链接检查、中断恢复。实际再次更新时检测到目标程序正在运行，脚本在修改输出前退出，原目录校验仍通过。PowerShell、Shell 语法检查通过；本轮未验证 Linux 原生运行或完整业务流程。

打包文件回归可在根仓库运行 `node --test --test-isolation=none scripts/tests/package-files.test.mjs`。

2026-10-10 更新后：Server `f114842`、Web `e51d170` 的 Windows 包生产构建通过；Web 43 项测试通过，统一插件角色隔离、自动发现/待配置与禁用状态恢复三项定向回归通过。ZIP 与解压后 46 个文件校验通过，包内只有两个程序且无 `docs/`。从含空格的目录实际运行 `start.bat`，首次配置、环境令牌登录、Web 首页、七种插件状态及正常退出均通过；另以隔离模拟包验证 BAT 令牌持久化、复用、环境变量优先和生成失败清理。本轮没有重新验收音频定位或 Linux 原生安装。

2026-10-10 的旧包（八个可执行文件）曾完成 Web 33 项测试、解压后 89 个文件校验、首次配置、令牌生成、就绪接口、Web 首页、管理员登录和正常退出验证。这些记录属于更新前制品，不作为当前两个可执行文件版本的验收结果。

同一旧包在外部 FFmpeg/ffprobe 9.0.2 环境中的完整音频回归未通过：FLAC 处理流返回 `seekMode: none`，未达到定位能力要求。旧包 Linux 启动脚本只完成语法检查，未进行 Linux 安装包运行验证。
