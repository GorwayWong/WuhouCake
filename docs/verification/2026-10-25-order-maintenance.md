# 订单维护与导出验证（2026-10-25）

## 已实现

- 统计页移除“本月收货（截至今天）”，保留手动筛选，同时提供汇总 Excel 和按完整已应用条件生成的逐单 Excel ZIP。
- 单单及 ZIP 内 Excel 共用用户语言模板，去内部 ID、版本、规格 JSON；使用中文状态、商品规格、商品名称关联备注和嵌入图片。
- 后端压缩新图片，并提供显式历史图片处理命令；快照在可重复读事务中固定图片临时文件，事务外生成导出，失败或事务回滚均清理。
- 删除与取消分别管理：取消长期保留，删除后 30×24 小时只读且不可恢复，到期清理；已删除独立查询、导出，正常工作台、统计和查重排除。
- 六岗位、多岗位权限并集；店长同时具有超级管理员身份。制作组仅看到客户手机号和收货、取货、计划出品时间，服务端同步裁剪其他客户与金额字段。
- 收货日期保留用于订单归日；与期望收货时间、取货时间、计划出品时间分别命名。

## 自动验证

后端主回归及新增验证覆盖 319 个单元／ArchUnit 测试、132 个集成场景，均通过；包含 OrderIT、OrderExportIT、CustomerSubmissionIT、WorkflowManagementIT、IdentityIT、InfrastructureIT。最后对保留期查询、已删除导出及物理清理再次执行了针对性回归。

重点场景包括：全部业务状态删除、重复删除不续期、同版本付款／删除竞争、业务与删除审计回滚、清理失败逐单回滚及重试、过期即停止读取、填单敏感内容清除和旧请求不再建单、六岗位及最后管理员保护、EXIF 方向、透明 PNG、大图缩小、历史处理续跑、图片快照与历史压缩并发、回滚时临时文件清理。

前端 104 个测试及生产构建通过。新增验证包括：按服务端能力显示客户填单入口、删除通知立即封锁旧详情并移除工作台卡片、保持原编辑基线、已删除查询独立于历史未付款。

```sh
./mvnw -q -Pintegration -pl WuhouCake-bootstrap -am \
  -Dit.test=WorkflowManagementIT,OrderExportIT,OrderIT,CustomerSubmissionIT,IdentityIT,InfrastructureIT \
  -Dfailsafe.failIfNoSpecifiedTests=false verify
cd frontend
npm test
npm run build
```

验证环境：Java 25.0.4（编译目标 Java 21）、Node.js 24.19.0、本地 PostgreSQL／Redis。集成验证使用临时 schema 与独立 Redis 命名空间。

## 浏览器

使用独立临时 schema 和合成账号，在 Chromium 桌面及 390×844 手机宽度检查：

- 双导出按钮、ZIP 下载反馈、取消原日期快捷按钮。
- 删除原因、二次确认、已删除详情只读、已删除列表隐藏经营统计。
- 裱花师的“客户与交付”仅有手机号及规定日期／时间。
- 裱花师正在填写备注时，由店长删除订单：原备注保留，发布及所有业务操作即时禁用。
- 浏览器未报告 JavaScript 异常；临时浏览器、服务、schema 和测试 Redis 命名空间在验收后清理。

Windows／macOS 的真实 WPS，以及 Android、iPhone／iPad 文件应用与 WPS 打开、解压和打印仍待设备验收。标准 ZIP／XLSX 结构和图片嵌入已由自动测试核对，不等同于这些客户端的真机验收。

## 本地开发库维护结果

备份：[2026-10-25-151623-before-order-maintenance.dump](../../backups/maintenance/2026-10-25-151623-before-order-maintenance.dump)，9,152,753 字节；`pg_restore --list` 及完整转储解码至 `/dev/null` 均成功。

SHA-256：`a584caddbd99f59a5a1ff4874888816b38776b8e534773ce5b1a0df76c3e816d`。

Flyway 已应用 V19、V20、V21。岗位按确认清单迁移，并同事务记录了 3 条 identity.roles_migrated 前后值审计：

| 工号 | 员工 | 岗位 | 系统身份 |
| --- | --- | --- | --- |
| 0001 | 店长 | STORE_MANAGER | SUPER_ADMIN |
| 002 | 员工2 | FRONT_DESK_CLERK | STAFF |
| 9001 | 林师傅（演示） | DECORATOR | STAFF |

历史图片处理：13 张成功、0 张失败，8,181,726 → 2,407,295 字节，减少 70.58%；未处理图片数为 0。现有订单仍为 16 单，图片仍为 13 张。数据库可复用空间不等于操作系统即时回收容量。

本项目后端 8080、前端 5173 已按当前代码重新启动，后端 readiness 为 UP。操作规则及后续维护命令见[维护说明](../order-maintenance.md)。
