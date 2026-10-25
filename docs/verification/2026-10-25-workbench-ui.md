# 时间、待办提醒与商品分类验证

## 已实现行为

- 统一客户收货时间、到店取货时间、计划出品时间；员工新建与改期支持日期必填、时刻待定，显式清除时刻，不补零点。
- 客户自助填单仍要求完整收货时间；员工核对新增计划出品时间，确认后写入正式订单。
- 周历和月历仅对过去日期的未完成交付订单标红并显示数量；付款状态、列表筛选不改变提醒。
- 默认周历；订单先于统计，未完成先于完成／取消。每日统计与客户填单二维码管理默认折叠。
- 详情制作摘要集中三类时间、阶段及主操作、商品行完成勾选、有效特殊要求和参考图入口；详细资料保留；制作岗可在非蛋糕商品的历史规格中查看原有制作参数，不展示额外客户或价格数据。
- 六类商品为 CAKE、TEA_BREAK、COOKIE、SNACK、DRINK、READY_BAKERY；非蛋糕只展示通用规格及特殊要求，员工报价可选。所有商品仍经过原夹层、抹面等整单流程。

## 自动验证

- 前端 108 个测试通过，`npm run build` 通过。覆盖日期型创建、补时刻、改期／清除、识别日期联动、分类转换、旧规格保留和过去日期提醒。
- Maven 相关模块单元与 ArchUnit 检查通过；新增加的纯非蛋糕流程测试单独复跑通过。
- 以下 6 个基础设施场景通过，均使用隔离测试 schema：
  - `OrderIT#dateOnlyReschedulingPersistsClearingAndKeepsOtherTimesAndHistory`
  - `OrderIT#multiItemWorkflowPersistsChangesHistoryAndIndependentRecentNotes`
  - `CustomerSubmissionIT#optionalHandoffSurvivesConfirmationQueriesExportAndLaterEdits`
  - `CustomerSubmissionIT#acceptedReceiveTimeUsesReviewAndRemainsTheOnlyCurrentTimeAfterCorrections`
  - `OrderPackageIT#migrationPreservesHistoricalPackagesAndStopsOnDuplicateNames`
  - `OrderPackageIT#categoryMigrationPreservesOriginalsAttributesAndHistoricalSnapshots`
- 分类迁移测试确认订单商品、套餐、待确认核对内容归并正确，原始填单、历史活动及额外属性保持不变，未知旧类型不猜测归类。
- `git diff --check` 通过。构建保留现有大于 500 kB 的包体提示，本轮未调整打包策略。

## 本地迁移

- 实施前实际 Flyway 成功版本为 21，无失败记录；本地已成功应用 V22，后端 readiness 为 UP。
- 迁移前备份：`backups/maintenance/2026-10-25-before-workbench-ui.dump`，2,742,924 字节；已验证目录可读及完整解码。
- SHA-256：`14bae4f21f958d5c251cc66bc2005764b8e4e4c1c5c0a39ac87ed60020b0f698`。
- 迁移前后：26 条商品的 attributes、3 份原始填单、164 条订单活动的数量及按 ID 排序聚合摘要一致。
- 本轮浏览器检查未新增或修改业务订单；未提交代码或推送。

## 轻量页面检查

- 使用现有店长登录页面检查桌面和窄屏；最终桌面内容宽度 1280 CSS px，窄屏实际内容宽度约 355 CSS px，未出现页面横向溢出。
- 周历及月历红色提醒显示正确，当前和未来日期不标红；日历切换使用 Tab／Enter 验证。
- 员工表单键盘打开分类选择器并选择饼干，确认六类齐全、没有蛋糕专属字段；随后恢复空白草稿。
- 客户收货时刻通过键盘选择后清除，日期保留并显示时刻待定；未提交表单。
- 制作摘要商品行没有重复勾选入口，窄屏行高至少 48 px；参考图入口通过 Enter 跳转并聚焦图片区域。
- 客户填单队列优先、二维码管理默认折叠。未执行付款、制作推进、删除、接单等业务写操作。
- 截图保存在 `/private/tmp/wuhou-workbench-ui-20261025/`，该目录为本地临时证据，不进入版本库。未进行全量端到端或完整无障碍认证。
