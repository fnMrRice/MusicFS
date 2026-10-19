# MusicFS

可自托管的音乐聚合系统，通过 Music Provider 统一管理本地音乐文件、挂载 NAS 与在线来源，提供音乐库、聚合歌单和播放；通过独立 Scraper 插件提供歌词/封面等信息的自动与手动刮削。

当前阶段：Go Server、Local Files/音频插件和最简 Web 已有本地播放实现，支持真实列表、授权原流、服务端处理播放和独立 NCM 解密插件。启动见[Server 运行说明](server/docs/running.md)，验证范围见[实施记录](server/docs/validation/progress.md)。本仓库仍只维护跨端架构与共同文档；程序和各步骤提交分别保存在独立 Server/Web 仓库，在线平台等长期设计尚未实现。

NCM 插件已接入本地扫描与播放，支持提取容器内的 MP3/FLAC；配置、限制和[手工验证步骤](server/docs/ncm.md#5-手工验证)集中在 [NCM 插件说明](server/docs/ncm.md)。独立 Worker、Server 回归和三项 Edge 联调已通过，证据见 [Web NCM 验证](web/docs/ncm-validation.md)；真实下载的 NCM 变体尚未验收。

Server 使用[版本化 YAML 配置](server/docs/configuration.md)，支持插件动态启停、能力变更通知和配置修订检查；Local Files 目录配置通过管理接口持久化，YAML 限定访问权限。内置插件统一分发并按角色独立启动，缺少必要配置时显示待配置；见[插件配置](server/docs/plugin-configuration.md)与[插件分发验证](server/docs/validation/plugin-bundle.md)。

## 本地打包与启动

在主仓库运行 `./scripts/package.ps1` 生成 Windows 64 位安装包，或运行 `sh scripts/package.sh` 生成 Linux 64 位安装包，默认输出到根目录 `deploy/`。组合包包含 Server、统一插件程序和 Web；解压后 Windows 双击 `start.bat`，Linux 运行 `sh ./start.sh`。已有锁定 Web 依赖可加 `-SkipInstall`；构建环境、参数和配置步骤见[打包说明](docs/packaging.md)与[启动说明](docs/packaging-start.md)。

## 实现计划

新增 [NFS/SMB NAS 插件设计](server/docs/nas-providers.md)与 [Bilibili 音频插件设计](server/docs/bilibili-provider.md)：B 站匿名访问优先，以收藏夹为主要歌单来源，并补充音频区独立歌单。当前仅完成设计与[增量实施计划](server/docs/implementation/nas-bilibili.md)，尚未实现；开源候选及采用边界见[参考记录](server/docs/provider-references.md)。

- [联合实施总览](docs/implementation.md)：P0—P8 顺序、共同 API 与验收场景。
- [Server 分阶段实施](server/docs/implementation.md)：工程基础、音乐库、原流与处理后播放、匹配、刮削、在线来源及交付。
- [Server 插件实施](server/docs/implementation/plugins.md)：Local Files、音频处理、独立 Scraper 和平台 Provider。
- [最小 Web 实施](web/docs/implementation.md)：真实列表、登录、播放控件、定位与浏览器验收。
- [桌面 React + Tauri 实施](client/docs/implementation.md)：Rust 原生播放、可安装插件、界面复用、三平台交付与 C0—C7 验收；尚未实现。

源码采用 `src/`，程序入口放 `src/app/`，实现模块放在 `src/` 对应目录，测试统一放各实现仓库根目录的 `tests/`。P3 首次完成本地文件经 Web 实际播放，P4 补齐服务端解码、DSP、编码/封装及定位；基本可用交付需通过 P4 与对应 P8 验收。桌面 Client 采用独立 C0—C7 计划，原生播放协议增量、动态插件及平台能力尚待实施验证。

## 设计文档

- [跨端架构设计](docs/architecture.md)
- [跨端插件边界](docs/plugin-boundaries.md)：Client 单进程动态库、Server 独立进程，以及可扩展范围与前置条件。
- [C++ 插件构建约定](docs/native-plugins.md)：需要 C++ 的插件统一 CMake/C++23，分别适配两端 SDK；设计待实施。
- [插件运行边界图](docs/diagrams/plugin-boundaries.puml)
- [前端 UI 设计草案](docs/ui-design.md)：共享布局、导航与用户菜单，待确认。
- [曲目列表页设计](docs/ui-tracks.md)：分类、筛选、排序、复选框与动态加载。
- [搜索页设计](docs/ui-search.md)：来源选择、曲目/专辑/歌手/歌单结果与动态加载。
- [跨端组件图](docs/diagrams/components.puml)
- [播放与来源回退](docs/diagrams/playback.puml)
- [Windows 启动与退出流程](docs/diagrams/windows-launch.puml)
- [Server 内部架构](server/docs/architecture.md)与[音频处理](server/docs/audio-processing.md)
- [Client 内部架构](client/docs/architecture.md)与[音频及插件](client/docs/audio-processing.md)
- [Web 设计](web/docs/design.md)
- [客户端线框](client/docs/prototypes/client.salt.puml)
- [连接、插件与歌词设置线框](client/docs/prototypes/settings.salt.puml)

图示使用 PlantUML，界面线框使用 PlantUML Salt；仓库保存可编辑源码。前端 UI 布局草案附有与源码一致的渲染图，其余图示以源码为准。

PNG、JPG、JPEG、WebP、GIF 图片使用 Git LFS 保存；克隆后需安装 Git LFS 并运行 `git lfs pull` 获取图片内容。PUML 与设计文档保留为普通可编辑文本。深色效果图为视觉草案，生成方式与提示词保存在同目录，不代表功能已经实现。

## 仓库分工

| 仓库 | 职责 |
| --- | --- |
| [MusicFS](.) | 跨端架构、协议语义与协作图示 |
| [MusicFS-server](server/) | 后端、来源/刮削/音频插件、存储、部署、OpenAPI 与事件协议 |
| [MusicFS-web](web/) | Web UI、能力探测、浏览器播放适配与内部设计 |
| [MusicFS-client](client/) | React/Tauri 桌面、Rust 原生播放器、主题/音频/外部控制插件、歌词窗口、本地启动器与内部设计；尚未实现 |

`client/`、`server/`、`web/` 是 Git 子模块，分别关联三个独立实现仓库。本仓库记录各子模块的提交版本，以便检出一致的完整工作区。所有仓库均为私有，克隆时需要有四个仓库的读取权限。

首次克隆并递归检出所有子模块：

```sh
git clone --recurse-submodules https://github.com/fnMrRice/MusicFS.git
```

已有主仓库工作区，或拉取了新的子模块版本后：

```sh
git submodule update --init --recursive
```

子模块默认检出主仓库记录的提交，可能处于 detached HEAD 状态；开发前需在对应子模块内切换到工作分支。实现改动先提交到对应仓库，再在主仓库提交更新后的子模块指针。发布时先推送子模块提交，再推送主仓库，确保其他开发者可以获取所记录的版本。

内部链接统一使用相对路径，跨仓库跳转以以上完整工作区布局为前提。本地递归检出子模块后即可跳转；GitHub 上的深层相对链接仍不能直接跨仓库解析，请通过子模块入口访问各实现仓库。

## 文档维护

先阅读[工作约定](AGENTS.md)。跨端协议和协作变更更新本仓库；Server、Client、Web 内部设计更新对应仓库。调整目录或文档入口时同步维护 README。文件移动、重命名使用 `git mv`，内部文档使用相对链接。

## 开源项目参考

在线平台插件计划参考下列项目；完整用途、许可证、核查日期和采用记录要求见 [Server README](server/README.md#开源项目参考)。目前仅作参考，尚未引入代码或验证平台播放能力。

| 平台 | 参考项目 |
| --- | --- |
| 网易云音乐 | [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) |
| QQ 音乐 | [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi) |
| Apple Music | [zachomedia/apple-music-webplayer](https://github.com/zachomedia/apple-music-webplayer)，MusicKit 浏览器集成示例 |

本地 NCM 解密另参考 MIT 项目 ncmdump-go 和 ncmdump.rs 的格式布局，以 Go 标准库重写。项目、许可证链接及采用范围见 [Server README 的 NCM 参考](server/README.md#本地-ncm-解密参考)；这些格式参考没有成为运行依赖。
