# 每商品图片验证

## 行为

- 员工录单逐商品多选图片，每商品 5 张，取消整单 8 张上限；单图格式、体积及像素限制沿用现有规则。
- 本机 IndexedDB 保存文件，localStorage 仅存草稿引用；按账号、草稿和商品 UUID 隔离。识别替换可撤销，明确移除商品及放弃草稿清理未提交文件。
- 创建商品接受可选 itemId，创建幂等指纹兼容未传 itemId 的旧请求。创建后先保存订单 ID 和上传队列，再清理录单草稿。
- 图片接口要求有效 itemId；上传 Idempotency-Key 在订单内唯一，事务中检查每商品额度及请求指纹。重试不重复图片、日志或事件，移除后的旧请求不复活图片。
- 详情图片随当前商品切换；失败队列可恢复和重试，历史未关联及超额图片保留。无图片上传或订单查看权限时不能提交带图草稿；图片读取、上传、删除权限分别保留。

## 自动验证

- 前端 `npm test`：143 项通过；`npm run build` 通过。
- `itemImages.browser.mjs`：6 项覆盖商品隔离、上限、恢复、多标签页冲突、存储失败、缺失文件、创建及上传响应丢失、转存失败、账号隔离、历史图片、权限、识别撤销和商品删除。
- `orderDraft.browser.mjs`：18 项原有草稿、登录过期、时间表单及客户填单回归通过。
- 后端相关单元及架构检查：139 项通过；`OrderExportIT`：28 项通过，包含两个商品各 5 张、上传幂等及指纹冲突、并发上限、删除释放额度、创建标识冲突及旧序列化兼容。

前端浏览器回归使用真实 Chromium 和 IndexedDB，HTTP 响应由测试模拟；后端集成验证使用本地 PostgreSQL/Redis 的独立随机 schema/namespace。集成测试进程设置固定 CUSTOMER_ENTRY_PUBLIC_ORIGIN，避免 dev.env 中的 auto 模式影响 integration profile。未对真实业务订单或服务器进行部署操作。

## 运行方式

```sh
cd frontend
npm test
npm run build
# 先在本地启动 Vite；PLAYWRIGHT_MODULE 指向本机可用的 playwright 包。
DRAFT_TEST_URL=http://127.0.0.1:5208 PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/itemImages.browser.mjs tests/orderDraft.browser.mjs
```

后端使用 JDK 21 和本地集成配置：

```sh
CUSTOMER_ENTRY_PUBLIC_ORIGIN=http://localhost:5173 ./mvnw -pl WuhouCake-bootstrap -am -Pintegration verify \
  '-Dtest=*Image*Test,*File*Test,*Creation*Test,OrderTest,*Architecture*Test,OrderStreamTransactionsTest' \
  -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=OrderExportIT -Dfailsafe.failIfNoSpecifiedTests=false
```

上线须先备份数据库，再通过 Flyway 执行 V23 新增的上传幂等记录表及有效商品图片索引；不更改历史图片归属或批量删除历史图片。
