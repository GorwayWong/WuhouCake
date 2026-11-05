# 前台订单详情布局与订购方式验证

## 已实现

前台详情按标注图使用三行两列信息，再展示整行地址、当前商品特殊要求、图片及下单时间。补充资料默认收起，付款直接可见；状态进度和状态操作沿用现有实现。制作岗位保持原布局。

新增整单 `orderingMethod`，员工新建及资料编辑可选填，去除首尾空白后最多 80 字符，空内容保存为 `null`。草稿可恢复，旧请求可省略。详情按业务详情权限返回；资料修改保留并发版本校验及前后值审计。迁移 `V24__order_ordering_method.sql` 增加可空列，未回填旧单。

## 验证结果

- `rtk mvn verify -q` 单元测试和 ArchUnit 检查通过；新增创建兼容、权限过滤及 80 字符归一化边界随后定向复验通过。
- `OrderIT` 全量 41 项通过，覆盖真实 HTTP、数据库及原有状态流程；归一化边界调整后再次定向运行新增字段的集成用例，通过。覆盖创建、回读、修改、清空、超长拒绝、旧客户端、省略字段、并发 409、持久化及审计。
- `npm test` 152 项通过，`npm run build` 通过；构建仍有现有的大 bundle 提示。
- `orderDetail.browser.mjs` 与 `itemImages.browser.mjs` 共 8 项通过。覆盖新建草稿刷新恢复、订购方式提交与编辑、多商品名称／要求／图片联动、清空规范要求不恢复历史内容、图片大图、资料折叠、编辑期间禁止商品切换，以及制作岗位的原布局。
- 390px 与 1280px Chromium 检查前三行两列、长名称、长地址及无横向溢出；截图已人工查看。图片回归覆盖上传、队列、响应丢失、历史图片和权限限制。
- `git diff --check` 通过。

## 命令

```sh
rtk mvn verify -q
rtk mvn -Pintegration -pl WuhouCake-bootstrap -am -Dit.test=OrderIT -Dfailsafe.failIfNoSpecifiedTests=false verify -q
cd frontend
rtk npm test
rtk npm run build
# Vite 在 127.0.0.1:5197 运行后，替换为本机 Playwright 包路径：
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/orderDetail.browser.mjs tests/itemImages.browser.mjs
```

## 环境与边界

使用 JDK 25（编译目标 Java 21）、本机专用 PostgreSQL／Redis、随机测试 schema 及 Redis 命名空间；集成结束清理测试数据。首次新增审计断言中的 PostgreSQL `?` 运算符与 JDBC 参数占位符冲突，改为 `jsonb_exists` 后全量 OrderIT 通过。一次最终定向复验受沙箱限制无法附加 Mockito agent，在沙箱外重跑通过。浏览器使用模拟 API，真实持久化由 OrderIT 覆盖。

截图位于 `/private/tmp/wuhou-detail-390.png`、`/private/tmp/wuhou-detail-1280.png`，为临时验证产物。尚未部署或对生产数据库执行迁移；桌面 Chromium 手机视口不代表真实 iPhone Safari 验收。保留仓库原有未提交工作。

## 商品区域续改

商品资料已移出补充资料区，直接位于下单时间之后。名称整行、数量／规格两列、蛋糕内胚／夹馅／奶油三列，非蛋糕价格／会员价两列；付款位于商品之后，默认折叠的工作备注位于付款之后。补充资料保留客户次要信息、商品备齐、祝福语、历史属性和最近商品备注，导出继续位于下方。制作岗位沿用共用 Product 及原有排列，本轮没有后端、数据库或计价规则变更。

本轮前端 152 项测试、8 项订单详情／图片浏览器回归及构建通过，布局扫描无发现，`git diff --check` 通过；新增浏览器用例覆盖直接展示的商品资料、混合品类切换、长参数三列、价格权限、编辑新增移除、最后一件保护，以及整单付款和整单／商品备注。手机／桌面截图位于 `/private/tmp/wuhou-product-detail-390.png`、`/private/tmp/wuhou-product-detail-1280.png`，非蛋糕价格截图位于 `/private/tmp/wuhou-product-prices-390.png`。
