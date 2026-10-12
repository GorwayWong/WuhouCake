# Order · Slice A / B1

订单模块提供多商品正式订单、商品修改、整单手工制作进度、付款状态纠正、独立备注和业务历史。Bootstrap 显式装配；业务写入事务由 `OrderService` 管理。员工使用现有登录流程取得 Bearer token，且须先完成初始密码修改。

## HTTP 接口

所有响应使用 `ApiResponse`。创建订单和追加备注返回 201，查询和修改返回 200。

| 方法和路径 | 行为 |
| --- | --- |
| `POST /api/orders` | 创建正式订单，返回详情和服务端生成的 orderId、itemId |
| `GET /api/orders/{orderId}` | 订单基础信息、有效商品、每个商品最近三条 NOTE |
| `PATCH /api/orders/{orderId}` | 携带 expectedVersion、itemId、changes 修改单个商品 |
| `PATCH /api/orders/{orderId}/payment-status` | 携带 expectedVersion、paymentStatus 手工修改付款状态 |
| `POST /api/orders/{orderId}/production-actions` | 携带 expectedVersion、action 手工确认整单制作进度 |
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

商品修改仅允许在 WAITING_PRODUCTION 或 PROCESSING。进入待配送或待自提后，须先执行 REOPEN_PRODUCTION 退回制作中，再修改商品并重新确认完成；禁止修改时返回 `409 ORDER_NOT_EDITABLE`。通用 PATCH 不接受制作字段或订单状态。

新订单状态为 WAITING_PRODUCTION，付款为 UNPAID，version 从 0 开始。有效商品修改成功后，订单版本加一，订单及目标商品的 updatedAt 由服务端更新；其他商品不变。版本冲突返回 `409 CONCURRENT_MODIFICATION`；订单或所属有效商品不存在返回 `404 ORDER_NOT_FOUND`。修改与 ITEM_CHANGED 记录同事务提交，details.before / details.after 保存实际变化字段的旧值与新值。

备注请求为 `{"itemId":"<商品 UUID>","content":"客户要求少糖"}`。订单级备注只提交 content。备注不修改订单版本或商品更新时间；按商品查询备注可使用 `activities?itemId=<商品 UUID>&type=NOTE`。活动类型为 CREATED、ITEM_CHANGED、NOTE、PAYMENT_STATUS_CHANGED、ORDER_PRODUCTION_CHANGED；page 从 1 开始，size 默认 20、最大 100。商品最近备注按 createdAt、活动 id 倒序取三条，订单级备注不混入商品备注。

操作人 ID、昵称快照和时间来自服务端，不接受客户端指定。详情返回稳定 orderId / itemId、Order.version / updatedAt / currentStageCode、OrderItem.updatedAt / productionStatus / currentStageCode。时间使用带偏移的 ISO 8601 输入和 UTC 输出，持久化精度为微秒。

## 付款状态与整单制作

付款状态请求示例：

```json
{ "expectedVersion": 0, "paymentStatus": "PAID" }
```

付款支持 UNPAID、PAID 双向手工纠正，不受制作阶段限制。实际变更推进订单版本、更新订单时间并追加 PAYMENT_STATUS_CHANGED，details.before / details.after 记录付款旧值与新值，商品不变。同值请求仍校验数据库当前版本，但不写数据或活动。付款数据与活动同事务提交或回滚；没有支付网关、付款流水、退款和对账。

制作请求示例：

```json
{ "expectedVersion": 1, "action": "START_PRODUCTION" }
```

| 动作 | 允许条件 | 结果 |
| --- | --- | --- |
| START_PRODUCTION | WAITING_PRODUCTION | 进入 PROCESSING，有效商品同步为 IN_PROGRESS |
| COMPLETE_LAYER | PROCESSING，整单节点为空 | 整单节点变为 LAYER_DONE |
| COMPLETE_FROSTING | PROCESSING，整单节点为 LAYER_DONE | 整单节点变为 FROSTING_DONE |
| COMPLETE_PRODUCTION | PROCESSING，任意节点 | 配送单进入 WAITING_DELIVERY，自提单进入 WAITING_PICKUP；有效商品同步为 COMPLETED |
| REOPEN_PRODUCTION | WAITING_DELIVERY 或 WAITING_PICKUP | 退回 PROCESSING，清空整单节点，有效商品同步为 IN_PROGRESS |

制作进度由员工按整单确认，不按产品类型配置流程。夹层、抹面均为可选节点，预制品或纸杯等订单可以开始后直接完成。COMPLETE_PRODUCTION 表示员工已确认所有有效商品备齐，系统不检查各商品是否经过夹层、抹面。

整单 currentStageCode 保存最近完成的节点，完成制作时保留，退回时清空。夹层、抹面不写商品 currentStageCode，也不改变商品时间；商品节点字段保留供后续独立进度使用。开始、完成和退回只同步未移除商品的制作状态，只有状态实际变化的商品更新 updatedAt，商品内容不变。

每个有效制作动作推进一次订单版本、更新订单时间，追加订单级 ORDER_PRODUCTION_CHANGED（itemId 为空）。details.action 记录动作；details.before / details.after 记录订单状态与节点；details.itemChanges 仅记录实际变化商品的 itemId 及制作状态 before / after。查询活动可使用 `activities?type=ORDER_PRODUCTION_CHANGED`，操作人、时间及商品修改记录可用于追溯人工确认和退回后的修改。

重复动作、越序动作返回 `409 INVALID_PRODUCTION_TRANSITION`；过期版本返回 `409 CONCURRENT_MODIFICATION`。未知动作、非法付款值和非法版本返回 400，订单不存在返回 404。修改订单、同步商品和追加活动必须同时成功；同版本并发修改仅一项成功。

两商品闭环：创建订单（version 0）→付款 PAID（1）→START_PRODUCTION（2）→COMPLETE_LAYER（3）→COMPLETE_FROSTING（4）→COMPLETE_PRODUCTION（5）→查询订单与 activities。需要修改时，先 REOPEN_PRODUCTION，再修改商品，最后 COMPLETE_PRODUCTION；每次请求使用上一步返回的版本。

V4 为 cake_order 添加可空 current_stage_code，已有订单默认 null；V3 保持不变，Flyway 沿用现有初始化方式。

## 验证

在仓库根目录使用 Java 21：

```sh
rtk proxy ./mvnw -pl WuhouCake-order,WuhouCake-bootstrap -am verify
rtk proxy ./mvnw -pl WuhouCake-bootstrap -am -Pintegration -Dit.test=OrderIT -Dfailsafe.failIfNoSpecifiedTests=false verify
```

OrderIT 复用现有 integration 配置、JWT 测试密钥、隔离 schema 和 Redis namespace，需要现有 PostgreSQL、Redis 可连接。连接配置见 Bootstrap 的 application-integration.yml；测试不会修改真实订单。

OrderTest 和 OrderServiceTest 验证制作规则、付款纠正、商品独立修改及同值付款的版本检查。OrderIT 覆盖 Slice A 数据库验证、整单闭环、节点跳过、退回修改、并发版本冲突和活动写入失败回滚。

2026-10-12 验证：Java 21 下 Maven verify 和既有 ArchUnit 检查通过，订单模块 17 项检查全部通过。OrderIT 已尝试运行，但应用启动时 PostgreSQL localhost:5432 拒绝连接，尚未执行真实数据库用例，也未进入 Redis 验证；Slice A 和 B1 的真实数据库验证待环境恢复后执行上述集成命令。

Slice B2 再实现成功提交后的 SSE 通知；后续配送、交付完成和取消不在本期范围。本模块没有 SSE 发布器、事件总线或订阅器；未来 NOTE_ADDED 通知须直接触发备注重查，不能只依赖订单 version。
