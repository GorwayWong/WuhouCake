# Order · Slice A / B1 / B2 / C0 / C0.5

订单模块提供多商品正式订单、资料更正、商品增减与修改、整单制作、配送或自提交接、完成、人工取消、付款状态纠正、独立备注、业务历史和提交后的 SSE 通知。Bootstrap 显式装配；业务写入事务由 `OrderService` 管理。员工使用现有登录流程取得 Bearer token，且须先完成初始密码修改。

## HTTP 接口

REST 响应使用 `ApiResponse`。创建订单、追加商品和追加备注返回 201，其他查询和修改返回 200。SSE 直接返回 `text/event-stream`，不套用 `ApiResponse`。

| 方法和路径 | 行为 |
| --- | --- |
| `POST /api/orders` | 创建正式订单，返回详情和服务端生成的 orderId、itemId |
| `GET /api/orders/{orderId}` | 订单基础信息、有效商品、每个商品最近三条 NOTE |
| `PATCH /api/orders/{orderId}` | 携带 expectedVersion、itemId、changes 修改单个商品 |
| `PATCH /api/orders/{orderId}/information` | 携带 expectedVersion、changes 局部更正客户、交接计划和约定总金额 |
| `POST /api/orders/{orderId}/items` | 携带 expectedVersion、item 追加商品，服务端生成 itemId，返回最新订单详情 |
| `POST /api/orders/{orderId}/items/{itemId}/remove` | 携带 expectedVersion 软删除商品，返回最新订单详情 |
| `PATCH /api/orders/{orderId}/payment-status` | 携带 expectedVersion、paymentStatus 手工修改付款状态 |
| `POST /api/orders/{orderId}/production-actions` | 携带 expectedVersion、action 手工确认整单制作进度 |
| `POST /api/orders/{orderId}/fulfillment-actions` | 携带 expectedVersion、action 开始配送、确认送达或确认取货 |
| `POST /api/orders/{orderId}/cancel` | 携带 expectedVersion、必填 reason 人工取消未完成订单 |
| `POST /api/orders/{orderId}/notes` | 追加备注；itemId 可空，空值代表订单级备注 |
| `GET /api/orders/{orderId}/activities` | 独立分页查询，支持 itemId、type、page、size |
| `GET /api/orders/stream` | 带 Bearer header 订阅本进程中的订单变化；匿名或过期 JWT 返回 401 |

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

资料 PATCH 请求示例：

```json
{
  "expectedVersion": 0,
  "changes": {
    "phone": "13900000000",
    "address": "新配送地址",
    "plannedHandoffAt": "2026-10-17T12:00:00+08:00",
    "memberPhone": null,
    "totalAmountCents": 28000
  }
}
```

资料 changes 只接受 customerName、phone、memberPhone、buyerName、fulfillmentType、address、requestedReceiveDate、plannedHandoffAt、plannedFinishAt、totalAmountCents。未提交的字段保留原值；可选字段允许显式 null，电话、收货日期、计划交接时间、交接类型及配送单地址仍须满足创建订单的值对象约束。所有状态均允许普通资料和金额更正，不改变制作状态、节点或商品；完成或取消状态保持原值。totalAmountCents 是员工确认的约定金额，不按商品报价计算，null 与零含义不同。

交接类型也允许在所有状态更正，以活动日志追溯误操作。WAITING_DELIVERY、WAITING_PICKUP 随目标类型调整为相应待交接状态；DELIVERING 更正为 PICKUP 后进入 WAITING_PICKUP。待制作、制作中、COMPLETED 和 CANCELLED 保持原状态。切换不退回制作、不修改制作节点或商品状态；配送类型仍必须有地址，同一请求可一并更正地址。资料活动同时记录 fulfillmentType 及实际发生变化的 status，操作人和时间由服务端提供。没有新增撤销配送或撤销完成的动作。

追加商品请求示例：

```json
{
  "expectedVersion": 1,
  "item": { "name": "商品 C", "productType": "CAKE", "quantity": 1,
    "unitPriceCents": 10000, "attributes": { "size": "6寸" } }
}
```

追加商品复用创建商品的快照和校验，itemId 由服务端生成。待制作商品为 NOT_STARTED，制作中追加商品为 IN_PROGRESS，商品 currentStageCode 保持 null。制作中追加任何类型商品均清空已确认的整单节点，员工须重新确认夹层、抹面；系统不自动确认工序。追加只允许在 WAITING_PRODUCTION 或 PROCESSING，待交接时须先 REOPEN_PRODUCTION。增减商品均不自动调整约定金额。

商品修改仅允许在 WAITING_PRODUCTION 或 PROCESSING。进入待配送或待自提后，须先执行 REOPEN_PRODUCTION 退回制作中，再修改商品并重新确认完成；禁止修改时返回 `409 ORDER_NOT_EDITABLE`。通用 PATCH 不接受制作字段或订单状态。

移除商品请求为 `{"expectedVersion":0}`，仅允许在 WAITING_PRODUCTION 或 PROCESSING，待交接时须先 REOPEN_PRODUCTION。至少保留一件有效商品，移除最后一件返回 `400 VALIDATION_FAILED`。移除使用 is_removed，保留原商品内容、制作状态及历史，不修改其他商品或整单制作节点。普通详情隐藏已移除商品；`activities?itemId=<原商品 UUID>` 仍可查询其历史，其他订单的商品 ID 返回 404。已移除商品不能再修改或追加商品备注。重复移除仅校验当前数据库版本，不改版本、时间、活动或通知。

新订单状态为 WAITING_PRODUCTION，付款为 UNPAID，version 从 0 开始。有效商品修改成功后，订单版本加一，订单及目标商品的 updatedAt 由服务端更新；其他商品不变。版本冲突返回 `409 CONCURRENT_MODIFICATION`；订单或所属有效商品不存在返回 `404 ORDER_NOT_FOUND`。修改与 ITEM_CHANGED 记录同事务提交，details.before / details.after 保存实际变化字段的旧值与新值。

备注请求为 `{"itemId":"<商品 UUID>","content":"客户要求少糖"}`。订单级备注只提交 content。备注不修改订单版本或商品更新时间；按商品查询备注可使用 `activities?itemId=<商品 UUID>&type=NOTE`。活动类型为 CREATED、ITEM_CHANGED、NOTE、PAYMENT_STATUS_CHANGED、ORDER_PRODUCTION_CHANGED、ORDER_FULFILLMENT_CHANGED、ORDER_CANCELLED、ORDER_INFORMATION_CHANGED、ITEM_ADDED、ITEM_REMOVED；page 从 1 开始，size 默认 20、最大 100。商品最近备注按 createdAt、活动 id 倒序取三条，订单级备注不混入商品备注。

资料修改、增减商品分别追加 ORDER_INFORMATION_CHANGED、ITEM_ADDED、ITEM_REMOVED，同事务推进一次订单版本并写入真实前后值、服务端操作人及时间。追加记录 details.before.item=null、details.after.item=新增快照，节点清空时同时记录 currentStageCode 的旧值和 null。移除记录完整商品快照及 isRemoved 的 false→true，不物理删除原商品。

操作人 ID、昵称快照和时间来自服务端，不接受客户端指定。详情返回稳定 orderId / itemId、Order.version / updatedAt / currentStageCode、OrderItem.updatedAt / productionStatus / currentStageCode。时间使用带偏移的 ISO 8601 输入和 UTC 输出，持久化精度为微秒。

## 付款状态与整单制作

付款状态请求示例：

```json
{ "expectedVersion": 0, "paymentStatus": "PAID" }
```

付款支持 UNPAID、PAID 双向手工纠正，不受订单状态限制，完成或取消后仍可纠正。实际变更推进订单版本、更新订单时间并追加 PAYMENT_STATUS_CHANGED，details.before / details.after 记录付款旧值与新值，商品不变。同值请求仍校验数据库当前版本，但不写数据或活动。付款数据与活动同事务提交或回滚；没有支付网关、付款流水、退款和对账。

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

两商品制作链路：创建订单（version 0）→付款 PAID（1）→START_PRODUCTION（2）→COMPLETE_LAYER（3）→COMPLETE_FROSTING（4）→COMPLETE_PRODUCTION（5）→查询订单与 activities。需要修改时，先 REOPEN_PRODUCTION，再修改商品，最后 COMPLETE_PRODUCTION；每次请求使用上一步返回的版本。

V4 为 cake_order 添加可空 current_stage_code，已有订单默认 null；V3 保持不变，Flyway 沿用现有初始化方式。

## 交接、完成与人工取消

交接请求发送到 `POST /api/orders/{orderId}/fulfillment-actions`：

```json
{ "expectedVersion": 5, "action": "START_DELIVERY" }
```

| 动作 | 交接方式与前置状态 | 目标状态 |
| --- | --- | --- |
| START_DELIVERY | DELIVERY / WAITING_DELIVERY | DELIVERING |
| COMPLETE_DELIVERY | DELIVERY / DELIVERING | COMPLETED |
| CONFIRM_PICKUP | PICKUP / WAITING_PICKUP | COMPLETED |

配送单必须先开始配送，才能确认送达；自提单直接确认取货。两种方式不能混用动作，制作未完成不能交付，也不能重复完成。合法交接返回 200 和订单详情，推进一次 version、更新 Order.updatedAt，并追加订单级 ORDER_FULFILLMENT_CHANGED。活动 details.action 记录动作，details.before.status / details.after.status 记录状态；操作者、昵称快照和时间来自服务端。

配送闭环：WAITING_PRODUCTION → START_PRODUCTION → PROCESSING → COMPLETE_PRODUCTION → WAITING_DELIVERY → START_DELIVERY → DELIVERING → COMPLETE_DELIVERY → COMPLETED。自提闭环：WAITING_PRODUCTION → START_PRODUCTION → PROCESSING → COMPLETE_PRODUCTION → WAITING_PICKUP → CONFIRM_PICKUP → COMPLETED。夹层、抹面仍是可选整单节点；每次修改使用前一次返回的版本。

人工取消请求发送到 `POST /api/orders/{orderId}/cancel`：

```json
{ "expectedVersion": 5, "reason": "客户确认取消" }
```

reason 必填且不能仅含空白，按现有文本规则去除首尾空白。WAITING_PRODUCTION、PROCESSING、WAITING_DELIVERY、WAITING_PICKUP、DELIVERING 均可取消；COMPLETED、CANCELLED 不能再取消。成功后返回 200 和 CANCELLED 订单详情，推进一次版本、更新订单时间，并追加 ORDER_CANCELLED。取消原因保存在活动 content，details.before.status / details.after.status 记录状态，可通过 `GET /api/orders/{orderId}/activities?type=ORDER_CANCELLED` 查询。

交接与取消均保留商品制作状态、商品更新时间和既有制作节点，不删除商品、备注或历史。取消不自动修改 PAID/UNPAID，退款暂由人工处理。完成或取消后禁止商品修改、制作与交接，仍允许追加备注和按原有规则纠正付款。

非法交接返回 `409 INVALID_FULFILLMENT_TRANSITION`，终态取消返回 `409 ORDER_NOT_CANCELLABLE`；旧版本返回 `409 CONCURRENT_MODIFICATION`。未知动作、空原因及非法版本返回 400，订单不存在返回 404，未认证返回 401。订单状态条件更新、活动与事件生成在同一事务内；回滚或版本冲突不提交状态或日志，也不发送 SSE。C0/C0.5 沿用现有表结构，没有新增表或迁移。

## SSE 与前端接入

使用能携带 Bearer 请求头的 Fetch SSE 客户端，按 SSE 帧解析响应并处理断线重连。请求示例：

```js
const response = await fetch("/api/orders/stream", {
  headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/event-stream" },
  signal: abortController.signal
});
```

建立连接后先收到 `ready`，data 为 `{}`。数据库事务提交成功后，所有已连接员工（包括发起修改的员工）收到 `order.changed`：

```text
event: order.changed
data: {"orderId":"<UUID>","itemId":null,"changeType":"ORDER_PRODUCTION_CHANGED","version":5}

```

| changeType | 触发条件 | itemId / version |
| --- | --- | --- |
| CREATED | 创建订单 | null / 0 |
| ITEM_CHANGED | 商品发生实际修改 | 目标商品 ID / 修改后版本 |
| ORDER_INFORMATION_CHANGED | 订单资料或约定金额实际改变 | null / 修改后版本 |
| ITEM_ADDED | 追加商品成功，包含可能的整单节点清空 | 新商品 ID / 修改后版本 |
| ITEM_REMOVED | 商品软删除成功 | 原商品 ID / 修改后版本 |
| NOTE | 成功追加备注 | 商品 ID 或 null / 当前订单版本 |
| PAYMENT_STATUS_CHANGED | 付款状态实际改变 | null / 修改后版本 |
| ORDER_PRODUCTION_CHANGED | 整单制作动作成功 | null / 修改后版本 |
| ORDER_FULFILLMENT_CHANGED | 整单交接动作成功 | null / 修改后版本 |
| ORDER_CANCELLED | 人工取消成功 | null / 修改后版本 |

夹层、抹面仍是整单节点，通知的 itemId 为 null。通知仅含四个定位字段，不含客户资料、备注正文、取消原因、付款详情或凭证。校验失败、409 冲突、事务回滚及提交失败均不通知；同值资料、商品或付款 PATCH，以及重复移除均不通知，但仍校验数据库当前版本。发送失败只清理相应连接，不影响订单提交或其他客户端。

前端收到 `order.changed` 后，自动使对应订单详情及列表、日历缓存失效，并通过 REST 重取数据。详情使用 `GET /api/orders/{orderId}`，备注可使用现有 activities 查询。`NOTE` 即使 version 未变化也必须重取备注，不能按版本相同忽略通知。更新查询缓存时保留员工正在编辑且尚未保存的表单，使用最新版本提示或处理已有 409 冲突。

首次连接收到 ready、连接断开、重连成功和页面重新聚焦时，主动获取最新 REST 数据。每 15 秒发送一条 `:heartbeat` 注释，客户端忽略即可。每条连接最长 5 分钟，且不超过本次 JWT 剩余有效期；连接到期后重新连接，JWT 过期则先使用现有 `/api/auth/refresh` 流程取得新 token。

通知使用单实例进程内连接管理和提交后监听，不持久化、不重放，也不支持 Last-Event-ID 恢复。断线期间的变化靠 REST 重取补齐。当前仓库没有前端项目，本模块仅提供订阅协议与接入契约。

## 验证

在仓库根目录使用 Java 21：

```sh
rtk proxy ./mvnw -pl WuhouCake-order,WuhouCake-bootstrap -am verify
rtk proxy ./mvnw -pl WuhouCake-bootstrap -am -Pintegration -Dit.test=OrderIT,InfrastructureIT -Dfailsafe.failIfNoSpecifiedTests=false verify
```

OrderIT 复用现有 integration 配置、JWT 测试密钥、隔离 schema 和 Redis namespace，需要现有 PostgreSQL、Redis 可连接。连接配置见 Bootstrap 的 application-integration.yml；测试不会修改真实订单。

OrderTest 和 OrderServiceTest 验证制作、付款、商品修改，以及交接顺序、方式区分、取消原因、数据保留和事件生成；C0.5 覆盖所有状态资料与类型更正、字段清空与无变化版本检查、追加后的整单节点清空、至少一件有效商品及软删除后的历史归属。OrderStreamsTest 验证连接生命周期、JWT 到期、心跳、串行发送、队列上限和故障隔离；OrderStreamTransactionsTest 使用 Spring 事务管理器和 mock JDBC 验证提交后通知、回滚与提交失败不通知，覆盖三个新入口。OrderStreamWebTest 复用现有安全链验证认证、参数校验、错误包络及 SSE 协议。

OrderIT 包含两商品创建→更正资料→追加 C→移除 B→查询 B 历史→人工重新确认制作的闭环，以及待交接、配送中和终态的交接类型更正。两个写操作到达持久化后再竞争同一版本，分别检查资料与追加、两件商品同时移除只有一次提交；另验证无变化资料在读取后遇到并发追加时返回冲突。数据库活动写入失败、外层事务回滚均检查原数据、版本、活动和 SSE，在线员工收到通知后通过 REST 重取详情。

2026-10-12 Slice C0 验证：使用现有开发 Compose 的 PostgreSQL 17、Redis 7，Java 21 下 integration Maven verify 和 ArchUnit 检查通过。订单模块 55 项、bootstrap 25 项常规检查及 OrderIT 15 项、InfrastructureIT 5 项真实集成检查全部通过，无失败或跳过。已验证 Slice A/B1/B2/C0 的订单持久化、制作与交接闭环、取消、版本竞争、活动失败及事务回滚，以及其他员工收到 SSE 后通过 REST 查询最新状态和备注。

2026-10-13 Slice C0.5 验证：使用现有开发 Compose 的 PostgreSQL、Redis，Java 21 下上述两条 Maven verify 命令均通过。订单模块 82 项、bootstrap 25 项常规检查及 OrderIT 23 项、InfrastructureIT 5 项真实集成检查全部通过，无失败或跳过，包含 ArchUnit。已验证两商品订单的资料更正、追加 C、移除 B、B 历史查询及人工重新确认制作；资料和商品增减的数据库版本竞争、活动失败及外层回滚均无部分更新或错误通知。待交接、配送中及终态的类型更正已验证，其他在线员工可在收到 SSE 后通过 REST 重取最新详情。

技术行为参考：[Spring 事务绑定事件](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)与 [MyBatis 更新行数及命名参数契约](https://github.com/mybatis/mybatis-3/blob/master/src/site/markdown/java-api.md)。

本期止于 C0.5 订单变更，不开发 Slice C1、日历、前端、AI 识别、服务端草稿、自动计价或商品级工序。
