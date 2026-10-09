# MusicFS 工作约定

- 架构事实来源：[MusicFS 架构](https://github.com/fnMrRice/MusicFS/blob/main/docs/architecture.md)。
- 本仓库管理总体架构、共享图示与线框；client、server、web 目录是独立实现仓库，不纳入本仓库提交。
- Server 仓库拥有 OpenAPI、事件协议、Provider SDK 与数据库迁移；修改协议时同步评估总体架构及客户端兼容性。
- 用户明确要求：画图优先使用 PlantUML（.puml）；界面线框优先用 PlantUML Salt。保留可编辑源文件；渲染图需与源文件一致。
- 中文文档与说明；程序日志和输出使用英文。Shell 注释与日志使用英文。
- 不将设计草案或线框描述为已实现功能。技术选型未经验证时明确标记。
- 各仓库均保持私有；凭据不提交到 Git。
