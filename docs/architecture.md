# MusicFS 架构设计
状态：设计草案 v0.2；2026-10-09。本文由 MusicFS 总项目仓库维护，是三个实现仓库的架构事实来源，未实现的功能不得描述为已完成。

## 1. 目标与边界
MusicFS 是可自托管的音乐聚合系统。Server 通过 Provider 接入本地/NAS 与在线平台，管理统一音乐库及聚合歌单；Web 与桌面 Client 展示并播放。桌面端优先 Tauri，提供桌面歌词、皮肤与 Windows 本地 Server 启动。
Server 同时负责音乐信息刮削，包括歌词、封面及来源允许获取的专辑等信息。歌词、封面等内容保存为独立目录中的文件，数据库仅保存索引与关联；默认不修改原始音频，允许显式配置将选定内容写入本地/NAS 原始音频文件。
网易云、QQ 音乐是目标 Provider，并非已验证可用的接口。接入可行性、登录方式、播放与歌单能力须分别验证；平台账号权限、接口变动、付费歌曲可用性由 Provider 显式返回，不承诺全量支持。
第一版不做微服务、多语言插件运行时、双向平台歌单写回、云端账号共享或默认转码。

## 2. 仓库与协议所有权
| 仓库 | 职责 |
| --- | --- |
| MusicFS | 总体架构、共享设计、图示与线框 |
| MusicFS-server | 核心、Provider SDK、数据库迁移、部署、OpenAPI 与事件协议 |
| MusicFS-web | 浏览器 UI、浏览器播放适配器、皮肤、消费生成的 SDK |
| MusicFS-client | Tauri 壳、桌面播放适配器、歌词窗口、启动器、桌面打包 |
Server 的 docs/contracts 后续存放 OpenAPI 与 JSON Schema，发布带版本的客户端 SDK。Web 发布可复用 UI 包，Client 固定版本依赖它，而非运行时依赖在线 Web 站点。桌面发行包内嵌 UI，避免 UI 代码在两仓库复制。
协议独立于实现语言。建议评估 Rust Server + SQLite、TypeScript UI 和 Tauri Rust 宿主；Server 语言与前端框架仍待技术验证。不采用跨编译器 C++ ABI 作为第三方插件协议。

## 3. 模块
API Gateway：鉴权、请求校验、分页、幂等、统一错误。
Library：规范化元数据、录音版本、文件资产、码率与 SHA-512 匹配证据、候选关联、人工关联与禁止关联。
Metadata Enrichment：歌词/封面等信息刮削、来源与版本匹配、人工选择与覆盖、受配置控制的原文件标签写入。
Playlist：本地歌单、远程快照、聚合规则、快照版本与来源追溯。
Resolver：按用户配置筛选账号权限、可用性、音质、来源优先级，创建短期播放会话。
Provider Host：能力声明、账号上下文、取消、限流、超时、错误映射。
Scheduler：NAS 扫描、后台文件探测与 SHA-512 计算、刮削与标签写入任务、远程同步、退避重试、恢复任务、并发控制。
Stream Gateway：本地文件/远程字节流转发、Range、会话鉴权、过期刷新；默认不解码。
Storage：SQLite WAL、单写入队列、Media Store 独立文件目录与可重建缓存；数据库不存歌词正文、封面或其他文件内容，账号密钥独立保护。
详见 [组件图](diagrams/components.puml)。

## 4. 核心实体
| 实体 | 标识与语义 |
| --- | --- |
| Recording | 内部 UUID；某个录音版本，Live/Remix/翻唱分别建模 |
| SourceTrack | providerInstanceId + externalId 唯一；某平台或本地文件的曲目 |
| SourceAsset | 内部 assetId；SourceTrack 下某一音质的具体文件字节版本，保存码率、大小与 SHA-512；同一曲目可有多个资产 |
| MediaObject | 歌词/封面/刮削原文的文件索引；objectId、类型、相对路径、MIME、大小、摘要、来源、版本、状态与访问归属，不含文件正文 |
| MediaBinding | 将 MediaObject 关联到来源曲目、文件版本或来源专辑/发行版本；记录语言、歌词时序适用范围、人工选择与优先级 |
| RecordingSourceLink | 来源关联、匹配依据、置信度、人工/自动状态 |
| MatchExclusion | 用户禁止关联的来源对，自动匹配不可覆盖 |
| ProviderInstance | 插件类型 + 实例 + 配置；同一插件可接多个 NAS |
| ProviderAccount | userId + instanceId + accountId；密钥不出 API |
| Playlist | 用户拥有的本地/远程/聚合歌单 |
| PlaylistEntry | 稳定 entryId、顺序、来源曲目，可保留未匹配项 |
| PlaylistBinding | 聚合歌单引用的子歌单、排序、来源约束 |
| PlaylistSnapshot | revision、同步状态、生成时间、不可变条目 |
| EntryProvenance | 聚合条目对应的原歌单与原 entryId |
| PlaybackSession | 用户、设备、来源、当前 assetId、音质、过期时间、已尝试来源 |
作品层可后续添加；不以“歌名 + 歌手”作为唯一键。时长、专辑、版本标识、ISRC 等只作证据。候选匹配不直接销毁来源记录；人工合并/解除均保留审计与可逆关联。未匹配来源仍可播放。
用户归属从第一版预留，第一版可只启用一个管理员。全局录音元数据与用户歌单、账号、播放状态分开；不能通过共享元数据推断其他用户私人文件。

### 4.1 文件信息与匹配依据
后端记录音乐的码率和 SHA-512，归属具体 SourceAsset，不在 Recording 或 SourceTrack 上保存一个会被不同音质相互覆盖的值。资产的字节版本身份不可变，探测结果可逐步补齐；文件内容变化时创建新资产版本并重新校验，不直接替换已有播放会话的资源。

| 字段 | 语义 |
| --- | --- |
| codec、container、durationMs | 编码、封装及音频时长；未知值为 null |
| bitrateBps、bitrateMode | 音频码率，单位 bit/s；CBR 记录固定码率，VBR 记录平均码率；模式为 cbr/vbr/unknown，无法取得码率时为 null，不以 0 表示未知 |
| bitrateOrigin | provider/probe/estimate；区分平台申报、文件探测与估算，保留申报值及其来源，避免混淆音质档位名称与实测码率 |
| fileSizeBytes | 完整文件的字节数；未知值为 null |
| fileSha512 | Server 对完整原始文件字节计算的 SHA-512，包含容器、标签及内嵌封面；存储为 64 字节，协议表示为 128 个小写十六进制字符；未完成计算时为 null |
| providerSha512 | Provider 申报的完整文件 SHA-512，可为空；与 Server 计算值分开保存，不将其他哈希、ETag 或音频载荷摘要填入此字段 |
| hashStatus、hashComputedAt | pending/verified/unavailable/failed/invalidated；verified 仅表示 Server 已完整读取并计算该稳定版本，附计算时间；另记录 Provider 申报值是否与计算值一致 |

码率用于音质筛选、展示和匹配的辅助证据，不作为曲目唯一键，也不能单凭码率相同自动关联。不同编码之间不能直接以码率高低判断音质优劣。整文件大小包含标签与容器开销，不能直接用 fileSizeBytes / durationMs 代替精确音频码率。

文件级精确匹配使用已校验的 fileSha512 与 fileSizeBytes；相同内容仍保留各自来源记录、账号权限与出处，不触发源文件删除。匹配只能在用户可访问的范围内进行，人工禁止关联和已有冲突优先于自动关联。Provider 申报哈希仅作为待校验证据；申报与计算不一致时记录冲突，撤销依赖错误申报值的自动匹配证据。

不同码率、转码、重新封装或仅修改标签均可能改变整文件 SHA-512，因此哈希不同不能判定为不同 Recording。跨文件版本仍结合元数据、时长与人工确认关联；音频指纹是否纳入自动候选匹配另行确认，不把 SHA-512 当作音频指纹。摘要范围依据 [SHA-512 标准](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)，文件探测器选型仍待验证。

本地/NAS 文件在扫描后由低优先级、限并发且可取消的任务流式计算摘要，不将整个文件载入内存、不阻塞首次入库或播放。计算绑定稳定的读取版本，结合文件标识、大小、修改时间等检测变化；这些属性只是失效线索。读取期间发现变化则丢弃本轮结果并重试，无法保证读取自同一版本时不标记 verified；后续文件变化时旧资产不再代表当前文件，撤销据旧版本对当前文件作出的自动匹配证据，历史版本摘要仍可保留。

在线来源允许码率或哈希暂时未知。仅在权限与 Provider 能力允许、且已完整读取同一版本全部文件字节时计算摘要；不为匹配强制预下载每首歌曲，不把部分 Range、乱序或重复片段当作完整文件计算。无法取得完整文件时标记 unavailable，不阻止已有权限下的播放。未取得完整 SHA-512 时，播放资源的一致性仍可使用可靠的强验证器；资源变化后必须重新加载，不能沿用旧文件的字节偏移。

### 4.2 信息刮削与独立文件存储
Server 统一调度本地提取及在线刮削，Web/Client 通过 Server 获取结果。刮削可在入库后按配置自动执行，也可手动触发；失败保留已有结果并记录状态，不阻塞音乐入库或播放。具体在线刮削来源、登录条件与可用能力需逐个验证，不预设某个平台必定提供歌词或封面。

可配置 mediaRoot，默认位于 Server 数据目录下，与音乐目录分离。例如：

```text
data/media/
  lyrics/<objectId>.lrc       # Timed lyrics; plain text uses .txt
  covers/<objectId>.jpg       # Extension follows the actual image format
  metadata/<objectId>.json    # Complete scraped metadata or raw responses
  staging/                   # Unpublished temporary files
```

歌词正文、封面图片、缩略图及完整刮削文档均以文件形式保存，不放入数据库 BLOB、Base64 或 JSON 正文字段。数据库仅保存 MusicFS 需要查询的规范化字段，以及文件路径、摘要、来源、关联、修订和任务状态等索引信息。歌词原文、翻译、逐行/逐字时序可分别保存；非 LRC 格式按实际格式存文件，不强制丢弃信息。路径使用服务端生成的 objectId，数据库记录相对 mediaRoot 的路径，客户端只拿受鉴权的对象 URL，不暴露服务器文件路径。

歌词关联当前来源与录音版本，不能仅凭歌名复用时序；封面关联来源专辑/发行版本，不因 Recording 合并而覆盖不同版本封面。保留内容来源与获取时间，人工上传、编辑或明确选定的结果优先，自动刷新不覆盖人工结果。独立文件是默认的持久内容存储，人工内容不按普通缓存自动淘汰。

每次更新生成新的不可变内容文件，先写临时文件、校验完整性并在同一文件系统安全发布，再以数据库事务切换引用；不得假设文件系统与数据库属于同一原子事务。持久化任务状态用于崩溃恢复；未发布的临时文件和孤儿文件在宽限期后回收，保护仍被引用或由活动任务持有的对象。新文件发布失败时保留旧引用。备份包含数据库、被引用的 Media Store 文件及配置，并用版本清单保证可恢复的一致视图；缺失文件标记待修复，不能把人工内容当作一定可重新刮削的缓存。

### 4.3 可选写入原始音频
原文件写入与刮削、独立文件保存分开控制：默认 writeBack.enabled=false；开启后按本地/NAS Provider 实例、目录及字段配置，选定歌词、封面或基本标签写入原始音频的元数据区域。默认仅补充缺失字段，覆盖已有字段需显式配置；保留未选中的标签与未知标签，刮削失败或缺失不触发清空。即使开启嵌入，独立目录中的内容仍保留。本配置不授权对在线平台歌曲或远程歌单写回。

仅在原文件可写、音频标签格式受支持且存储实例具备经过验证的安全替换/恢复能力时执行；能力不足时返回明确状态，仍可使用独立内容文件。写入不转码音频；具体标签库、歌词/封面格式映射待验证。写任务绑定预期 SourceAsset 并与扫描、摘要任务协调：检测并发变更，保留可恢复备份，在原文件所在文件系统准备临时副本、校验后安全替换。正在播放的文件延后写入；NAS 不支持安全替换时禁用回写，不将跨文件系统移动视为原子操作。

写入过程记录阶段与前后版本，异常时恢复原文件或标记待恢复，禁止盲目重试覆盖用户的新修改。写入成功后更新文件标识与路径映射，创建新的 SourceAsset 并重新探测、计算 SHA-512；新版本不得沿用旧摘要。由 Server 确认仅改标签的写入保留 SourceTrack、Recording、歌单及人工关联，不因文件标识或 SHA-512 变化被扫描成另一首歌；旧播放会话不能静默绑定新字节版本。

## 5. 歌单聚合与同步
聚合是引用 + 可重建快照，不复制并丢弃出处。默认按 binding 顺序、子歌单原顺序合并；已确认同一 Recording 去重，未知来源按 SourceTrack 去重。去重条目保留全部出处和可选来源。
刷新先抓取完整分页到临时快照，成功后事务性发布 revision；不完整抓取不能按缺失条目删除。有一致远程版本时固定该版本分页并验证；没有一致版本保证时，完整分页也不能证明条目已删除，缺失条目先标记疑似移除，经后续完整同步或独立查询复核后再删除其贡献。插件失败保留上次成功快照并标记 stale、lastSuccessAt、errorCode。
子歌单删除仅移除它的贡献；仍有其他出处的条目保留。用户可隐藏聚合条目，隐藏规则与快照独立，不修改远程歌单。默认隐藏该 Recording 的全部来源，也可指定仅隐藏某个 binding/原 entryId 对应的出处。规则绑定持久身份，不绑定重建产生的展示行；未匹配条目先绑定 SourceTrack，确认关联后将整首隐藏意图迁移到 Recording。解除或拆分错误关联时，依据保存的原始目标保留隐藏意图，不能盲目扩散到所有拆分结果；无法唯一还原目标时保留原始目标规则并提示用户确认。本地追加条目作为独立 binding。聚合编辑默认仅更改本地规则。
远程写回以后单独设计冲突与补偿，不默认同步回所有平台。源歌单循环引用必须拒绝。
同步任务按账号/实例限流；同一歌单合并重复请求并串行同步，持久化任务代次，发布事务校验其仍为有效代次，禁止较旧或恢复的任务覆盖新结果；聚合快照记录规则版本与所引用的子快照版本。持久化任务状态，指数退避加抖动；任务支持取消，重启后恢复。凭据失效暂停相关任务并提示登录。

## 6. Provider 协议
先交付官方受信任 Provider；第三方插件正式支持前提供进程隔离。建议 Host 与 Worker 使用版本化 JSON-RPC，经 stdio 通信；后续也可用本地 socket。不同时引入多个语言宿主。
manifest 包含 id、version、protocolVersion、capabilities、配置 schema 与权限。能力至少包括 search、metadata、playlist.read、stream.resolve、lyrics、artwork、library.scan；登录、playlist.write 与本地文件 metadata.write 分别独立声明。具备写入能力不代表配置已授权，metadata.write 默认禁用。
调用带 requestId、accountRef、deadline、cursor、取消令牌；分页结果含 nextCursor 与可用快照版本。错误码：AUTH_REQUIRED、ACCESS_DENIED、NOT_FOUND、RATE_LIMITED、TEMPORARY_FAILURE、UNSUPPORTED、UNAVAILABLE；包含 retryAfter 与可重试属性，不传出密钥。
metadata/resolve 按具体音质与文件版本返回可获得的 codec、container、durationMs、bitrateBps、bitrateMode、fileSizeBytes、providerSha512 及资源版本证据；未知值为 null，Provider 不能自行标记 Server 的 hashStatus 为 verified。resolve 另返回 MIME、质量、过期时间、Range 能力、直接播放是否允许，以及仅 Server 可见的请求头；Server 据此关联或创建 SourceAsset。Provider 不决定跨源匹配、去重、全局优先级。
lyrics/artwork 返回内容或受限的资源描述、来源标识、格式、语言及适用版本，由 Server 校验并保存到 Media Store；远程 URL 和凭据不作为永久内容标识。刮削文件下载沿用目标地址、重定向、大小与格式校验，不形成任意 URL 下载入口。
隔离权限限定目标域名和挂载根目录，限制资源、日志长度和执行时间；进程隔离本身不是完整沙箱。官方插件也不获得无条件任意文件和网络访问。

## 7. API 草案与播放
前缀 /api/v1。错误 envelope 为 code/message/requestId/retryAfter，列表使用游标，时间使用 UTC ISO 8601。
| 路由 | 功能 |
| --- | --- |
| GET /health/live、/health/ready | 存活与就绪；就绪含 product=MusicFS、协议版本和 instanceId |
| GET /providers、/provider-instances | 能力与用户可访问实例 |
| GET /search?q=...&cursor=... | 分来源部分成功；候选关联不强制折叠 |
| GET /recordings/{id}/sources | 可选来源与用户可用性 |
| GET /source-tracks/{id}/media | 用户可访问的歌词/封面版本、来源、语言与当前选择 |
| GET /media/{objectId} | 鉴权后读取独立文件内容；不返回磁盘路径 |
| POST /metadata-jobs | 异步提取/刮削，返回 jobId；不隐式开启原文件写入 |
| POST /metadata-write-jobs | 按已授权配置写入本地原文件，绑定预期资产版本，返回 jobId |
| GET /playlists、/playlists/{id}/entries | 歌单与固定 revision 分页 |
| POST /playlists/{id}/bindings | 配置子歌单引用 |
| POST /sync-jobs | 异步同步，返回 jobId |
| POST /playback/sessions | recordingId/sourceTrackId、偏好、客户端能力 |
| POST /playback/sessions/{id}/fallback | 播放失败后排除已失败来源并重新解析 |
| GET /playback/sessions/{id}/stream | 会话流代理 |
| GET /events | WebSocket 任务/歌单/可用性通知 |
修改聚合规则采用 revision/If-Match 乐观锁；冲突返回 409。创建会话/任务支持 Idempotency-Key。事件含 eventId、revision、type；客户端重连后读最新快照，事件不承担唯一事实来源。

默认代理本地/NAS、需私密请求头或浏览器不兼容的在线源；直接播放仅返回无需泄露账号密钥、客户端确实可访问的 URL。会话采用短期限定 scope 的 token，不以来源 URL 作为永久播放标识。避免 token 出现在日志；CORS 使用明确 allowlist。
代理不缓冲整个文件；支持背压、取消、单 Range、206/416，保留准确 Content-Type；多 Range 不支持时明确返回错误。上游不支持 Range 时向客户端声明不能 seek，不能伪造 206。
客户端报告 codec/MIME/seek 能力。Web 用浏览器播放适配器，桌面必须验证 WebView 的 FLAC 等兼容性；不支持时采用桌面原生播放适配器，暂不强制 Server 转码。
临时 URL 失效时重新 resolve 同一来源；必要时尝试其他来源，最多 3 次不同来源，保留失败原因。只有同一录音且可 seek 的新来源才恢复原进度，否则提示从头播放。账号权限不满足与实际不可用分开显示。
歌词优先与当前来源/版本一致，来源切换后重新校验时序；可选偏移属于用户配置。
详见 [播放时序](diagrams/playback.puml)。

## 8. 部署和 Windows 生命周期
Docker：Server 独立运行，持久化 DB/media/cache/config，Media Store 独立于音乐目录；音乐目录默认只读挂载。仅对显式开启原文件写入的实例配置指定目录可写，其他音乐目录继续只读；插件只在授权挂载根下访问。Web 可静态托管并经同源反向代理连接 Server。
本地：同一 Server 可执行程序，数据放用户数据目录。便携模式可显式指定独立目录；本地默认绑定 loopback，远程访问需要显式配置鉴权与 TLS。
Client 仅对明确配置为 managed-local 的模式自动启动；remote 模式绝不启动本机 Server。
健康检查失败不等同于进程未运行。启动器结合用户级互斥锁、受限进程身份信息、配置及端口检查；端口被其他程序占用要报错。就绪响应校验 MusicFS 身份/协议并完成授权握手，不只看 HTTP 200。
Tauri 通过受控宿主命令启动打包 sidecar，参数白名单，不向 Web UI 暴露任意命令执行。Service/external-local 模式只连接并提示状态；不自动提权启动系统服务。
等待带退避和总超时（建议 15 秒）；失败显示日志入口与重试。Server 记录实际启动方式：随 Client 启动的 managed-local 实例在最后一个 Client 退出后自行优雅退出；独立启动的实例保持运行，不因 Client 的连接或退出改变归属。Server 维护受鉴权的客户端租约，退出主动释放，崩溃后租约超时失效，避免依赖“最初启动它的 Client”关闭进程。最后一个租约释放后进入停机流程，取消或保存后台任务、完成文件写入的安全收尾，在有界超时内退出，不以仍有扫描任务为由无限常驻。
运行中的旧版本 Server 与新版 Client 不兼容时，明确报告版本冲突；managed-local 的升级需协调停机、数据备份/迁移与新版本启动，失败保留恢复入口，不能直接覆盖运行中的可执行文件。独立启动的 Server 由其部署方式管理升级，Client 仅提示，不自动停止或接管。
桌面歌词独立窗口，置顶/穿透/锁定/缩放属于平台适配；Mac/Linux 支持程度待验证。皮肤限声明式资源、颜色、布局 token，初期不运行任意脚本。
详见 [启动流程](diagrams/windows-launch.puml)。

## 9. 安全和数据可靠性
所有私有歌单、文件与会话按 userId 授权。浏览器与桌面原生部分使用各自受限会话；Tauri capabilities 和 CSP 只授予需要的命令。
Server 流代理不是任意 URL 代理；只能访问 Provider 声明来源，校验重定向、DNS 与目标地址；NAS 内网访问按实例显式授权，其他网络入口默认拒绝 SSRF 目标。
密钥使用 OS key store 或外部提供主密钥，Docker 通过 secret 注入；DB 不保存明文凭据。日志脱敏 URL 参数、token、请求头与私人路径。
SQLite 迁移前做一致性备份，不能仅复制运行中的主数据库而忽略 WAL；记录 schemaVersion、备份与恢复流程。插件和元数据任务失败不能破坏已发布快照。

## 10. 原型与交付顺序
[客户端线框](prototypes/client.salt.puml) 展示导航、聚合歌单、来源状态、播放条和来源弹窗。
[连接与歌词线框](prototypes/settings.salt.puml) 展示部署模式、登录/同步状态、皮肤与歌词控制。线框使用英文标签，说明使用中文；不是可运行客户端。

M0：协议与模型评审；验证 NAS Range、浏览器/桌面格式、Tauri sidecar 与歌词窗口。
M1：本地 Provider、单用户、本地歌单、文件码率探测与后台 SHA-512 精确匹配、本地歌词/封面提取与独立文件存储、Web 播放与 Server Docker/本地运行。
M2：一个经过可行性验证的在线 Provider、导入与快照、人工关联、聚合与来源选择、歌词/封面等信息刮削及经能力验证的可选原文件写入。
M3：桌面打包、Windows 生命周期、歌词与皮肤，再扩展第二在线 Provider。
M4：第三方插件权限隔离、多用户和远程写回按实际需求推进。

验收重点：不同录音不误合并；多出处删除正确；无一致远程版本时复核删除；旧同步任务不能覆盖新结果；整首/单出处隐藏在重建后保留；同步中断保留旧快照；Range/seek 正确；来源失败有界回退；凭据不传客户端；多个 Client 启动只产生一个 Server；随 Client 启动的 Server 在最后一个 Client 退出后关闭，独立启动的保持运行；remote 模式无本地启动。
文件匹配验收：相同文件跨路径可精确匹配且保留出处；不同歌曲即使码率相同也不误关联；同一录音转码或修改标签后不因哈希不同被强制拆分；VBR 与未知码率正确表示；文件在计算中变化不发布有效摘要；Provider 错误哈希不成为已校验证据；无完整哈希的在线来源仍可播放；匹配不跨用户泄露私有文件存在性。
刮削与写入验收：歌词/封面正文不入数据库；默认刮削前后原音频的 SHA-512 不变；自动刷新保留人工内容；发布中断仍可读取旧文件且不误清理有效文件；备份恢复同时覆盖索引与独立内容；显式启用且具备能力时才写入原音频；写入失败可恢复，成功后新摘要生效且歌曲/歌单关联不丢失；不支持的格式或只读 NAS 不触发强行写入。
尚未定案：Server 语言、UI 框架、原生音频库、平台 Provider 可行性、桌面各平台歌词能力。当前交付是设计与线框源码，不是实现或渲染验证完成的产品。
待用户确认：Web 遇到不兼容格式时是否提供可选转码；跨来源续播是否必须确认时间轴兼容；是否加入音频指纹辅助匹配的设计与验证。相关方案经评审与原型验证后更新本文。
