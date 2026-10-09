# MusicFS

可自托管的音乐聚合系统，通过 Music Provider 统一管理本地音乐文件、挂载 NAS 与在线来源，提供音乐库、聚合歌单和播放；通过独立 Scraper 插件提供歌词/封面等信息的自动与手动刮削。

当前阶段：Go Server、Local Files/音频插件和最简 Web 已有本地播放实现，支持真实列表、授权原流、服务端处理播放和独立 NCM 解密插件。启动见[Server 运行说明](server/docs/running.md)，验证范围见[实施记录](server/docs/validation/progress.md)。本仓库仍只维护跨端架构与共同文档；程序和各步骤提交分别保存在独立 Server/Web 仓库，在线平台等长期设计尚未实现。

NCM 插件已接入本地扫描与播放，支持提取容器内的 MP3/FLAC；配置、限制和[手工验证步骤](server/docs/ncm.md#5-手工验证)集中在 [NCM 插件说明](server/docs/ncm.md)。独立 Worker、Server 回归和三项 Edge 联调已通过，证据见 [Web NCM 验证](web/docs/ncm-validation.md)；真实下载的 NCM 变体尚未验收。

Server现使用[版本化YAML配置](server/docs/configuration.md)，配置读写服务支持修订检查、原子保存及恢复；旧JSON配置不兼容。保存配置与运行时应用分离，动态插件启停仍待后续实现；本轮证据见[配置验收](server/docs/validation/configuration.md)。

## 实现计划

- [联合实施总览](docs/implementation.md)：P0—P8 顺序、共同 API 与验收场景。
- [Server 分阶段实施](server/docs/implementation.md)：工程基础、音乐库、原流与处理后播放、匹配、刮削、在线来源及交付。
- [Server 插件实施](server/docs/implementation/plugins.md)：Local Files、音频处理、独立 Scraper 和平台 Provider。
- [最小 Web 实施](web/docs/implementation.md)：真实列表、登录、播放控件、定位与浏览器验收。

源码采用 `src/`，程序入口放 `src/app/`，实现模块放在 `src/` 对应目录，测试统一放各实现仓库根目录的 `tests/`。P3 首次完成本地文件经 Web 实际播放，P4 补齐服务端解码、DSP、编码/封装及定位；基本可用交付需通过 P4 与对应 P8 验收。桌面 Client 的实现不在本轮计划内。

## 设计文档

- [跨端架构设计](docs/architecture.md)
- [跨端组件图](docs/diagrams/components.puml)
- [播放与来源回退](docs/diagrams/playback.puml)
- [Windows 启动与退出流程](docs/diagrams/windows-launch.puml)
- [Server 内部架构](server/docs/architecture.md)与[音频处理](server/docs/audio-processing.md)
- [Client 内部架构](client/docs/architecture.md)与[音频及插件](client/docs/audio-processing.md)
- [Web 设计](web/docs/design.md)
- [客户端线框](client/docs/prototypes/client.salt.puml)
- [连接、插件与歌词设置线框](client/docs/prototypes/settings.salt.puml)

图示使用 PlantUML，界面线框使用 PlantUML Salt；仓库保存可编辑源码，当前未提供已验证的渲染图。

## 仓库分工

| 仓库 | 职责 |
| --- | --- |
| [MusicFS](.) | 跨端架构、协议语义与协作图示 |
| [MusicFS-server](server/) | 后端、来源/刮削/音频插件、存储、部署、OpenAPI 与事件协议 |
| [MusicFS-web](web/) | Web UI、能力探测、浏览器播放适配与内部设计 |
| [MusicFS-client](client/) | 原生播放器、主题/音频/外部控制插件、歌词窗口、本地启动器与桌面内部设计；UI 实现待定 |

本地工作区可在根目录下分别检出 `client/`、`server/`、`web/`。三个目录由各自的 Git 仓库管理，已从本仓库忽略；克隆本仓库只获取共享设计文档，不会自动下载三个实现仓库。

内部链接统一使用相对路径，跨仓库跳转以以上完整工作区布局为前提。在 GitHub 单个仓库页面中，相对路径不能跨越独立仓库；本地同时检出后即可跳转。

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
