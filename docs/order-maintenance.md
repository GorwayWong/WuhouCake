# 订单删除、图片与岗位维护

## 删除与取消

取消使用 `CANCELLED` 业务状态，保留原有取消原因和恢复制作规则，不自动清理。

`POST /api/orders/{id}/delete` 接收 `expectedVersion`、`reason`。店长、前厅主管、前厅店员默认具有 `ORDER_DELETE` 和 `ORDER_DELETED_READ`；所有业务状态可删除。原因必填、最多 1000 字符。删除独立于原业务状态，详情的 `deletion` 返回删除时间、员工、原因、到期时间；重复请求不改原因、不续期、不重复审计。旧版本拒绝覆盖。

删除后仅保留 30×24 小时，只读且不可恢复；备注、图片、付款、制作、交付等所有写入拒绝。日历、工作台、备料、付款汇总、经营统计、正常导出与重复订单核对均排除删除订单。查询 `GET /api/admin/orders?deleted=true` 默认按最近 30 天删除日期查询，原 `from/to` 为北京时间日期半开区间；列表及详情、单单 Excel、逐单 ZIP 可读，经营汇总导出不可用。到期立即停止读取，不等待清理任务。

应用启动时和每小时分批清理到期数据。每单独立事务，失败记录不阻断其他订单，下轮可重试。清除商品、活动、全部图片和关联客户填单原文、核对及活动，只保留最小删除审计和请求回执。`cake_order_creation.purged_order_id` 保留原请求对应的订单标识；客户填单 `PURGED` 行只保留回执所需信息，旧请求不会重新建单。员工账号及客户二维码入口不删除。清理日志含成功、失败、待处理数量，不含客户资料。

备份按原备份策略保存；在线清理不抹除历史备份。PostgreSQL 删除或替换 BYTEA 后的空间可供数据库复用，不保证操作系统立即释放同等磁盘容量。

## 图片策略

仅接收原有 JPEG/PNG，上传仍限 5 MiB、边长 8192、2400 万像素、每单 8 张。服务端校验、纠正 EXIF 方向、等比例缩小至最长边 1920，小图不放大；JPEG 质量为 0.80，透明图保留 PNG，非透明 PNG 比较 PNG/JPEG 输出。足够小且不需方向纠正的图片比较去元数据后的无损候选，避免体积增加。实际格式、扩展名、尺寸和字节数同步保存，不在业务库留原图副本。导出在同一 REPEATABLE_READ 事务内固定元数据和图片临时文件，然后结束事务生成 Excel/ZIP；成功或失败均释放图片临时文件，避免历史处理期间混用元数据和内容，也不让生成过程长期占用数据库事务。一次导出的图片快照总字节数同样受 256 MiB 上限保护。

新上传图片 `processing_version=1`。历史处理按主键分批扫描 version=0，含软移除图片；逐张校验并条件替换，失败保留原内容，支持重新运行。处理不改变订单版本、业务活动、上传员工或时间。

## 备份与显式维护命令

先加载部署环境变量和 RSA 密钥路径，再使用对应部署的 PostgreSQL 账号执行备份：

```sh
pg_dump -Fc --file=/secure-backups/wuhou-before-maintenance.dump
pg_restore --list /secure-backups/wuhou-before-maintenance.dump
```

`PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 使用当前部署配置；不要把真实密码写入命令行或提交到仓库。备份应位于仅运维人员可读的目录。维护参数不会在普通启动时自动处理历史图片或分配岗位，命令模式不启动 HTTP，完成后退出。

```sh
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=dev \
  --wuhoucake.maintenance.recompress-images=true \
  --wuhoucake.maintenance.backup=/secure-backups/wuhou-before-maintenance.dump
```

确认 `image_recompression_completed` 的失败数为 0，并比较 originalBytes/storedBytes。失败时命令返回失败，核对 image_recompression_failed，原图仍在，修复后可重跑。

## 六岗位迁移

新岗位为 `STORE_MANAGER`、`PASTRY_SUPERVISOR`、`FRONT_DESK_SUPERVISOR`、`DECORATOR`、`BAKER`、`FRONT_DESK_CLERK`。店长同时具有超级管理员身份；其他新岗位为普通员工，兼任店长时具有管理员身份。岗位和权限契约见[权限说明](authorization.md)。

先只读列出员工工号、姓名、现有岗位，逐人确认后生成 JSON，内容形如：

```json
{"EMP001":["STORE_MANAGER"],"EMP002":["FRONT_DESK_CLERK"],"EMP003":["DECORATOR"]}
```

工号及分配须替换为已确认的实际值；`administrator` 必须是已改密的在职超级管理员工号。

```sh
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=dev \
  --wuhoucake.maintenance.role-assignments=/secure-backups/confirmed-employee-roles.json \
  --wuhoucake.maintenance.administrator=EMP001 \
  --wuhoucake.maintenance.backup=/secure-backups/wuhou-before-maintenance.dump
```

只迁移旧岗位，整批同事务并记录前后值；重复执行同一清单不重复更新或审计，已分配其他新岗位时拒绝覆盖。普通员工管理界面可在迁移后继续调整六个岗位。旧标识保留用于历史审计解释，不改写历史记录。
