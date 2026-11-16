# 出货付款与付款日期统计区分

## 10 月 20 日差异核对

以 REPEATABLE READ、READ ONLY 事务查询现有数据：订单 0000010 的收货日期为 2026-10-20、当前已付款、金额 88800 分；操作记录 96 显示它于北京时间 2026-10-17 18:42:26 从 UNPAID 改为 PAID，历史 paid_at 字段为空。

因此 888 元计入 10 月 20 日出货订单的已付款金额；该订单的付款标记操作发生在 17 日，不能计为 20 日付款。同时，因为历史付款日期字段缺失，目前也未归入任何付款日期汇总。20 日付款日期查询实际返回 0 笔、0 分。该零值只表示没有可归到当天的付款日期记录，不能说明没有收到钱。未修改、回填或重新标记付款。

## 界面与只读契约

- 出货汇总增加“按出货日”标签，说明统计这天出货的订单及当前付款状态、包括提前付款；表头改为“当前付款状态”“出货订单金额”。
- 原“收款汇总”改名为“付款标记汇总”，增加“按付款标记日”标签；说明出货日期不限、依据人工标记且不是支付流水。
- 零记录有专门说明：出货订单可能提前付款或未记录付款日期，避免将零记录解释成未收款。
- 出货付款汇总接口新增只读 `paidWithoutDateOrderCount`：同一有效出货范围内 PAID 且 paid_at 为空的订单数。计数大于零时显示黄色“付款日期待核对”，并说明这些订单未计入按付款标记日统计。
- 不改变原有金额、付款分组或日期筛选，不新增迁移。仍要求金额读取权限；制作岗位不展示金融汇总或缺失日期信息，也不发送这些接口请求。

## 验证

| 检查 | 结果 |
| --- | --- |
| 订单模块单元测试及模块 ArchUnit | PASS，191 项 |
| bootstrap 单元及全局 ArchUnit，排除既有装配失败的 OrderStreamWebTest | PASS，38 项 |
| 出货付款汇总 HTTP／数据库集成 | PASS，1 项 |
| shippingPayment、calendarStatus 前端测试 | PASS，6 项 |
| TypeScript／Vite 构建 | PASS，保留原有 bundle 大小提示 |
| git diff --check | PASS |

集成验证计数不改变付款金额分组，排除已取消订单、未付款订单及其他出货日。接口切片中的响应 fixture 已同步新字段；OrderStreamWebTest 原有缺少 OrderPackageService Bean 的装配问题未在本次处理。

浏览器使用独立 5174 前端与 18081 内存接口夹具，不连接业务数据库。验证了 888／0 加缺失日期提醒、记录完整时无提醒、非零付款日期记录不显示零状态说明、320／390／1280 宽度及制作岗位权限。制作岗位不发送 payment-summary／receipt-summary 请求。

截图：[手机](assets/2026-10-23-payment-basis-mobile.png)、[桌面](assets/2026-10-23-payment-basis-desktop.png)。

主要验证命令：

```bash
./mvnw -Pintegration -pl WuhouCake-bootstrap -am verify \
  '-Dtest=*Test,!OrderStreamWebTest' -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=OrderIT#shippingPaymentSummaryCountsOrdersOnceAndIgnoresListFilters' \
  -Dfailsafe.failIfNoSpecifiedTests=false
cd frontend
node --experimental-strip-types --test tests/shippingPayment.test.ts tests/calendarStatus.test.ts
npm run build
```

## 现有工作台

按原配置重启 8080 后端与 5173 前端，均已加载本次改动，健康／就绪检查 UP。业务表内容指纹重启前后全部一致：13 张表，订单 13 笔、商品 23 条、操作记录 143 条；没有对原订单调用写接口。

备份及核对结果在 `/var/folders/4f/k4pz80756g15mx0tfw3pg_cc0000gn/T/wuhou-backend-restart-20261023-8rniz_hw/`，包含 business-public.dump、restart-result.json、backend.log。备份目录权限 700、文件权限 600，系统临时目录不作为长期归档。原有未提交改动保留，本次未提交或推送。
