# MusicFS

可自托管的音乐聚合系统，通过 Music Provider 统一管理本地音乐文件、挂载 NAS 与在线来源，提供音乐库、聚合歌单和播放；通过独立 Scraper 插件提供歌词/封面等信息的自动与手动刮削。

当前阶段：架构设计与线框草案，尚无可运行实现。本仓库只维护 Server 与客户端共同遵守的架构和协议约定；单端内部设计放在各自仓库。

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
