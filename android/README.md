# MusicFS Android 客户端

本目录是 MusicFS 的 Kotlin 原生 Android 工程。手机、平板和 TV 使用 `:main` 应用，Wear OS 使用可单独安装的 `:wear` 应用。两个应用复用连接和播放模块，各设备直接访问 MusicFS Server。桌面客户端位于 [client/](../client/README.md)。

## 构建

在 Android Studio 打开本目录，安装 Android SDK Platform 37 和对应构建工具。使用 JDK 21，Gradle Wrapper 与依赖版本已锁定。在本目录运行：

```powershell
.\gradlew.bat :main:assembleDebug :wear:assembleDebug
```

macOS 和 Linux 可运行 `sh ./gradlew :main:assembleDebug :wear:assembleDebug`。APK 分别位于 `src/app/main/build/outputs/apk/debug/main-debug.apk` 和 `src/app/wear/build/outputs/apk/debug/wear-debug.apk`。将主 APK 安装在手机、平板或 Android TV，将手表 APK 安装在 Wear OS 设备。两个应用使用同一应用 ID。

## 连接与播放

1. 启动包含 `nativeHttp` 播放协商的 MusicFS Server，使用设备可达且系统信任其证书的 HTTPS 地址，并在 Server 的 `allowedOrigins` 中添加该地址的来源（协议、域名及端口）。
2. 在手机、平板、TV 或手表打开 MusicFS。位于同一局域网时，从附近服务器列表选择实例，或手动填写 HTTPS 地址和端口。核对地址后输入引导凭据并连接。每台设备单独登录，本版会话仅保存在进程内。
3. 从授权曲库点选曲目。播放服务通过 WebSocket 创建会话，再经受鉴权的 HTTP 流交给本机 Media3 解码。手机和平板根据窗口宽度排列曲库与播放控件，TV 使用方向键和确认键，手表可直接通过 Wi-Fi 或蜂窝网络选曲，并向耳机输出。

局域网发现使用 mDNS/DNS-SD。Server 的 `discovery.enabled` 默认开启；需要监听局域网的 HTTPS 端口，并在 `allowedOrigins` 中配置客户端可访问且证书匹配的来源。只监听 `127.0.0.1` 时不会发布。多个域名共用同一端口时，可用 `discovery.origin` 指定要显示的地址。跨子网或使用蜂窝网络时，可直接填写可达地址。[Server 配置示例](../server/docs/operations/running.md#在局域网发现-server)

Android 31 与独立 Wear OS 30 模拟器均已验证服务出现、点击回填和手动登录。手表直接登录后能读取测试曲库，未连接耳机时显示连接输出设备的提示；蓝牙耳机实际出声仍需实机验收。

界面使用 Jetpack Compose、Material 3 和 Wear Compose。连接复用 OkHttp，播放复用 Media3 ExoPlayer、MediaSessionService 及 Media3 的 OkHttp 数据源。版本见[依赖目录](gradle/libs.versions.toml)。

本版提供分页曲库、点播、暂停、继续、切歌与后台服务。已在 Android 31 模拟器上通过 HTTPS 登录隔离的 MusicFS Server，读取曲库并播放、暂停授权 WAV。旋转到宽屏后，曲库和播放控件分栏并保留暂停状态。显式启动 TV 入口后，方向键可以从刷新按钮移动到曲目，确认键可启动播放。完整歌单和队列、定位、故障续播及进程退出后的恢复列入后续设计。硬件音频路由和其他设备场景见[设备验收](docs/device-experiences.md)。

- [Android 架构设计](docs/architecture.md)说明构建目标、共享模块、本机播放服务和实施顺序。
- [设备交互与验收](docs/device-experiences.md)说明触屏布局、电视遥控器和手表独立播放的操作路径。
- [Server 接入与播放](docs/server-playback.md)说明现有协议、原生协商前置项和联调场景。
