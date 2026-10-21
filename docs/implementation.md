# MusicFS 分阶段实施总览

平台账号增量已接入 Server / Worker / Web，三个在线源统一要求平台登录，网易云查询迁移至带会话的 EAPI、QQ 搜索迁移至桌面 RPC；网易云、QQ 二维码创建实测通过，完整用户授权与 Apple 实号登录待验收，详见[平台登录说明](../server/docs/providers/platform-login.md)。下文原阶段交付状态不包含此待验收增量。

Server 当前范围包括本地/NCM 播放、识别、媒体与受限写回、账号资料接口、推荐、歌单及人工时间对齐恢复，以及备份、安装和生命周期协议。专题说明见[文档导航](../server/docs/README.md)，剩余验证见[待验收清单](../server/docs/validation/README.md)与[Web 兼容记录](../web/docs/compatibility.md)。平台真实账号仍待验收，完整在线音频尚未实现；下文阶段编号仅用于说明交付依赖。

后续授权的本地 NCM 插件已完成独立解密、扫描及最简 Web 接入，沿用既有鉴权与播放协议；参考来源、配置和验收边界见 [NCM 插件说明](../server/docs/playback/ncm.md)。该增量不代表网易云在线 Provider 或账号功能已经实现。

[YAML 配置](../server/docs/operations/configuration.md)支持严格校验、修订保存与恢复，旧 JSON 配置不兼容；普通插件可动态启用和应用设置，停用保存后重启生效，详见[插件管理](../server/docs/plugins/plugin-management.md)。

## 1. 本期范围与阅读入口

2026-10-11 插件设计增量：按[跨端插件边界](plugin-boundaries.md)优先拆分可替换能力；Client 原生插件采用单进程动态库，Server 保留独立插件进程。需要 C++ 的插件使用 [CMake/C++23](native-plugins.md)。新增接口与各平台制品仍需实施验证，不能由本文推断插件种类已全部开放；本增量不改写下文历史阶段记录。

桌面新增独立的 [React + Tauri 实现方案](../client/docs/implementation.md)：React/TypeScript 界面、Rust 原生播放和可安装插件，按 C0—C7 验证 Windows/macOS/Linux；当前全部待实施。现有 Server 的 `htmlAudio` 能力与传输模型需先增加兼容的原生协商，精确变更由 Server 维护，详见 [Client 接入前置项](../client/docs/implementation/server-integration.md)。该增量不重写下文 Server/Web 历史 P0—P8 验收状态。

新增设计增量：[NAS / Bilibili 插件实施计划](../server/docs/design/nas-bilibili.md)，全部待实现。NFS/SMB 原生直连分别交付；B 站按匿名公开视频与公开收藏夹优先，补充音频区曲目/独立歌单，再接入可选账号与私有收藏夹。此增量不改变历史 P0—P8 完成记录，也不将平台登录作为匿名播放前置条件。

Server 已确定使用 Go。源码采用用户指定布局：各实现仓库的 `src/` 放源码，`src/app/` 放程序入口，其余模块按职责放在 `src/` 下；`tests/` 集中放测试。这是项目选择的布局，不声称它是 Go 唯一标准。语言和工具仍遵循 Go module、包导入、测试发现等规则。

| 文档 | 维护范围 |
| --- | --- |
| [跨端架构](architecture.md) | 长期共同约束；实现计划不得放宽身份、授权和恢复规则 |
| [文档导航](../server/docs/README.md) | Go 工程、配置、存储、任务、扫描、流交付与后续能力 |
| [Server 插件实施](../server/docs/plugins/plugin-architecture.md) | 插件协议、宿主、Local Files、音频处理、Scraper 与平台适配 |
| [Web 实施](../web/docs/implementation.md) | 文件列表、原生播放控件和最小错误/定位交互 |
| [Client 实施](../client/docs/implementation.md) | React/Tauri 工程、原生核心、动态插件、平台集成与独立 C0—C7 验收 |

桌面 Client 的工程、主题、原生输出、WMF、桌面歌词和本地启动器不属于下文历史 Server/Web 阶段，改由独立 C0—C7 计划实施。下文“最小 Web 不建设搜索推荐门户、歌单编辑器、刮削管理台或视觉设计系统”仅描述原阶段范围；后续 React 界面及实际状态见 Web 自身记录。

## 2. 阶段、依赖与完成定义

| 阶段 | Server / 插件成果 | Web 配合 | 出阶段证据 |
| --- | --- | --- | --- |
| P0 工程与契约 | Go module、指定目录、协议 Schema、测试样本、构建约定 | 最小页面和类型/接口约定 | 空工程可构建，契约与样本一致；还不能宣称可播放 |
| P1 服务基础 | 配置、日志、鉴权、SQLite 迁移、持久任务 | 登录会话和统一错误 | 真实服务可启动、重启，未授权请求受拒绝 |
| P2 插件与音乐库 | 宿主、Local Files、扫描、稳定曲目身份、列表分页 | 展示真实扫描结果 | 目录变化和失挂可区分，列表不依赖伪造数据 |
| P3 原流播放 | 固定播放尝试、授权流、真实 Range、停止/回收 | 列表点播、播放/暂停、原流定位 | 浏览器播放真实本地文件，含非起点定位与切歌 |
| P4 处理后播放 | FFmpeg 适配、PCM DSP、编码/封装、timeRestart、资源限制 | 按处理描述重载、曲目时间定位 | 原格式不兼容的测试文件也能播放，DSP 和定位均有证据 |
| P5 资产识别 | 码率补全、SHA-512、指纹候选、人工关联与排除 | 展示仍保留未知值，基础播放继续 | 变更不会复用旧证据；不误把相似指纹当续播凭证 |
| P6 补充信息 | 独立 Scraper、文件内容存储、手动/自动选用、可选写回 | 可用 API/测试客户端验收，不强加管理界面 | 正文不入 DB，默认原音乐不变，选用和恢复一致 |
| P7 在线与聚合 | 网易云、QQ 音乐、Apple Music 各自的平台账号登录/授权、分平台能力验证、推荐、歌单同步、保守删除、隐藏、恢复 | 提供平台账号登录交互与状态；能播放的来源仍走共同协议，平台特有播放器另评估 | 三个平台分别验收登录、重新授权、退出和账号隔离；聚合、权限与失败语义正确 |
| P8 交付 | Windows/Linux 包、容器、备份恢复、兼容报告 | 独立静态制品与实机浏览器验收 | 从空数据目录完成安装、扫描和播放，重启恢复通过 |

阶段顺序为 `P0 → P1 → P2 → P3 → P4`；P5、P6、P7 在相关基础满足后可分支开发，P8 验收所声称支持的阶段。P3 是第一次可播放里程碑；本期基本可用交付至少通过 P4 及对应 P8 子集。不能把模拟列表、HTTP 200、生成整个文件后才可播放或只有播放器时间增长当成完整播放验证。

每个步骤记录状态、对应提交、自动测试、人工验收和限制；完成一项后再补证据，不预先勾选。下列阶段是完整目标，不代表相关所有子场景都已通过。P5—P7 不阻塞首个可播放版本，仍保留完整任务，不承诺已支持所有平台。

P7 平台账号登录为明确交付要求，当前匿名能力不满足该要求。这里登录的是网易云、QQ 音乐、Apple Music 的用户账号，与 P1 的 MusicFS Server 登录独立；共同职责和验收见[平台账号登录](architecture.md#21-在线平台账号登录)。当前已接入登录适配、账号 API、Worker 扩展及 Web 设置页，实号授权验收尚未完成；新增协议和验证边界见[平台登录说明](../server/docs/providers/platform-login.md)，尚无账号事件推送。

## 3. 最小联合契约

业务前缀为 `/api/v1`。Server 的 `docs/contracts/` 已保存机器可验证的定义；下表是共同契约，实现与能力范围以各端验证记录为准。

| API | 首次需要 | 请求和响应要点 |
| --- | --- | --- |
| GET /health/ready | P1 | product、instanceId、apiVersion、ready；仅就绪不等于已登录 |
| POST /auth/session | P1 | 以 Authorization Bearer 提交管理员引导凭据，交换 HttpOnly 会话 Cookie 与 csrfToken |
| GET /auth/session | P1 | 当前用户、权限、csrfToken、有效期；未登录 401 |
| DELETE /auth/session | P1 | 撤销当前会话及关联授权；带 CSRF 校验 |
| GET /provider-instances | P2 | 当前用户可见实例的 id、名称、角色能力、可用性和账号状态，以及插件导入选项声明、默认值和授权根编号/显示名；不返回凭据/磁盘根路径 |
| POST /provider-instances/{id}/scan-jobs | P2 | mode=full/incremental、schemaRevision、选中的 rootIds 和 options；返回 jobId，仅相同完整计划的活动任务合并，浅层扫描不对范围外曲目做缺失对账 |
| GET /scan-jobs/{id} | P2 | 状态、进度、完整性、错误、执行/重试次数、下次执行时间、该计划的lastSuccessAt，以及rootIds、schemaRevision和归一后的effectiveOptions；paused是需要处理原因后重提的终态，retry_wait由服务端有限调度 |
| GET /source-tracks | P2 | providerInstanceId、limit、cursor；返回 items、nextCursor、libraryRevision |
| POST /playback/sessions | P3 | sourceTrackId、偏好、终端能力；返回 sessionId 与播放描述 |
| DELETE /playback/sessions/{id} | P3 | 幂等停止；禁止其他用户关闭会话，释放资源 |
| GET /playback/sessions/{id}/attempts/{attemptId}/stream | P3 | 使用返回的 opaque streamUrl；支持 Cookie、HEAD 及已声明的 Range |
| POST /playback/sessions/{id}/seek | P4 | attemptId、positionMs、Idempotency-Key；timeRestart 返回新尝试/地址 |
| POST /playback/sessions/{id}/recover | P3/P4 | attemptId、可观察错误、positionMs、Idempotency-Key；按已实现能力恢复或明确报错 |

P3的recover处理同源情况；P7新增独立recover-source，并要求当前授权、同Recording、两端固定资产及适用的时间证据。缺少证据返回明确重新播放提示，不伪造跨来源续播。P5—P7的匹配、内容、歌单与推荐已在[Server OpenAPI](../server/docs/contracts/openapi.yaml)补齐本期精确路径；最简Web仍只消费列表与播放，不因Server接口增加而扩成管理台。

P8的[生命周期协议](../server/docs/operations/lifecycle.md)由测试客户端验证Server行为，桌面进程启动器仍未实现。[完整备份恢复](../server/docs/operations/backup.md)和[安装制品](../server/docs/operations/deployment.md)保留实际Windows/WSL证据及未测环境，不能将容器样例、非零PCM或交叉编译分别当成Docker运行、人工听音或目标系统执行。

### 3.1 文件列表

条目至少包含 sourceTrackId、providerInstanceId、displayName、title、artists、durationMs、codec、container、bitrateBps、availability、assetId；metadata/asset 尚未探测完成允许 null。路径仅可返回经选择的展示名称，不返回 Server 的磁盘绝对路径。浏览器按标识请求播放，不能把列表项拼接成文件 URL。

排序采用稳定规则加 sourceTrackId 消除同名歧义。首请求固定 libraryRevision；cursor 绑定用户、实例过滤、排序和修订。扫描完成发布新修订不会改变已有分页。快照已回收返回明确的 `CURSOR_EXPIRED`，Web 清空当前分页再刷新，不把新旧修订拼接。列表读取来自已发布的持久音乐库，不在每个 HTTP 请求中扫描磁盘。

### 3.2 播放描述与客户端状态

描述至少覆盖：sessionId、attemptId、assetId、representationId、deliveryMode、outputProfile、streamUrl、expiresAt、seekMode、seekableRange、positionOriginMs、effectiveProcessing、resumeDecision。绝对时间为 UTC ISO 8601，时长/曲目位置为毫秒。outputProfile 记录 codec、container、MIME 和传输方式；尚未知的属性不得伪造。

切歌代次与同曲定位意图分别管理。切歌或停止废弃旧会话，晚响应不能改变新歌状态；对仍活动的同一会话，seek/recover 共用串行控制队列，最多一个请求在途，连续定位只保留最新待执行目标。在途操作返回后，即使已有更新目标，也先记录它返回的当前 attemptId，再以该标识发起下一次操作；可以跳过中间输出的播放，不能丢弃已生效的控制状态。

每次新操作使用独立 Idempotency-Key，同一操作的网络重试使用原键。中止 fetch 不代表服务端撤销；结果不明先以原键有界重试确定结果，仍不能确认则停止自动控制并提供重新播放入口，不能盲用旧 attemptId 发起新操作。Server 同时串行化会话变更，校验预期 attemptId，重放幂等结果并拒绝冲突。幂等记录的有效期必须覆盖声明的重试窗口，过期结果明确要求重建。

同源输入/输出完全未变的授权刷新可保留尝试；更换表示、参数或生成起点必须新尝试、新地址。同源同资产且输出时间关系已验证的重建不要求 Recording；跨源续播仍需共同架构规定的三项证据。不得拼接不同文件字节，也不得在新的转码片段上设置原文件的字节偏移。

byteRange 仅用于真正可随机访问的稳定表示。timeRestart 通过 POST seek 返回新起点，Web 加载新流并使用映射展示曲目位置；原生 audio 的片段进度条不等于完整曲目定位器，可增加一个简单的曲目时间输入。未验证定位的中间版本只能声明 none，且不能通过 P4 完整验收。

### 3.3 同源连接与会话

开发时通过 Web 开发服务器代理 `/api`；交付时以反向代理把静态页面和 API 放在同一来源。Server 可提供可选的 `--web-root` 读取已构建静态制品，便于本机验收；Web 源码不因此进入 Server Git 仓库。

最小界面允许一个简单凭据输入框。引导凭据来自显式配置或管理命令，不出现在普通服务日志、页面地址或浏览器持久存储。首次 POST /auth/session 尚无会话 CSRF，使用显式 Bearer 凭据并严格检查允许的 Origin；不能要求先持有登录后才取得的 CSRF。登录后使用 HttpOnly、SameSite=Strict 会话 Cookie；HTTPS 使用 Secure，loopback HTTP 开发例外必须显式限制。此后的状态修改（包括退出）使用会话 CSRF token 并验证 Origin，身份与流资源仍按用户/会话授权。

原生 audio 请求不能依赖 JavaScript 设置自定义 Authorization 头；streamUrl 在本期为可用会话 Cookie 访问的同源地址。地址虽不可预测也不等于获得授权。不要把整首歌 fetch 为 Blob 绕过流鉴权，不通过通配 CORS 解决开发代理问题。

## 4. 联合验收场景

| 编号 | 输入 / 操作 | 应看到的结果 |
| --- | --- | --- |
| E2E-01 | 空数据目录启动，登录，扫描测试目录 | 页面显示真实文件；重启后无需重新扫描才能列出已入库内容 |
| E2E-02 | P3 已验证格式，点击播放、暂停、恢复、定位到中段 | 声音及进度正确，网络确为流式读取，定位走有效 Range |
| E2E-03 | 连续快速切换 A/B/A，取消旧请求 | 最终只播放最新选择，无旧音频突然恢复 |
| E2E-04 | 不支持直放的合法测试音频，要求 Server DSP | 返回处理描述，处理后有声播放，DSP 改变可测且未改原文件 |
| E2E-05 | P4 定位到非零位置，再迅速定位第二次 | 新 attempt/URL 生效，显示曲目时间，晚响应不倒退 |
| E2E-06 | 会话失效、文件消失、NAS 失挂、FFmpeg 缺失 | 显示可理解状态，无无限重试或清空音乐库 |
| E2E-07 | 使用另一用户/会话访问已知 streamUrl 或媒体对象 | 请求被拒绝，不泄露磁盘路径和凭据 |
| E2E-08 | 浏览器关闭/停止后观察服务 | 空闲宽限期后无无主处理进程、无限缓存增长或卡住的任务 |
| NAS-01/02/03 | 原生 SMB / NFS 分别扫描播放，断线、重连与替换共享 | 无误清库、越权或跨版本续流；已有挂载 NAS 路径仍可用 |
| BILI-01/02 | 不预置 B 站账号，打开公开视频与公开收藏夹 | 匿名音轨可播，分 P 展开可预览，导入/同步保留顺序及出处 |
| BILI-03 | 音频区曲目与超过一页的独立歌单 | 单独验证播放、完整分页、重复/失效项；不可用不影响收藏夹 |
| BILI-04 / REMOTE-01 | 私有收藏夹、凭据过期、跨用户引用与停用 | 明确权限状态，保留旧快照，取消清理无秘密泄露 |

使用项目生成或授权可分发的短音频，包含可识别的不同时间段/声道标记、静音前缀及损坏样本。记录输入摘要、期望内容、生成参数和许可。真实浏览器人工试听与输出片段检查共同验证声音和定位，自动测试负责状态、权限、取消和协议边界。至少明确验证 Windows 上的实际浏览器，以及 Linux Server 部署；不将自动化浏览器所带 codec 当全部用户环境。

## 5. 协作、阶段扩展与参考

Server 核心、插件和 Web 使用本表阶段编号；各自文档进一步用 S-Px-步骤、PL-Px-步骤、W阶段.步骤 标识任务。共享协议变动先更新契约和本文，再同步两端消费者；内部组织调整留在本端文档。未实现功能应返回明确的能力/错误，不能用空成功响应代替。

平台接口可参考现有开源实现。具体项目、许可证、核查状态和用途见 [Server README 参考清单](../server/README.md)；参考不等于已成为依赖或已通过平台联调。Apple Music 等需区分目录/用户数据 API 与官方播放器授权，不能假定能经 Server 获取裸流并处理。

工程组织依据 [Go module 文档](https://go.dev/doc/modules/layout)和[测试工具文档](https://pkg.go.dev/testing)；本项目具体目录以用户指定结构及各端实施文档为准。
