# MusicFS

简体中文 · [English](docs/README.en.md)

MusicFS 是一个可自托管的音乐库。把音乐目录添加到服务器，就能在浏览器、桌面或 Android 设备上听自己的收藏。服务端插件还可以接入在线音源，为已有录音查找歌词、封面和发行资料。

Web 和桌面端的整体布局参考了网易云音乐桌面客户端。左侧是搜索、推荐、作品库、收藏和歌单，右侧显示当前页面。底部播放栏始终可见，浏览其他专辑或整理歌单时也能切歌、查看队列和调节音量。

![MusicFS Web 的曲目列表与正在播放的曲目](docs/screenshots/web-library.png)

*Web 曲库实拍，使用演示曲目和封面。*

## 主要功能

- **导入和浏览曲库**。扫描服务器上的目录或已挂载的网络共享，可逐目录设置递归深度和排除规则，也可开启文件变更监听。按曲名搜索，或按歌手、专辑、流派、来源和文件夹浏览。
- **整理同一首歌的多个版本**。试听并比对重复候选，确认合并或排除。合并保留各个音源和原文件，可指定默认播放版本，也可为某条收藏或歌单条目固定版本。
- **发现与播放音乐**。在「推荐」查看网易云账号的每日推荐歌曲和推荐歌单，用「时光机」回看之前的歌单推荐。在 Web 播放器中可查看队列和同步歌词、调整音效，也可从「最近播放」找回听过的歌。
- **收藏与编排歌单**。收藏单曲，或在曲目列表中勾选多首加入自建歌单。可以把其他自建歌单、已导入的远程歌单按顺序组合到同一张歌单，也可以关联自己的网易云歌单。[歌单关联与同步](#歌单关联与同步)
- **选择播放方式和音质**。直接播放客户端兼容的音频，或由服务器转码。对于支持下载的在线音源，可边下边播，也可选择音质，把单曲、多首曲目或整张歌单下载到服务器。
- **编辑和补全资料**。手动编辑曲目与专辑，按名称、编号或专辑链接查找发行版，预览曲目表、封面、歌词后按需选用。可调整歌词查找顺序，也可把未补全的专辑加入批量刮削任务。
- **管理整部作品**。CD 专辑、ASMR 和电台录音插件分别提供独立作品库。导入本地作品包时保留多碟、正篇和特典等目录结构，可播放其中的音轨、预览或下载附件。
- **跟踪后台任务**。在任务队列中查看目录元数据刷新、专辑批量刮削和重复曲目批量合并的进度。关闭页面后，服务器会继续执行已提交的任务。

## 歌单关联与同步

1. **选择关联目标**。在 Web 的「歌单管理」里展开已登录的网易云账号，找到自己有写入权限的歌单，点击「关联本地歌单」。可选「我的收藏」、已有的自建歌单，或当场新建歌单。每张网易云歌单只能关联一个本地目标，多张网易云歌单可以关联到同一目标。
2. **从网易云同步到 MusicFS**。首次关联会自动读取远程歌单，把曲目及其网易云音源存入曲库，并将缺少的歌曲加入本地目标。以后在网易云加了歌，可在「歌单管理」的关联项或关联目标的详情页点击「立即同步」。同步会跳过已有成员，保留手动添加的歌曲。若读取失败，仍可使用上次成功同步的列表。
3. **从 MusicFS 向网易云加歌**。例如，把网易云的「通勤」关联到「我的收藏」后，在 MusicFS 收藏一首选用网易云音源的新歌，服务器就会把它追加到「通勤」。写入范围仅限关联后新加的网易云曲目。本地文件、其他平台的曲目，以及在 MusicFS 中做的排序、隐藏和移除，都只影响本地。
4. **查看或解除关联**。「歌单管理」会显示关联目标、待同步曲数和写入错误。点击「解除关联」会停止后续追加，两边已有的歌曲都会保留。

**组合多张歌单**时，打开自建歌单的「编辑名称与聚合规则」，在「添加聚合来源」中选择其他自建歌单或已导入的远程歌单，点击「添加规则」。上下移动规则即可调整顺序，保存后点击「更新歌单快照」即可播放组合后的列表。这些编排操作只在 MusicFS 内生效。[歌单关联说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/library/source-playlists.md) · [歌单聚合规则](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/library/playlists.md)

## 音乐源插件

| 音乐源 | 当前支持的功能 |
| --- | --- |
| 本地文件 | 扫描服务端获准访问的目录，读取曲目标签和音频文件供客户端播放。NAS 共享须先挂载到服务器。 |
| 网易云音乐 | 扫码登录后可搜索歌曲、专辑、歌手和歌单，查看每日推荐歌曲，导入与同步歌单。可向已关联的可写歌单追加网易云曲目，按账号获准的音质播放或下载完整音轨。 |
| Bilibili（哔哩哔哩） | 无需 Bilibili 账号。用编号或链接播放、下载公开视频各分 P 的音轨和音频区曲目，也可预览、导入与同步公开收藏夹或音频歌单。 |
| QQ 音乐 | 已接入手机 QQ 扫码授权。曲目搜索已有服务端适配，Web 暂未开放此入口。 |
| Apple Music | 配置 Apple 开发者令牌后，可通过 MusicKit 授权并校验账号所在商店地区。目前仅支持账号接入。 |

网易云、QQ 音乐和 Apple Music 的登录流程，以及向网易云歌单追加歌曲，仍待真实账号完整验收。网易云的实际音质取决于账号权益和具体曲目。[在线音源说明](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/providers/online.md) · [平台账号与验收范围](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/providers/platform-login.md)

## 资料、音频与存储插件

| 用途 | 内置插件与能力 |
| --- | --- |
| 专辑与作品资料 | MusicBrainz、iTunes Search、Bangumi、网易云音乐和 QQ 音乐可查专辑、曲目表等资料。DLsite 可按 RJ 编号查作品、社团和封面。网易云和 QQ 的资料查询无需登录平台账号。 |
| 歌词与封面 | 本地插件读取内嵌歌词和封面、同名 LRC/TXT 歌词及同目录封面。网易云音乐、QQ 音乐和 LRCLIB 可补充歌词，Cover Art Archive 可按 MusicBrainz 发行版查封面。 |
| 录音识别 | 标准匹配插件为重复候选评分。配置 `fpcalc` 后可用 Chromaprint 提取音频指纹，另配 AcoustID 应用密钥可查询候选 MusicBrainz 录音。 |
| 格式与音效 | 配置 FFmpeg 和 ffprobe 后可探测格式、解码和转码。NCM 插件可读取本地 NCM 中的 MP3 或 FLAC。服务端音效可按需启用增益、参数均衡、压缩、混响和声道转换。 |
| 媒体与存储 | 可为 PNG/JPEG 封面生成缩略图。FLAC 写回默认关闭，管理员可授权在受支持的 Windows 本地 NTFS 卷上向 FLAC 文件写回歌词或封面。曲库默认使用 SQLite，也可配置 PostgreSQL。 |

官方插件随服务端构建，默认在主进程内运行。管理员可在「设置 → 插件管理」查看实例状态与配置。[内置插件目录](https://github.com/fnMrRice/MusicFS-server/tree/main/plugins) · [刮削插件与资料来源](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugins/provider-api-sources.md)

## 从源码运行

构建 Web 和 Server 需要 Git LFS、Go、Node.js 和 npm。版本要求与构建参数见[打包说明](docs/packaging.md)。

```sh
git lfs install
git clone --recurse-submodules https://github.com/fnMrRice/MusicFS.git
cd MusicFS
```

在主仓库根目录，按系统执行以下两条命令。

| 系统 | 构建 | 启动 |
| --- | --- | --- |
| Windows x64（PowerShell） | `./scripts/package.ps1` | `./deploy/musicfs-windows-amd64/start.bat` |
| Linux x64（Shell） | `sh scripts/package.sh` | `sh deploy/musicfs-linux-amd64/start.sh` |

打开 <http://127.0.0.1:8080>，用启动脚本生成的管理员令牌登录。进入 **设置 → 音乐源 → 本地音乐 → 添加本地目录**，从已授权的目录中选择音乐文件夹。保存后自动扫描，完成后即可在「曲目列表」点播。[首次登录、目录授权与音频工具](docs/packaging-start.md)

## 客户端与服务端

| 仓库 | 当前范围 |
| --- | --- |
| [MusicFS-server](https://github.com/fnMrRice/MusicFS-server) | Go 服务端、曲库、播放、插件与 API 协议 |
| [MusicFS-web](https://github.com/fnMrRice/MusicFS-web) | 浏览器端曲库与管理界面，可整理歌单、刮削资料、管理音源和后台任务，在播放时调节十段均衡器等本机音效。 |
| [MusicFS-android](https://github.com/fnMrRice/MusicFS-android) | 手机、平板和 Android TV 共用一个应用，支持局域网发现、后台播放、锁屏与耳机控制、电视遥控器操作。Android 14 及以上可向兼容 USB DAC 请求 bit-perfect 输出。 |
| [MusicFS-client](https://github.com/fnMrRice/MusicFS-client) | Rust 原生桌面播放器，提供迷你播放器、同步桌面歌词、系统媒体控制和托盘菜单。[各平台验证记录](https://github.com/fnMrRice/MusicFS-client/blob/main/docs/validation/desktop.md) |

本仓库记录各端的子模块版本，维护[跨端架构](docs/architecture.md)与[实施进度](docs/implementation.md)。本项目几乎完全由 AI 生成。[许可证（GPLv3）](LICENSE)
