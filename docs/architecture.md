# MusicFS 跨端架构设计

状态：共同架构 v0.7；2026-10-11。本文定义 Server 与桌面 Client / Web 之间共同遵守的职责边界、数据语义、协议和协作流程；长期目标不代表已全部实现。本次细化插件职责与 CMake/C++23 约定，确定 Client 原生插件在同一原生宿主进程内加载动态库；这些设计尚未实现。当前交付及平台限制见[实施总览](implementation.md)和各实现仓库的验证记录；NFS/SMB 与 Bilibili 仍为待实现设计。

## 1. 文档范围与仓库分工

单端实现细节由对应仓库维护。主目录不定义 Server 的数据库结构、扫描/刮削调度、插件内部接口，也不定义 Client 的播放器核心、主题、解码/DSP 或外部控制插件内部接口。

| 仓库 / 文档 | 负责内容 |
| --- | --- |
| 本文 | 跨端能力协商、身份和版本、API、播放恢复、生命周期与共同验收 |
| [Server 内部架构](../server/docs/architecture.md) | 音乐库、Music Provider、独立 Scraper、歌单同步、文件存储、任务、匹配与部署 |
| [Server 音频处理](../server/docs/audio-processing.md) | 解复用、解码、DSP、编码/封装插件与输出管理 |
| [Client 内部架构](../client/docs/architecture.md) | 桌面模块、插件宿主、播放器核心、窗口与本地启动器 |
| [Client 音频与插件](../client/docs/audio-processing.md) | WMF / FFmpeg 适配、主题、DSP、切歌淡化及外部控制 API 插件 |
| [跨端插件边界](plugin-boundaries.md) | 可插件化范围、两端执行方式、扩展前置条件与共同验收 |
| [C++ 插件构建约定](native-plugins.md) | 需要 C++ 的插件统一 CMake/C++23；C ABI、构建及制品验证 |
| [Web 设计](../web/docs/design.md) | 浏览器 UI、能力探测与浏览器播放适配 |

Local Files 的实际音乐目录、扫描默认值与监听设置由管理员接口维护，持久化到 Server 托管的插件配置数据库。未显式配置目录权限时，默认允许当前 Server 运行用户的 Music 目录，并兼容旧 YAML musicRoots 的授权；Windows 首次启用启动时还检查各逻辑磁盘根目录下的固定下载目录，将存在且可读的目录加入默认允许范围，结果持久化后不重复探测。发现目录只授予访问权限，不自动选择音乐目录或扫描入库。显式 YAML `permissions.readDirectories` 完整覆盖默认授权，空数组表示禁止访问。Web 在「本地音乐」标题右侧提供「管理目录」，标题下列出已选目录，空时显示「暂无已选择目录」。点击后直接打开目录树弹窗，以允许访问的目录为多个根，可展开并勾选根或子目录，也可取消已有选择。弹窗下方提供递归查找开关，启用递归默认深度为 0。默认折叠的高级选项包含深度限制、隐藏内容和 .nomedia 处理；勾选深度限制后可编辑数字，未限制或深度 0 表示查找全部子目录。默认跳过点开头及 Windows 隐藏文件、目录，并遵循 .nomedia 跳过其所在目录及子树。目录和递归选项一次保存，取消不改变原设置。待配置实例仍显示插件自述的「本地音乐」名称并可管理目录，保存不自动扫描。只有管理员目录浏览接口返回这些路径，普通来源与配置展示继续脱敏；Server 从授权根句柄相对打开目录，拒绝越界及链接逃逸。客户端沿用实例配置 API 和不透明修订，不直接访问插件数据库，具体路径和边界见 [Server 插件配置](../server/docs/plugin-configuration.md)。

Server 在自身 `docs/contracts` 维护 OpenAPI、事件 Schema 和带版本的协议 SDK；各运行端维护自己的插件 SDK。协议不依赖实现语言，插件二进制不承诺跨运行端通用。桌面已选择 React/TypeScript + Tauri 2 + Rust 原生核心，目标 Windows、macOS、Linux；音频与用户插件宿主独立于 UI，具体库和平台能力尚待验证。两个界面可按版本共享协议模型、资源及适用展示组件，浏览器播放器与原生核心分别实现。阶段与 Server 原生播放协商前置项见 [Client 实现方案](../client/docs/implementation.md)，这些桌面设计不改变现有线上协议，也不代表桌面已经交付。

内部文档使用相对链接，跨仓库链接依赖根目录下递归检出 `server/`、`client/`、`web/` 三个 Git 子模块的工作区布局；主仓库记录各子模块的提交版本。

当前 Server / 插件 / 最小 Web 的交付顺序与联合验收见[分阶段实施总览](implementation.md)。本文保持长期契约，具体模块和实现步骤由对应仓库维护。

Server 的 Go 插件协议与公共模型整理为独立 SDK 模块，仍由 Server 仓库维护；在线平台实现位于独立插件模块，网易云、QQ 音乐、Apple Music 提供独立程序，并有 `online/unified` 统一装配入口，宿主生产代码只依赖 SDK。插件实现按音乐源、数据库、解码、刮削、DSP 分类。Local Files、FFmpeg、NCM、本地 Scraper 保持统一程序、按角色独立启动进程；SQLite 和 DSP 使用各自入口。模块、发布兼容与旧配置迁移见 [Server SDK](../server/docs/plugin-sdk.md)，依赖关系见 [模块图](diagrams/server-plugin-sdk.puml)。自动发现、显式禁用和待配置状态见 [Server 配置](../server/docs/configuration.md#内置插件程序与自动发现)，界面不得将 `pending_configuration` 显示为已就绪。

Server 部署配置不指定实例 `role`；角色来自插件握手的 `Manifest.roles`，宿主校验后使用。名称与译名同样由插件声明，实例配置的可选 `name` 只表示管理员别名，示例与自动发现不预填名称。管理 API 的角色字段保持兼容。

Server 来源插件 ID 统一为 `musicfs.plugin.source.xxx`，解码与音频处理插件统一为 `musicfs.plugin.decoder.xxx`；本地歌词/封面插件保留 `musicfs.scraper.local`。每个插件必须在握手中提供显示别名 `plugin.name`、译名和 `supportsMultipleInstances` 声明，管理接口返回这些信息；本地音乐、FFmpeg 和 NCM 只允许一个配置实例，三个在线平台及本地歌词/封面插件支持多实例。插件实例使用稳定 UUID，与插件 ID 和显示别名分离；在线实例名称取当前已校验账号的用户名，未登录时回退插件别名。客户端按声明展示插件与账号，不以 UUID 作为标题。旧命名、UUID 迁移及配套升级要求见 [Server 插件身份与名称](../server/docs/plugin-identity.md)。

Server 插件和实例停用只保存配置，重启 Server 后生效；当前 Worker、任务、播放及新工作准入保持。启用和实例设置仍可动态应用。管理快照及操作的 `restartRequired` 与实例 `RESTART_REQUIRED` 原因区分保存意图和运行状态；待重启时 `effectiveEnabled` 按当前运行开关计算，`appliedRevision` 不推进至新修订。旧 `mode=drain/force` 仅兼容接受，不再排空或取消。客户端不得凭保存开关或操作 succeeded 宣称已经停用，见[Server 插件管理](../server/docs/implementation/plugin-management.md)。

Web 插件管理按插件显示名称、ID 和实际已知版本，各插件以横线分隔，展开后查看独立实例及状态；刷新按钮在“插件状态”标题右侧。登录插件的每个实例属于一个 MusicFS 用户，并独立承载一个平台账号；同一用户的不同平台账号也使用不同 UUID 实例。管理员默认查看自己的在线实例与共享实例，可勾选“显示所有用户实例”查看全部归属；此项只扩大管理员管理视图，不扩大平台账号的业务访问权限。具体管理字段、部署归属配置及兼容范围由 [Server 插件管理](../server/docs/implementation/plugin-management.md)维护。现有 MusicFS 登录入口仍仅创建管理员会话，实例归属能力不代表已交付一般用户注册与账号管理。

### 1.1 插件化决策与执行边界

2026-10-20 服务端增量：DSP 通过有序节点链和独立 Worker 扩展，首版限制无状态、固定格式/帧数、零延迟和无尾音；持久化通过受信任 Backend 契约替换，提供默认 SQLite 与独立 SQLite Worker。SQLite 属于必需存储后端，不能被禁用，不进入普通插件启停列表。Schema/迁移版本、事务语义和文件发布协调仍归 Server，后端执行原子操作与快照。两项为启动配置，公共播放描述报告实际 DSP 链并按链身份隔离缓存/恢复；旧 Web 可继续忽略新增可选节点参数。具体已实现范围见 [DSP 插件](../server/docs/dsp-plugins.md)和[存储插件](../server/docs/storage-plugins.md)。

可替换的来源适配、媒体算法、格式处理、外观与控制接入优先使用有版本的插件接口；身份、授权、状态所有权、事务发布和生命周期协调留在宿主。现有 C/S 架构支持这个方向，但“允许扩展”不代表“当前 SDK 已接受所有插件类型”：新增角色、NAS/在线音频资源通道及桌面播放协商须先补对应宿主契约，具体缺口见[跨端插件边界](plugin-boundaries.md)。

Client 原生插件统一在 Rust 原生宿主的同一进程内加载，Windows 为 DLL、macOS 为 dylib、Linux 为 so，不设置 PluginWorker、插件子进程或独立音频引擎进程。主题仍为声明式资源包。Client 不提供插件卸载，已加载库保留到进程退出；插件启用、停用、更新和回滚保存为期望设置，统一重启后生效，界面区分当前状态与下次启动状态。Tauri/WebView 自身可能使用系统辅助进程，这不改变原生插件的单进程约定。插件故障可能终止整个 Client，清单权限不是原生代码沙箱。

Server 保留独立进程插件，以已有版本化控制协议与受控二进制通道接入。需要 C++ 的插件与自有适配层统一用 CMake/C++23 开发；Client 通过版本化 C ABI 加载，Server 优先由 C++ 可执行插件对接现有 IPC。两端可复用算法源码，但独立构建、适配、发布和验收；不承诺共用 DLL，也不将现有 Go/Rust/TypeScript 实现统一改写为 C++。构建规范不代替各运行端 SDK。

## 2. 跨端职责与可见能力

Server 汇集本地音乐文件、已挂载 NAS 与在线平台来源，提供统一音乐库、歌单、来源选择和音频交付；Client / Web 负责展示、用户操作和播放。Local Files Provider 属于首版范围：这里的“本地”指 Server 可访问的文件系统，远程 Client 的本机路径不能直接交给远程 Server 读取。客户端上传或共享整首音频若需要，另行设计。

界面根据 Server 返回的实例与能力展示操作，不预设每个 Provider 都能搜索、扫描、登录、读取歌单或推荐歌单。网易云、QQ 音乐、Apple Music 是目标来源，这三个 Music Provider 插件必须提供对应平台的用户登录/授权能力；具体登录方式与推荐、播放、付费内容能力须逐平台验证。此项是交付要求，不代表已实现。推荐结果保留平台排序、来源、账号/匿名范围、有效期与分页状态；允许按来源分栏及部分失败。打开推荐项不自动加入用户歌单，用户选择导入或绑定后才进入歌单库；推荐列表变化不删除已导入歌单，也不触发远程写回。推荐可见不代表歌曲一定可播放。

音乐来源的插件身份、默认显示名、各语言译名和 `music-source` 功能由插件声明，Server 校验后传给客户端；Client / Web 不维护平台 ID 到名称或译名的固定映射。界面按当前语言选择插件译名，缺少匹配时使用插件默认名；插件 ID、实例 ID、管理员设置的实例别名和平台账号昵称保持独立语义，设置页的平台标题不拼接实例别名。本地来源与在线来源统一放在“音乐来源”区域，需要登录的插件在对应来源中提供账号操作。尚未取得有效声明时显示通用未知来源提示，不从实例编号推断平台名。当前协议字段及升级要求见 [Server 插件身份与名称](../server/docs/plugin-identity.md)；桌面 Client 尚无实现，后续须遵循该契约。

歌单导航在现有个人歌单下按来源增加“xxx 的歌单”，xxx 使用插件的当前语言显示名，列表通过对应插件的 `playlist.list` 能力读取已登录账号的歌单。只有插件成功返回至少一个可用歌单时才显示分类；加载中、空列表、未登录、离线、不支持或读取失败时不显示。平台退出或切换账号时清理旧分类与在途结果；浏览来源歌单不自动导入、同步或写回平台。

歌词、封面等内容由独立 Scraper 插件提供，自动与手动刮削共用候选/选用流程，不要求先启用在线 Music Provider。界面支持选择目标、插件和字段，调整查询、预览候选、逐字段选用、上传或编辑。预览不覆盖已发布内容，手动选用受修订检查并记录人工锁定；自动刷新不覆盖人工结果。取消或失败保留已发布内容，批量任务逐项显示结果。

客户端按受鉴权的对象引用读取歌词、封面等内容。默认不写原始音频，允许对经过授权且支持安全写入的本地/NAS 目录启用写回。手动刮削或上传不自动开启写回；写回成功后歌曲身份和歌单关联保持，音频文件资产版本更新。独立内容文件的存储、匹配、写入和恢复机制见 Server 文档。

### 2.1 在线平台账号登录

登录与业务接口优先参考开源项目中已验证的模拟客户端方式，采用相应客户端的请求路径、参数、加密/签名、设备标识及会话机制，不以仅修改 User-Agent 代替客户端适配。按平台和接口逐项验证；客户端方式不可用时可采用已验证的 Web / 官方 SDK 方式，并记录原因、参考版本和限制。具体接入与证据见 [Server 平台账号登录](../server/docs/platform-login.md)。

网易云、QQ 音乐、Apple Music 都是必须登录的在线源。除实例发现、能力说明和登录/退出控制面外，搜索、资料、推荐、歌单预览、导入、同步及播放请求都要求对应实例具有已校验的平台账号；未登录、过期或重启后尚未校验时拒绝业务访问，不回退到匿名接口或旧缓存。请求使用本实例账号会话，缓存与分页游标绑定账号及登录代次。

平台登录是用户登录网易云、QQ 音乐或 Apple Music 自己的账号，与访问 MusicFS Server 的 `/auth/session` 是两套独立状态。登录 MusicFS 不表示已登录任何音乐平台；三个平台分别登录、重新授权和退出，互不代替。Local Files 等无需账号的 Provider 不受此要求影响。

- 插件负责适配对应平台的登录/授权流程、账号状态校验及平台允许的会话续期；Client / Web 提供交互入口，Server 管理用户与 Provider 实例的账号绑定。扫码、跳转授权或其他方式仅在对应插件和运行端验证支持后展示，不预设三个平台采用相同流程。
- 登录交互须支持发起、等待用户操作、完成、取消、超时及失败；账号状态区分未登录、已登录、已过期/需重新授权。登录挑战绑定发起用户与实例并有有效期，取消或过期后的回调不能重新绑定账号。
- 账号与私有数据按 MusicFS 用户、Provider 实例和平台账号隔离。登录后刷新可用能力与权限；登录成功不代表拥有会员、付费内容或完整音频播放权限。Apple Music 的用户授权与播放接入须分别验证，不能据登录成功推断可由 Server 获取或处理裸流。
- 平台凭据仅交给必要的受控授权流程及对应插件使用，服务端托管凭据不回传普通界面，不写入日志、普通配置导出或 Git。账号视图可附带平台显示名与可选头像地址；缺少头像时客户端显示默认头像，旧 Web 可忽略新增可选字段。严格解码的 Server Host 与 Worker 须配套升级；头像地址的校验与图片来源限制由 Server 契约维护，不将显示名或头像当作账号身份。若平台授权必须在客户端 SDK 中完成，其令牌范围、保管和传递方式需在实现契约中单独验证，不向其他插件共享。
- “退出平台账号”解除 MusicFS 中该平台账号的授权使用并清理所托管凭据；上游撤销能力按平台实际支持报告，不宣称退出平台其他设备。阻止该账号后续请求并失效私有缓存及相关播放授权，保留已导入的歌单和音乐库记录并更新可用性。MusicFS 会话退出不等同于解除平台绑定。

登录 API、事件与插件 SDK 的精确字段由 Server 仓库维护，并同步评估 Client / Web 兼容性；本节只定义共同需求。每个平台均须有真实账号的登录、重启后状态校验、失效后重新授权、取消/超时、退出和跨用户隔离验收，匿名访问或手工预置凭据不能替代用户登录功能验收。

### 2.2 NAS 直连与 Bilibili 音频增量

新增 NFS、SMB 两个独立 NAS Music Provider 的设计，直接连接管理员授权的 NAS 共享/export；已挂载 NAS 继续由 Local Files 提供，三种方式不自动合并或迁移来源。首批只读扫描、元数据和播放，NAS 凭据与端点仅由 Server 管理；客户端只访问受鉴权的音乐库与播放地址。离线、扫描不完整或共享身份改变时保留已有曲目与歌单，不当作空库。协议版本和安全选项须分别实测，详见 [NAS Provider 设计](../server/docs/nas-providers.md)。

Bilibili Provider 以公开内容匿名读取/播放为基础，登录是私有或受限功能的可选授权，不是启用插件的条件；MusicFS 自身鉴权仍然必需。B 站收藏夹为主要远程歌单来源，音频区独立歌单作为补充；两类均可预览、显式导入或绑定同步，保留来源类型、顺序、权限和全部出处，不向平台自动写回。公开视频音轨按分 P 建立曲目，音频区曲目使用独立身份；收藏夹展开分 P 的策略由用户预览确认并保存在绑定修订中。

公开视频、公开收藏夹、音频区曲目/歌单及账号功能分别声明能力并验收；音频区暂不可用不影响已验证的视频/收藏夹能力。B 站不沿用第 2.1 节三个音乐平台的强制账号交付前置要求；若接入账号，仍遵循该节的用户隔离、授权失效及退出语义。账号失效、集合转私有或分页不完整不能发布空歌单覆盖旧快照。详见 [Bilibili 设计](../server/docs/bilibili-provider.md)。

NAS 与 B 站音频统一进入 SourceTrack/SourceAsset、播放协商与恢复流程，不向客户端泄露 NAS 路径/凭据或短期 CDN 授权头。分 P 序号、标题、元数据摘要和播放 URL 不是固定资产版本证据；无法证明固定字节表示时不能宣告稳定 Range 或拼接旧偏移。SDK、资源通道和在线资产建档仍需扩展，实施顺序见 [NAS / Bilibili 增量计划](../server/docs/implementation/nas-bilibili.md)。

## 3. 共同身份与版本语义

以下是 API 暴露的数据语义，不是数据库表设计。

| 标识 / 对象 | 跨端约定 |
| --- | --- |
| Recording | 某个录音版本的内部标识；Live、Remix、翻唱分别处理，不以歌名 + 歌手作唯一键 |
| SourceTrack | 某 Provider 实例下的来源曲目，保留出处与可用性；未匹配到 Recording 也可播放 |
| SourceAsset | 来源曲目某个音质的具体字节版本；内容改变产生新版本，不能静默替换活动播放资源 |
| 匹配证据 | 码率属于具体资产；SHA-512 表示完整文件字节摘要；音频指纹辅助发现相似音频候选；三者均不能单独证明跨源时间轴兼容 |
| PlaylistEntry / provenance | 稳定条目标识及全部来源出处；聚合展示行不作为持久身份 |
| revision | 歌单、选择或规则的修订；分页固定同一修订，编辑携带预期修订 |
| MediaObject / selection | 歌词、封面等不可变内容对象与当前选择；返回受鉴权引用、版本、来源和适用范围，不返回 Server 磁盘路径 |
| PlaybackSession | 用户、设备与播放目标上下文；会话不能代替具体资源版本 |
| attemptId / representationId | 一次播放尝试及其固定输出表示；源资产、处理配置、输出格式或生成起点改变时返回新标识和新地址 |

Server 返回的资产信息可包含 codec、container、durationMs、bitrateBps、bitrateMode、fileSizeBytes、fileSha512 及探测状态。未知值为 null；码率单位 bit/s；已校验的完整文件 SHA-512 在协议中表示为 128 个小写十六进制字符。Provider 申报值与 Server 计算值区分展示，未知摘要不阻止播放。文件不同、码率不同或摘要不同不直接等同于不同 Recording；人工关联与禁止关联优先于自动建议。具体探测、摘要、指纹提取及证据管理见 [Server 内部架构](../server/docs/architecture.md)。

NCM 的 SourceAsset 仍标识原始加密容器，文件大小、摘要与版本属于原文件；解密出的 MP3/FLAC 是独立播放表示，不覆盖源资产。解密表示使用自己的长度、验证器与 representationId；客户端的 Range 面向该表示，不能沿用加密文件的字节偏移。

## 4. API 与事件草案

业务路由前缀 `/api/v1`。错误包含 `code/message/requestId/retryAfter`，绝对时间采用 UTC ISO 8601，曲目位置和持续时间使用毫秒，列表使用游标。下面保留共同目标中的 API 族；已经交付的精确路径、字段、能力与错误码以 [Server OpenAPI](../server/docs/contracts/openapi.yaml) 为准，不能由草案路由推断接口存在。事件 Schema 不等于已实现 WebSocket 推送。

| 路由 | 共同语义 |
| --- | --- |
| GET /health/live、/health/ready | 存活/就绪及必要的 MusicFS 身份、协议版本和 instanceId；就绪不代替授权握手 |
| POST /auth/session、GET /auth/session、DELETE /auth/session | 最小 Web 的凭据交换、会话恢复与退出；流使用同源会话授权 |
| GET /providers、/provider-instances | 用户可访问的 Music Provider 实例、能力及账号状态 |
| GET /scrapers、/scraper-instances | 独立刮削插件、实例、能力及状态 |
| POST /provider-instances/{id}/scan-jobs | 触发授权本地/NAS 来源的扫描，返回 jobId |
| GET /scan-jobs/{id} | 扫描状态、进度、完整性、错误、执行次数、下次重试时间与上次成功时间；retry_wait等待服务端调度，paused需要处理原因后显式重提 |
| GET /source-tracks | 用户可见来源曲目，按实例过滤与固定 libraryRevision 游标分页 |
| GET /search?q=...&cursor=... | 按来源部分成功，候选关联不强制折叠 |
| GET /recordings/{id}/sources | 可选来源、音质信息与当前用户可用性 |
| GET /recommendations | 当前可用的匿名推荐聚合，保留实例出处、部分失败、有效期和stale状态；账号能力另行声明 |
| POST/GET /playlists、GET/PUT /playlists/{id} | 本人歌单及有序聚合规则，整体编辑携带预期规则修订 |
| POST /playlists/{id}/rebuild、GET /playlists/{id}/snapshots/{revision} | 生成聚合快照并按固定修订分页，保留所有出处 |
| GET/POST /playlists/{id}/hidden-rules、PUT /playlists/{id}/hidden-rules/{ruleId} | 持久隐藏意图、修订更新与扩大目标时的显式确认 |
| POST/GET /remote-playlists、POST /remote-playlists/{id}/sync-jobs | 导入远程绑定、显式创建同步任务；请求成功不等于快照已发布 |
| GET /remote-playlist-sync-jobs/{id}、GET /remote-playlists/{id}/snapshots/{revision} | 同步状态、保守移除及固定历史快照 |
| GET /source-tracks/{id}/media | 歌词/封面版本、来源、语言、时序适用范围与当前选择 |
| GET /media/{objectId} | 鉴权后读取文件内容 |
| POST /metadata-jobs、GET /metadata-jobs/{id} | 创建刮削/预览任务；读取进度、逐目标状态、候选及预览引用 |
| POST /metadata-candidates/{id}/apply、/metadata-jobs/{id}/cancel | 按目标修订应用选用结果，或取消未完成工作 |
| POST /media | 上传/编辑生成新的内容对象，不直接替换当前选择 |
| PUT /source-tracks/{id}/media-selection | 按预期修订选择内容并记录人工锁定 |
| POST /metadata-write-jobs | 按既有授权配置、预期资产版本申请写入原文件，返回任务状态 |
| POST /playback/sessions | 提交 recordingId/sourceTrackId、偏好和客户端能力，返回播放描述 |
| DELETE /playback/sessions/{id} | 幂等停止本人会话并释放资源 |
| POST /playback/sessions/{id}/recover | 提交 attemptId、可观察故障和 positionMs 曲目时间，取得恢复描述或明确的用户操作要求 |
| GET /playback/recovery-profile、POST /timeline-evidence、GET /timeline-evidence/{id} | 获取处理配置及创建/读取人工时间对齐证据；撤销使用POST /timeline-evidence/{id}/revoke |
| POST /playback/sessions/{id}/recover-source | 对当前attempt申请指定目标来源，证据适用时continue，否则promptRestart；不按指纹相似度自动推导偏移 |
| POST /playback/sessions/{id}/seek | 对 timeRestart 输出提交 attemptId、positionMs，返回新尝试和新输出地址 |
| GET /playback/sessions/{id}/attempts/{attemptId}/stream | 鉴权交付该次尝试的固定表示；客户端使用返回的 streamUrl，不自行拼接 |
| GET /events | 已实现 SSE 能力变更通知；其他任务、歌单和会话事件仍为后续范围 |
| GET /lifecycle、POST /lifecycle/leases及续租/释放子路径 | 本地鉴权的启动归属与多客户端租约；仅client-managed模式自动收尾，不代表桌面启动器已经实现 |

创建任务、会话及可能重试的播放控制请求支持 `Idempotency-Key`；seek/recover 必须校验请求所属尝试，过期请求不能覆盖较新的播放状态。采用 `If-Match` 的修订检查失败返回 412，其他业务状态冲突使用明确的 409 错误。当前 SSE 的事件类型为 `capabilities.changed`，数据含 `revision/sequence`；首连与重连通知客户端重新读取授权来源与能力。事件不是唯一事实来源，也不包含管理员配置或凭据。其他事件的字段在 Server 交付时定义。Provider 账号无权限、来源暂不可用、客户端不支持和任务失败应分别呈现。

最小 Web 首次登录用显式 Bearer 凭据和允许的 Origin 校验，取得 HttpOnly 会话 Cookie 与 CSRF token；登录后的状态修改（包括退出）校验会话 CSRF 和 Origin。原生 audio 通过同源 Cookie 访问授权流，无需把凭据放入 URL。详细边界见[联合实施契约](implementation.md#33-同源连接与会话)。

## 5. 播放协商、定位与恢复

Client / Web 上报实际可用的 codec、container、MIME、传输方式、定位能力及请求的处理效果。Server 选择可交付的来源与输出：兼容且无需处理时直接播放或字节代理；需要兼容处理或 DSP 时使用 Server 插件链输出。浏览器和桌面原生播放器分别协商，不预设浏览器格式支持，也不把桌面音频绑定到某个 UI 框架。

NCM 由 Server 的独立 `audio.decrypt` 插件解除外层容器，保留内部编码字节；纯解密交付为 `proxy`，需要兼容转码或用户请求 DSP 时再进入处理链并返回 `processed`。`effectiveProcessing` 的 `ncmDecrypt` 项标明服务端解密，不能据此宣称应用了增益等 DSP。插件控制面使用版本化 JSON-RPC/stdio，只传任务与资源描述；音频正文走独立、受任务授权约束的私有二进制通道，由 Server 管理取消与回收。Client / Web 只访问 Server 返回的受鉴权播放地址，不直接连接插件数据通道。配置、协议和已验证范围见 [Server NCM 插件](../server/docs/ncm.md)，不由本节扩大其他格式或平台的实现范围。

| 播放描述字段 | 语义 |
| --- | --- |
| attemptId、assetId、representationId | 固定本次输入与输出的版本身份 |
| deliveryMode、streamUrl、expiresAt | direct / proxy / processed，短期限定权限的地址及有效期 |
| outputProfile | codec、container、MIME、传输方式、采样率、声道和适用的码率配置 |
| effectiveProcessing | 实际生效的处理链、参数版本与执行端；同一效果不能在两端重复应用 |
| seekMode、seekableRange、positionOriginMs | byteRange / timeRestart / none；以毫秒表示可定位的曲目时间范围及输出起点映射 |
| timeline、resumeDecision | 已验证的资产间时间映射引用/版本与可自动续播、需从头播放或不可用的决定 |

本地/NAS 或需要私密请求头的来源由 Server 交付。直放地址必须允许客户端访问且不泄露账号凭据；短期播放授权仍须限制用户、资源、用途和有效期。原始字节代理只声明实际具备的 Range 能力，上游不支持时不伪造 206。处理后输出不继承原文件的字节偏移、长度或验证器；byteRange 只适用于稳定且可随机访问的输出表示。

timeRestart 定位通过时间请求重新生成输出，客户端加载新的 streamUrl，按 positionOriginMs 和时间映射显示曲目进度；不能把原文件字节偏移应用到转码流。客户端忽略旧歌曲/会话的返回；同会话 seek/recover 串行执行，先确认在途操作返回的 attemptId，再执行合并后的最新定位意图。取消 HTTP 不等于撤销已发生的服务端变更，结果不明通过同键有界重试确定；细则见[联合实施契约](implementation.md#32-播放描述与客户端状态)。处理配置变化也必须协商新表示。同源输出重建在曲目时间到新输出的映射已验证且可定位时恢复，不要求该 SourceTrack 已关联 Recording；资产内容变化则必须重新验证时间关系。

播放失败时客户端报告 attemptId、观察到的错误与曲目时间，Server 决定有限的同源刷新或换源。浏览器不必识别上游 URL 过期的具体 HTTP 原因。恢复同时限制同源刷新次数、不同来源数（最多 3 个）及总时间预算；同次故障的重复请求不能不断重置预算。

跨源自动续播须同时满足：确认同一 Recording；具有绑定两端资产版本且覆盖目标位置的独立时间轴兼容证据；目标输出及处理链支持所需定位。证据需处理前导静音、裁切、编码延迟等差异；同名、相近时长、相同 Recording 或音频指纹相似均不能单独满足条件。满足条件则返回新尝试和新地址，客户端清理旧缓冲并按映射重载，允许短暂中断；条件不满足或定位失败则提示从头播放，用户可取消，不猜测进度。新表示不能续接旧 Range；同源刷新若复用字节状态也须先验证资源未变。

歌词随当前来源与版本重新选择，时序不兼容时不能沿用旧歌词位置；用户配置的歌词偏移单独保留。Client 的本机转场只在桌面输出端执行，具体行为见 [Client 音频设计](../client/docs/audio-processing.md)。详见 [跨端播放时序](diagrams/playback.puml)。

## 6. 歌单与任务的一致性

聚合歌单默认按 binding 顺序和子歌单原顺序合并，已确认同一 Recording 去重，未知来源按 SourceTrack 去重，并保留全部出处。移除一个来源贡献不删除仍有其他出处的条目。界面按固定 revision 分页，使用预期修订编辑；旧任务不得覆盖新发布状态。

远程歌单不提供一致快照版本时，分页完整也不能证明缺失项已删除。Server 先将其标记疑似移除，经后续完整同步或独立查询复核后移除贡献；Client / Web 显示同步中、疑似移除、stale、lastSuccessAt 和失败原因。失败或不完整同步保留上次有效内容，NAS 离线不清空音乐库。

隐藏默认针对整首 Recording 的全部来源，也允许只隐藏某个 binding/原 entryId 对应的出处。隐藏绑定持久身份，不绑定重建的展示行；未匹配条目先按 SourceTrack 保存意图，后续关联/拆分也应保留用户原始目标，无法唯一确定时提示确认。隐藏和聚合编辑只修改本地规则，不自动写回远程平台；循环歌单引用应明确报错。内部快照、代次及恢复实现见 Server 文档。

## 7. 本地连接、退出与升级协作

| 连接模式 | 跨端行为 |
| --- | --- |
| managed-local | Client 可启动配套 Server；可连接已经运行的兼容实例，但不能改变其原始启动归属 |
| external-local / service | 只连接本机独立部署的 Server，不自动启动、提权或接管服务 |
| remote | 连接指定远程 Server，不启动本机 Server |

连接须验证 MusicFS 实例身份、协议兼容性并完成授权握手，不能只看 HTTP 200；端口冲突及不兼容版本应显示明确状态。多个 Client 并发启动不能产生多个占用同一数据目录的 Server。客户端启动器内部实现见 [Client 内部架构](../client/docs/architecture.md)。

Server 保留实际启动归属并维护经鉴权的 Client 租约。随 Client 启动的实例在最后一个有效租约释放后优雅退出；Client 崩溃由租约超时处理，启动后始终未建立租约的失败启动也应有界回收。独立启动的实例保持运行，不因 Client 连接/退出改变归属。停机收尾须让客户端能够看到状态，并对新的连接/租约作明确接受或拒绝，避免新 Client 误接入即将退出的实例；持久化和写任务收尾细节见 Server 文档。

升级 managed-local Server 需协调所有活动 Client、优雅停机、数据迁移准备与新版就绪；失败保留可恢复入口，不直接覆盖运行中的程序。不兼容的独立 Server 由其部署方式管理升级，Client 仅提示，不能自动停止或接管。详见 [Windows 连接与生命周期](diagrams/windows-launch.puml)。

## 8. 共同权限与验收

用户只看到自己可访问的来源、歌单、内容对象和会话；共享录音元数据不能暴露其他用户的私人文件。客户端及无关插件不获得服务端托管的 Provider / Scraper 账号密钥；平台要求的客户端授权流程遵循第 2.1 节的最小范围约定。歌曲引用或本地控制请求也不能跳过 Server 授权。面向浏览器的连接采用明确的来源许可与适当的会话保护，远程访问配置鉴权和安全传输，日志不得泄露带授权的 URL 或请求头。

跨端验收按以下顺序推进；单端技术选型、插件接口与内部验证清单在各仓库维护。

1. 本地/NAS 来源发现、音乐库展示、固定修订歌单和原流播放；未知码率/摘要也能按权限播放。
2. 独立 Scraper 的预览、人工选用、上传/编辑与歌词/封面读取；默认原文件不变，显式安全写回后来源身份和歌单仍有效。
3. 在线来源按平台分阶段交付；网易云、QQ 音乐、Apple Music 插件各自必须通过第 2.1 节的平台账号登录验收，不能以一个平台通过替代另外两个。推荐能力单独验证；聚合多出处、保守移除、隐藏和凭据失效状态一致。独立在线 Scraper 分别验收，不依赖在线 Provider 同时上线。
4. NFS、SMB 各自完成真实 NAS 扫描、播放、定位、离线恢复与根身份变化验收；Bilibili 分别验证免登录视频音轨、公开收藏夹、多 P 展开和音频区曲目/独立歌单，可选私有功能另验账号隔离。不得以挂载 NAS 或一个 B 站端点成功代替全部插件验收。
5. Server 处理输出在真实 Web 环境播放和按时间定位，桌面原生能力单独协商；DSP 不重复，跨源无法证明时间轴兼容时提示重播。
6. 多 Client 启停、崩溃租约回收、独立 Server 保持运行、remote 无本机启动，以及不兼容版本的可恢复升级流程。

[跨端组件图](diagrams/components.puml) 展示交互边界；桌面线框与本机插件细节见 [Client 设计入口](../client/docs/design.md)。Server 与最简 Web 的当前实现范围见[实施记录](../server/docs/validation/progress.md)，本文保留长期架构，不将设计中的全部功能视为已实现。图示仍保留 PlantUML / Salt 源码，尚无已验证的渲染图。
