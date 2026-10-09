# MusicFS

可自托管的音乐聚合系统，通过 Music Provider 统一管理本地音乐文件、挂载 NAS 与在线来源，提供音乐库、聚合歌单和播放；通过独立 Scraper 插件提供歌词/封面等信息的自动与手动刮削。

当前阶段：架构设计与线框草案，尚无可运行实现。本仓库维护总体架构与共享设计文档。

## 设计文档

- [架构设计](docs/architecture.md)
- [组件图](docs/diagrams/components.puml)
- [播放与来源回退](docs/diagrams/playback.puml)
- [Windows 启动与退出流程](docs/diagrams/windows-launch.puml)
- [客户端线框](docs/prototypes/client.salt.puml)
- [连接与歌词设置线框](docs/prototypes/settings.salt.puml)

图示使用 PlantUML，界面线框使用 PlantUML Salt；仓库保存可编辑源码，当前未提供已验证的渲染图。

## 仓库分工

| 仓库 | 职责 |
| --- | --- |
| [MusicFS](https://github.com/fnMrRice/MusicFS) | 总体架构、共享设计、图示与线框 |
| [MusicFS-server](https://github.com/fnMrRice/MusicFS-server) | 后端、Provider、存储、部署、OpenAPI、事件协议与 SDK |
| [MusicFS-web](https://github.com/fnMrRice/MusicFS-web) | Web UI、浏览器播放适配器与可复用 UI 包 |
| [MusicFS-client](https://github.com/fnMrRice/MusicFS-client) | Tauri 桌面壳、桌面播放、歌词窗口与本地启动器 |

本地工作区可在根目录下分别检出 `client/`、`server/`、`web/`。三个目录由各自的 Git 仓库管理，已从本仓库忽略；克隆本仓库只获取共享设计文档，不会自动下载三个实现仓库。
