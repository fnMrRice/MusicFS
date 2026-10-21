# C++ 插件构建与边界约定

状态：开发规范与待实施设计；2026-10-21。本规范适用于需要 C++ 的 MusicFS 自有插件和原生适配层，尚未提供可发布的 C++ SDK、样例工程或经过验证的平台制品。Server 当前官方 Go 内置插件运行在主进程；未来 C++ 内置实现遵守同一约束。Client/Server 精确接口由各自仓库拥有，本文件不声明新的公共符号或 wire 方法已存在。

## 1. 适用范围和产物

需要 C++ 的插件统一使用 **CMake + C++23**。Rust、Go 和声明式主题继续按既定路线开发，不因插件化统一改写。FFmpeg 等第三方 C/C++ 库可保留上游构建方式，但依赖版本、选项、制品和调用适配必须可复现。

| 消费方 | C++ 产物 | 接入方式 |
| --- | --- | --- |
| Client Rust 原生宿主 | Windows DLL、macOS dylib、Linux so | 宿主直接加载版本化 C ABI，在同一原生进程运行，不派生插件 worker |
| Server 官方内置实现 | 按 OS/CPU 构建并链接的算法库及受控原生适配 | 必须在 Server 主进程执行；Go 与 C++ 桥接、C ABI 和所有权契约尚待实现与验证 |
| Server 显式外部插件 | 按 OS/CPU 构建的可执行插件 | 仅在显式进程模式使用[现有控制协议](../server/docs/contracts/plugins/v1/README.md)及受授权数据通道；新 ID/角色先完成宿主注册与接口增量 |
| 两端共用算法源码 | 同版本源码或静态库，分别构建 | 分别链接到 Client 动态库、Server 内置桥接或显式外部插件；入口、SDK、配置及发行清单独立 |

不把 Go 动态插件机制当 C++ DLL 装载器，也不承诺已支持任意本机库加载。Server 官方内置实现通过编译时受信任装配运行，未来 C++ 桥接应先定义并验证接口；不能为内置实现隐式增加插件进程。显式外部插件若组合动态库，同样使用明确 ABI。FFmpeg、ffprobe、fpcalc 作为受控外部工具运行不属于新增插件宿主。Client 不使用可执行插件、插件守护进程或独立音频引擎进程。

## 2. CMake 和工具链基线

项目规范下限选择 CMake 3.25，便于统一 Presets schema 6；这是项目基线，具体编译器适配可能要求更高版本，发行时记录并固定确切版本。CMake 对 `CXX_STANDARD=23` 的识别自 3.20 起存在，识别标准号不代表编译器或标准库完整实现 C++23。[CXX_STANDARD 官方说明](https://cmake.org/cmake/help/latest/prop_tgt/CXX_STANDARD.html)、[Presets 3.25](https://cmake.org/cmake/help/v3.25/manual/cmake-presets.7.html)

每个自有 C++ target 必须指定 `cxx_std_23`、`CXX_STANDARD 23`、`CXX_STANDARD_REQUIRED ON` 与 `CXX_EXTENSIONS OFF`；不支持时配置/编译失败，不静默退到 C++20。不用全局 `CXX_FLAGS` 手工拼接冲突的 `-std` 或 `/std`，不向纯 C ABI 消费者传播 C++ 模板或标准库依赖。

以下仅示意目标设置；文件名、SDK target 与导出宏需在相应实施仓库建立后才可构建：

```cmake
cmake_minimum_required(VERSION 3.25)
project(MusicFSNativeExample LANGUAGES C CXX)

function(musicfs_require_cpp23 target)
  target_compile_features(${target} PRIVATE cxx_std_23)
  set_target_properties(${target} PROPERTIES
    CXX_STANDARD 23
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF)
endfunction()

# Client dynamic library; SDK export macros expose only the C entry point.
add_library(musicfs_client_gain SHARED src/plugins/gain/plugin.cpp)
musicfs_require_cpp23(musicfs_client_gain)
set_target_properties(musicfs_client_gain PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN YES)

# Server 内置算法库；主进程桥接与 ABI 需另行实现和验证。
add_library(musicfs_server_gain STATIC src/plugins/gain/algorithm.cpp)
musicfs_require_cpp23(musicfs_server_gain)

# 外部进程入口仅作为显式选择，默认不构建。
option(MUSICFS_BUILD_SERVER_PROCESS_PLUGIN "Build external process plugin" OFF)
if(MUSICFS_BUILD_SERVER_PROCESS_PLUGIN)
  add_executable(musicfs_server_gain_process src/app/gain_main.cpp)
  musicfs_require_cpp23(musicfs_server_gain_process)
endif()

include(CTest)
# Add real ABI, protocol and audio tests before publishing either target.
```

Client 动态库采用 `SHARED` 目标，显式导出 SDK 入口；Windows 不使用“导出全部符号”代替接口定义。链接到动态库的自有静态算法库也设置 C++23 和必要的 PIC；测试目标遵守同一工具链。目标名/文件名不是插件 ID，清单必须记录实际相对路径。[CMake 库目标](https://cmake.org/cmake/help/latest/command/add_library.html)

`cxx_std_23` 要求至少支持对应标准模式，不能保证某项标准库功能可用。对实际使用的特性以特性宏、配置探针和真实目标编译/链接共同确认；不能只读取 `__cplusplus` 就宣告全部兼容。标准库、ABI、运行库和平台 SDK 必须同编译器一起验证。[编译特性](https://cmake.org/cmake/help/latest/manual/cmake-compile-features.7.html)、[配置探针](https://cmake.org/cmake/help/latest/module/CheckCXXSourceCompiles.html)

## 3. 可复现工程与依赖

每个实现仓库独立拥有 CMake 入口、`CMakePresets.json`、依赖锁定记录和测试。可共享版本化工具文件/算法包，不在发布构建中隐式读取另一个子模块的工作区源码。布局沿用 `src/app/` 放可执行入口、`src/plugins/` 放插件实现、`tests/` 集中测试；此处为计划位置，不要求立即创建空目录。

- `CMakePresets.json` 保存无机密的 configure/build/test 组合；开发者绝对路径放不提交的 `CMakeUserPresets.json`。同一组合绑定生成器、target、工具链和配置，构建目录彼此隔离。
- 使用仓库锁定的 CMake、编译器及依赖。新编译器若旧 CMake 无法正确选择 C++23 模式，应升级并验证 CMake 基线，不以手改标准标志掩盖不兼容。
- 交叉编译通过 toolchain 文件指定 sysroot、目标编译器与查找规则。配置探针的成功不证明目标平台能运行；运行验证使用真实目标或明确记录的测试执行器。[工具链说明](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html)
- 依赖固定版本/提交及下载摘要，记录许可证、构建选项和是否随包分发。禁止依赖开发机偶然存在的 PATH、系统 FFmpeg 或未记录动态库，也不默认启用第三方库的全部组件。
- Client 清单列出运行依赖和受控搜索位置；私有依赖避免同名冲突，加载器不能把当前目录或任意可写搜索路径当可信来源。同进程多插件同时装载须验证依赖版本冲突，无法共存时拒绝组合。
- `cmake --install` 只把清单列明的运行制品写入暂存目录，再校验并打包；不把构建缓存、测试凭据、调试私钥或整份开发目录复制到插件包。

实施后至少提供以下命令对应的真实 preset，文档中的 `<preset>` 是待定义名称，不是当前可执行命令：

```sh
cmake --preset <configure-preset>
cmake --build --preset <build-preset>
ctest --preset <test-preset> --output-on-failure
cmake --install <build-directory> --config Release --prefix <staging-directory>
```

多配置生成器的 build/test/install 配置必须一致，不能用 Debug 测试结果替代 Release 插件验收。记录 `CTest` 实际测试数与失败数，零测试不算通过。[CTest](https://cmake.org/cmake/help/latest/module/CTest.html)

## 4. Client 动态库的 C ABI

C++23 是插件内部实现标准，外部接口使用版本化 C ABI；不能跨编译器 C++ ABI 传类或直接把 Rust 对象交给 C++。SDK 需冻结以下内容后再发布首个插件：

| 项目 | 必须明确的契约 |
| --- | --- |
| 查询入口 | 带版本的 `extern "C"` 导出、显式调用约定、可见性及入口名；通过查询获取函数表与能力 |
| 结构布局 | 固定宽度整数、字节长度、UTF-8 文本、不透明句柄；结构大小/版本、对齐及保留字段有明确定义，Rust 绑定匹配 C 布局 |
| 扩展 | 主 ABI 不兼容拒绝；次版本仅按长度/能力协商可选函数，读取/写入不越过对方声明的结构或缓冲范围 |
| 所有权 | 借用、复制、转移和释放方逐参数定义；分配方提供释放函数，异步持有必须取得显式租约 |
| 错误 | 稳定错误码与有界英文诊断，业务代码独立于文本；C++ 异常在 C++ 边界转换，Rust panic 在自身允许的边界处理 |
| 并发 | 可调用线程、可重入性、同实例并行许可、回调期限和取消方法明确；业务调用默认按实例串行，取消使用宿主令牌或声明可并发且非阻塞的专用入口，不争用被阻塞业务占用的锁；实时音频回调不等待插件控制操作 |
| 数据面 | PCM 帧数、格式、声道布局、采样率、时间基准和缓冲容量显式传递；有界队列，不能把内存指针当持久 ID |

禁止 STL、C++ 虚表、Rust `Vec/String`、`FILE*` 或未声明的分配器跨边界；`/MD` 等运行库设置也不等于允许任意跨 DLL 释放。[CRT 对象跨 DLL 的限制](https://learn.microsoft.com/en-us/cpp/c-runtime-library/potential-errors-passing-crt-objects-across-dll-boundaries?view=msvc-170)

`catch_unwind` 不用于捕获 C++ 异常，`try/catch` 不提供对访问违例、堆损坏、`abort` 或进程崩溃的可靠恢复。原生插件与宿主共享地址空间及进程权限，属于受信任代码；API 权限检查与包校验不能构成 OS 沙箱。[Rust FFI 与 unwind](https://doc.rust-lang.org/nomicon/ffi.html#ffi-and-unwinding)

Windows `DllMain` 及全局构造/析构保持最小，不做阻塞等待、复杂初始化或装载其他插件。实际初始化、注册、停止和资源释放走显式 SDK 函数；其他平台同样避免依赖不可控的全局初始化顺序。元数据校验在加载前完成，ABI 查询发生在加载后；动态库加载本身可能执行初始化代码，不能宣称握手前绝无代码执行。[DLL 最佳实践](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)

## 5. 调用与重启生效

Client 装载库后由 Plugin Host 强持有库句柄和函数表直到原生宿主进程退出，包括加载后才发现 ABI 不兼容的库；不提供运行中 `FreeLibrary` / `dlclose` 路径，也不提供插件包卸载/删除功能。图和异步任务持有实例/缓冲租约，调用结果绑定装载代次和播放/任务代次；拒绝旧代次结果只防止状态污染，不能证明内存已经无人访问。

插件启用（含首次安装）、停用、更新和回滚均保存为下次启动的期望开关/版本；当前已应用状态保持到退出，UI 显示当前状态、下次启动状态和重启提示。重启后按最新配置加载，停用插件不加载；用户重启前再次修改设置以最后成功保存的修订为准。插件正常失败造成能力不可用是运行故障，不等同于设置已提前生效。

普通停止播放、seek/换图仍取消任务并回收不再使用的实例与缓冲，但不卸载插件库。正常退出应用时关闭新业务准入，发出合作取消，等待在途调用、线程、回调和租约结束，再销毁实例；库映射由进程退出回收。收尾仍保留取消与必要完成回调，取消不争用阻塞业务占用的锁；仅收到取消确认或超时不能提前释放可能仍被访问的内存。

超时表示实例故障或待重启，不代表已终止其代码。禁止强杀插件线程；无法证明实例/缓冲安全释放时保留必要资源并停止向故障实例提交新工作。若卡死或内存破坏已经影响宿主，不能承诺 UI、播放或正常退出仍可用。库保留到进程退出不能替代正确的任务/实例所有权。

Client 新版本保存到独立目录，更新/回滚统一在下次启动切换，不做原生热更新。活动文件不原位覆盖，保留旧包与配置快照；配置迁移失败不把新格式交给旧库。新库加载后若初始化失败，记录失败并通过后续重启恢复旧版本，不在本次进程内追加版本热切换。已启用插件内部的效果参数/主题资源选择可按对应能力调整，这不改变插件启停或活动包版本。

启动故障记录只保存必要的包/版本/阶段，不假定最近加载的插件必然是崩溃原因。重复启动失败提供禁用非必需用户原生插件的恢复入口；重新启用逐项执行。恢复入口能处理下次启动，并非本次进程中的崩溃隔离。

Server 保持自身[插件管理契约](../server/docs/plugins/plugin-management.md)，配置重建、任务取消和退出时收尾上下文、请求、租约和数据通道。内置实现共享主进程，取消是协作，超时不能证明插件代码已停止；崩溃或内存破坏可能影响整个服务，不能强杀插件线程。只有显式外部模式收尾插件进程。外部 C++ Worker 的 stdout 仅输出协议帧，英文日志写 stderr；控制面不用 C ABI 内存布局、指针、JSON/Base64 音频或未经协商的 RPC。

## 6. 支持矩阵与交付证据

| 验证维度 | 记录内容与完成门槛 |
| --- | --- |
| 平台 | OS/CPU、最低系统、工具链目标、SDK/运行库、链接方式；Client 按 Windows/macOS/Linux 独立验收，Server 按自身发行矩阵验收 |
| 标准与构建 | 固定 CMake/编译器/标准库版本、C++23 模式、实际使用的语言/库特性；缺失即阻止该 target 发布 |
| Client ABI | C/Rust 绑定布局、导出、错误版本、缺函数、缺依赖、实际 DSP 输出、实例/缓冲取消与释放、库持有至退出；启停/更新/回滚当前与下次启动状态一致 |
| Server 原生边界 | 内置桥接须验证 ABI、所有权、取消和宿主集成；显式外部模式另验 framing/Schema、握手、权限、资源通道和进程回收，不能只有 C++ 自测 |
| 音频 | 非零定位、格式转换、延迟/尾音、欠载、背压、连续切歌及时间轴；以宿主集成与真实输出验证 |
| 制品 | 从干净机器加载/启动，非 ASCII/空格路径、Release 依赖和最低系统；文件摘要、来源、依赖清单与测试记录一致 |
| 故障 | Client 原生和 Server 内置插件都按共享宿主故障边界验证下次启动恢复；Server 仅对显式外部模式检查子进程回收，不能相互替代 |

编译通过不等于支持所有 C++23 功能、媒体格式或插件组合。最小编译器版本由上述实测确定；例如 MSVC 标准模式及预览状态需按采用版本核对，不能把浮动 `latest` 模式当稳定发行约定。[MSVC 标准模式](https://learn.microsoft.com/en-us/cpp/build/reference/std-specify-language-standard-version?view=msvc-170)

本规范的构建命令与示例尚未进行本项目的实际编译/加载验收。各实现仓库在取得证据后补版本矩阵、测试结果和剩余限制；主仓库只维护共同规则与对应子模块提交版本。
