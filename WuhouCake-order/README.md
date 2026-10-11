# Order · Slice A

订单模块提供多商品正式订单、商品修改、独立备注和业务历史。Bootstrap 显式装配；业务写入事务由 `OrderService` 管理。员工使用现有登录流程取得 Bearer token，且须先完成初始密码修改。

## HTTP 接口

所有响应使用 `ApiResponse`。创建订单和追加备注返回 201，查询和修改返回 200。

| 方法和路径 | 行为 |
| --- | --- |
| `POST /api/orders` | 创建正式订单，返回详情和服务端生成的 orderId、itemId |
| `GET /api/orders/{orderId}` | 订单基础信息、有效商品、每个商品最近三条 NOTE |
| `PATCH /api/orders/{orderId}` | 携带 expectedVersion、itemId、changes 修改单个商品 |
| `POST /api/orders/{orderId}/notes` | 追加备注；itemId 可空，空值代表订单级备注 |
| `GET /api/orders/{orderId}/activities` | 独立分页查询，支持 itemId、type、page、size |

创建请求示例：

```json
{
  "customer": { "customerName": "客户", "phone": "13800000000" },
  "fulfillment": {
    "type": "DELIVERY",
    "address": "示例配送地址",
    "requestedReceiveDate": "2026-10-16",
    "plannedHandoffAt": "2026-10-16T10:00:00+08:00"
  },
  "items": [
    { "name": "生日蛋糕", "productType": "CAKE", "quantity": 1,
      "unitPriceCents": 10000, "attributes": { "size": "8寸", "flavors": ["芒果"] } },
    { "name": "纸杯蛋糕", "productType": "CUPCAKE", "quantity": 6,
      "attributes": { "flavor": "香草" } }
  ]
}
```

客户电话、期望收货日期、计划交接时间和至少一个商品必填；DELIVERY 必须有地址，PICKUP 可不填地址。customerName、memberPhone、buyerName、plannedFinishAt 和 totalAmountCents 可选。商品类型默认 CAKE，attributes 默认空对象。商品报价和订单总额是非负整数分；未填写金额和零金额含义不同，不自动计算订单实收。

PATCH 请求示例（替换占位 itemId）：

```json
{
  "expectedVersion": 0,
  "itemId": "<详情中的商品 UUID>",
  "changes": {
    "quantity": 2,
    "memberPriceCents": null,
    "attributes": { "size": "10寸", "greeting": null }
  }
}
```

changes 只接受 name、productType、quantity、unitPriceCents、memberPriceCents、attributes。未提交的字段不变；报价为 null 时清空；规格按顶层键合并，null 删除该键，嵌套对象和数组整体替换。空修改、未知字段、非整数数量或金额返回 400。未发生实际变化时，版本、更新时间和活动数量保持不变；即使无实际变化，也必须提交当前版本。

新订单状态为 WAITING_PRODUCTION，付款为 UNPAID，version 从 0 开始。有效商品修改成功后，订单版本加一，订单及目标商品的 updatedAt 由服务端更新；其他商品不变。版本冲突返回 `409 CONCURRENT_MODIFICATION`；订单或所属有效商品不存在返回 `404 ORDER_NOT_FOUND`。修改与 ITEM_CHANGED 记录同事务提交，details.before / details.after 保存实际变化字段的旧值与新值。

备注请求为 `{"itemId":"<商品 UUID>","content":"客户要求少糖"}`。订单级备注只提交 content。备注不修改订单版本或商品更新时间；按商品查询备注可使用 `activities?itemId=<商品 UUID>&type=NOTE`。活动类型为 CREATED、ITEM_CHANGED、NOTE；page 从 1 开始，size 默认 20、最大 100。商品最近备注按 createdAt、活动 id 倒序取三条，订单级备注不混入商品备注。

操作人 ID、昵称快照和时间来自服务端，不接受客户端指定。详情返回稳定 orderId / itemId、Order.version / updatedAt、OrderItem.updatedAt / productionStatus / currentStageCode。时间使用带偏移的 ISO 8601 输入和 UTC 输出，持久化精度为微秒。

## 验证

在仓库根目录使用 Java 21：

```sh
rtk proxy ./mvnw -pl WuhouCake-order,WuhouCake-bootstrap -am verify
rtk proxy ./mvnw -pl WuhouCake-bootstrap -am -Pintegration -Dit.test=OrderIT -Dfailsafe.failIfNoSpecifiedTests=false verify
```

OrderIT 复用现有 integration 配置、JWT 测试密钥、隔离 schema 和 Redis namespace，需要现有 PostgreSQL、Redis 可连接。连接配置见 Bootstrap 的 application-integration.yml；测试不会修改真实订单。

Slice B 再实现付款修改、制作节点和成功提交后的 UI 通知。本模块没有 SSE 发布器、事件总线或订阅器；未来 NOTE_ADDED 通知须直接触发备注重查，不能只依赖订单 version。
