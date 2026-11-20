# MusicFS

简体中文 · [English](docs/README.en.md)

MusicFS 是一个可自托管的音乐库。把存有音乐的目录添加到服务器，就能在浏览器里按曲目、歌手或专辑浏览和播放，整理歌单，为缺少资料的录音补上歌词、封面和曲目表。

![MusicFS Web 的曲目列表与正在播放的曲目](docs/screenshots/web-library.png)

*Web 曲库实拍，使用演示曲目和封面。*

## 可以用它做什么

- **整理音乐文件**。扫描本机目录或已挂载的网络共享，读取标签、内嵌封面和同名歌词文件。多份音源可以归到同一首歌，原文件保留在原处。
- **补全专辑资料**。按名称、编号或专辑链接查找发行版，预览曲目表、封面和其他字段后再选用。[刮削插件与资料来源](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugins/provider-api-sources.md)
- **播放和管理歌单**。浏览器可直接播放兼容音频，或由 Server 通过 FFmpeg 转换。在线来源按平台提供不同能力，例如导入 Bilibili 公开收藏夹并播放可用音轨。[在线来源](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/providers/online.md)

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
| [MusicFS-web](https://github.com/fnMrRice/MusicFS-web) | 浏览器端曲库、播放器、歌单和管理界面 |
| [MusicFS-android](https://github.com/fnMrRice/MusicFS-android) | 手机、平板和 Android TV 共用一个应用，可连接服务端、浏览曲库和播放音乐 |
| [MusicFS-client](https://github.com/fnMrRice/MusicFS-client) | Rust 原生桌面播放器，使用 egui/eframe 绘制曲库、迷你播放器和歌词窗口。[运行与验证](client/README.md) |

本仓库记录各端的子模块版本，维护[跨端架构](docs/architecture.md)与[实施进度](docs/implementation.md)。本项目几乎完全由 AI 生成。[许可证（GPLv3）](LICENSE)
