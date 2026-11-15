# 测试指南

## 图片故障隔离回归

`ImageWorkerTest` 验证真实子进程的解码、不可中断任务超时终止、崩溃后恢复和响应体期限；`OrderPackageIT` 验证七图准备不持有事务、处理失败全回滚和同键重放不重复解码。图片单元测试保留透明 PNG、小图和 EXIF 1–8 方向回归。

资源验收使用专用数据库与回环测试入口，不得指向生产。先运行 `WuhouCake-order/src/test/java/org/xaspire/WuhouCake/order/infrastructure/files/ImageResourceFixtures.java` 的独立 main，生成七张 6000×4000 合成 JPEG（包括渐进 JPEG），避免样本生成占用被测服务堆。测试 app 使用 256 MiB 堆/640 MiB 容器，图片端使用 Compose 的 320 MiB/1 核边界。测试实例预建 `SOAK` 管理员；脚本默认初始/改后口令仅为合成测试值，也可通过 `WUHOU_IMAGE_TEST_INITIAL_PASSWORD`、`WUHOU_IMAGE_TEST_PASSWORD` 设置。

```bash
java -Xmx384m WuhouCake-order/src/test/java/org/xaspire/WuhouCake/order/infrastructure/files/ImageResourceFixtures.java /tmp/wuhou-image-fixtures
python3 docs/verification/image-isolation-probe.py --base http://127.0.0.1:18080 --images /tmp/wuhou-image-fixtures --seconds 1800 --output /tmp/wuhou-image-result.json
```

脚本并发提交三批七图套餐，同时探测 CSRF、会话和套餐读取；成功后同键重放并删除合成套餐。目标为读取 p95 < 1 秒、最大 < 3 秒、无读取错误。`--pause-worker wuhou-image-soak-image-worker-1` 可对专用验收容器注入暂停，验证上传受控超时且读取不受影响；该参数只接受此验收命名前缀。持续观察 Docker 内存、PIDs、健康及临时文件，并在结束后删除专用测试环境。合成样本不能替代事故原图的确定性复现。

前端新增 `frontend/tests/requestDeadlines.test.ts` 和 `packageDraftStorage.test.ts`；浏览器回归使用 `PLAYWRIGHT_MODULE=/path/to/playwright node --test frontend/tests/packageRecovery.browser.mjs frontend/tests/packageConflict.browser.mjs`，需先在 5197 端口启动前端，覆盖七张图片响应丢失后刷新、同键确认、确认时再次繁忙、草稿版本冲突及原有多人编辑。

## 常用命令

| 验证目标 | 命令 | 依赖 |
| --- | --- | --- |
| 后端业务规则、Web 边界与模块架构 | `./mvnw test` | Java 21 |
| HTTP、数据库、事务、Redis 与历史数据升级 | `./mvnw -Pintegration verify` | Java 21、专用 PostgreSQL 和 Redis |
| 前端表单数据、路由、请求、草稿与同步 | `npm --prefix frontend test` | Node.js 24、`npm --prefix frontend ci` |
| 前端类型与打包 | `npm --prefix frontend run build` | 同上 |

本地集成测试的连接参数见 [integration profile](../WuhouCake-bootstrap/src/main/resources/application-integration.yml)。使用专用测试实例，按实际连接设置 `SPRING_DATASOURCE_*` 和 `SPRING_DATA_REDIS_*`。测试使用随机数据库 schema 和 Redis 键前缀，测试数据使用合成样本。复现 CI 时关闭外部识别并清空模型密钥，参见 [CI 环境配置](../.github/workflows/ci.yml)。

单独重跑某一条 HTTP 集成用例时，可以指定类和方法。测试报告分别在各模块的 `target/surefire-reports` 和 `target/failsafe-reports`。

```sh
./mvnw -pl WuhouCake-bootstrap -am -Pintegration verify \
  '-Dit.test=IdentityIT#auditFiltersByActorActionResultAndTimeWithStablePagination' \
  -Dfailsafe.failIfNoSpecifiedTests=false
```

## 业务覆盖入口

| 业务或风险 | 代表性测试 |
| --- | --- |
| 订单、制作、取货和付款 | `OrderTest`、`OrderPricingTest`、`OrderIT` 覆盖状态转换、分级权限、金额边界、并发版本、回滚和通知 |
| 客户扫码与确认 | `CustomerSubmissionIT` 覆盖提交、核对、重复确认、权限、限流、幂等和异常数据拒绝 |
| 粘贴识别 | `OrderRecognitionTest`、`OrderRecognitionServiceTest`、`OrderIT` 和 `recognition.test.ts` 覆盖规则识别、模型降级、禁止缓存和保留手工输入 |
| 查询、报表和导出 | `WorkflowManagementIT`、`OrderIT`、`OrderExportIT` 覆盖时区、筛选、汇总、文件内容、导出限额和失败清理 |
| 套餐、商品图片与草稿 | `OrderPackageIT`、`OrderExportIT`、`orderDraftStorage.test.ts` 及对应浏览器用例覆盖版本冲突、文件归属、重试和本机恢复 |
| 账号、权限和审计 | `IdentityIT`、`authentication.test.ts` 覆盖首次改密、会话撤销、权限变化、审计筛选分页、事务回滚和存量岗位 |
| 基础设施和升级 | `InfrastructureIT` 验证迁移装配、数据库事务和 Redis 锁。历史升级用例在各业务集成测试中从指定旧版本建立合成数据再运行迁移 |

新增回归时，从最轻的可观察边界入手。领域测试断言状态、金额和错误结果。接口测试断言响应以及重新读取的状态，异常写入同时检查版本、记录或审计是否保持原状。数据库约束、真实回滚、并发竞争和旧数据迁移使用集成测试。对于页面用例，优先使用控件标签、可访问名称和用户可见提示来定位。

## 浏览器回归

现有 Playwright 用例按需运行，覆盖表单交互、弹窗、布局、本机存储和多标签页等浏览器行为。API 使用合成响应，真实 HTTP 契约由后端集成测试验证。

在 `frontend` 启动 `npm run dev -- --host 127.0.0.1 --port 5197`，另开终端在同一目录运行以下命令。需要本机 Chrome 和可用的 Playwright 模块，环境变量及其他用例见 [前端验证说明](../frontend/README.md#草稿回归验证)。

```sh
node --test --test-name-pattern='首次登录|客户扫码响应丢失' \
  tests/firstLogin.browser.mjs tests/orderDraft.browser.mjs
```

首次改密用例从录单深链接开始，验证首次登录的访问限制、当前密码错误后的重试，以及改密后使用新密码重新登录。扫码用例验证响应丢失后保留输入，并用原幂等键和原内容重试。部署环境的 HTTPS Cookie、反向代理、真实设备和外部模型可用性仍需在对应环境验收。
