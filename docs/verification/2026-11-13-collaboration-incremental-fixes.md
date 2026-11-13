# 协作增量边界修复验证

日期：2026-11-13。实施基线为 7134098 加当时全部未提交改动，包括上一轮同步修复。本轮不修改后端实现、依赖或数据库迁移。

## 修复范围

- 客户填单列表、制作提醒明细、付款明细和待制作明细使用 gcTime=0、staleTime=0。只有当前查询本轮成功且已结束的响应可修正页码；错页缓存不展示，制作提醒同步实际页至页面记忆。离页释放数据，筛选、路由、页码与滚动恢复仍沿用原机制。
- API 层新增 GET-only 的 readQuery，30 秒期限覆盖认证等待、请求及响应体解析。查询取消与超时分开处理，结束时清理计时器和监听器；超时不取消共享认证刷新，也不在刷新完成后补发已超时请求。响应体读取期间账号改变时不返回旧数据。
- calendar、workbench、management-orders、order 的 HTTP JSON 查询，以及客户填单列表、详情、待处理数量接入 readQuery。图片仅元数据查询接入；SSE、文件上传下载、认证接口本身和写请求保持原路径。READ_TIMEOUT 显示读取超时提示，查询最多重试两次。
- 金额编辑使用最新付款状态。付款后保留并禁用已有金额输入，纯金额保存禁用；普通资料保存排除金额修改及其校验，明确显示“仅保存其他资料”。撤销付款仍须核对新版本，草稿不会自动提交。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| npm --prefix frontend test | 189 项通过 |
| npm --prefix frontend run build | 通过，保留原有大于 500 kB 打包提示 |
| Java 21：Maven verify，integration profile，仅选择 OrderIT、CustomerSubmissionIT | BUILD SUCCESS；398 项单元/架构测试及 82 项所选集成测试通过 |
| 浏览器 | 分批验证 40 个不同场景通过，其中新增 6 项 |
| git diff --check | 通过 |

后端使用独立 PostgreSQL 17 / Redis 7 测试容器、合成数据和随机 schema，不连接开发或生产数据库。此次只选择订单、付款及填单相关集成类，不将上一轮其他集成类的历史结果计入本轮。

## 失败复现与回归

修复前，新增测试复现四类列表缩页后增长无法正常回到末页、付款后金额输入未禁用、JSON 响应头/体挂起不结束、等待共享认证刷新未按期结束、响应体读取期间换会话仍返回旧数据。

readQuery.test.ts 的 7 项用例验证响应头/体的 30 秒期限、取消与预先取消、共享认证刷新不中断且过期查询不补发、读取期间退出账号、成功后的资源清理、GET-only 行为和普通写请求不套期限或重发。

incrementalCollaboration.browser.mjs 的 6 项用例验证：

- 四类分页均在缩页后重新增长并访问末页，覆盖 15 秒缓存新鲜窗口内和经过该窗口后的往返，以及延迟返回。
- 普通资料的金额草稿包含非法金额文本时，远端付款仍可锁定并保留输入，核对后只提交电话等非金额字段。
- 纯金额编辑在远端付款后禁止保存，撤销付款需再次核对；已付款打开编辑后经历未付→已付，输入仍保留。
- SSE 503 下，挂起详情读取在有限重试后出现超时提示，网络恢复后主动重试取得最新数据。

原有协作、订单详情、草稿、金额与待制作浏览器回归一并复跑。一次超时提示测试使用了不匹配按钮容器的精确文本定位，修正测试定位后单独通过，再重跑新增六项全部通过；该定位调整没有修改产品行为。

## 复跑

前端开发服务启动于 localhost:5197，设置 PLAYWRIGHT_MODULE 指向本机 Playwright 模块；DRAFT_TEST_URL 可覆盖来源。以下命令在 frontend 目录运行：

```sh
node --test --test-concurrency=1 tests/incrementalCollaboration.browser.mjs tests/collaboration.browser.mjs tests/orderPricing.browser.mjs tests/orderDetail.browser.mjs tests/productionQuery.browser.mjs tests/orderDraft.browser.mjs
```

后端在配置专用测试 PostgreSQL、Redis 并使用 Java 21 后运行：

```sh
./mvnw -Pintegration '-Dit.test=OrderIT,CustomerSubmissionIT' -Dfailsafe.failIfNoSpecifiedTests=false verify
```

## 边界

浏览器使用隔离会话与合成 HTTP API；超时和周期验证推进浏览器测试时钟，不代表真实门店网络时延。单次读取期限为 30 秒，含自动重试后的总恢复时间更长，浏览器休眠也可能延后计时器。文件与认证接口自身的超时策略未扩大调整。

跨入口重复检查、多标签页草稿原子性及生产网络验收继续保留。当前修改未提交、推送或部署。原始基线保存在 /tmp/wuhou-incremental-fix-baseline-20261113，本轮临时测试日志为 /tmp/wuhou-incremental-*。
