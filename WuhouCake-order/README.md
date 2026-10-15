# Order · Slice A / B1 / B2 / C0 / C0.5 / C1 · 图片与 Excel 导出

订单模块提供多商品正式订单、资料更正、商品增减与修改、整单制作、配送或自提交接、完成、人工取消、付款状态纠正、独立备注、业务历史、日历与当日工作台查询、提交后的 SSE 通知、参考图片及 Excel 导出。Bootstrap 显式装配，application 服务管理事务。员工使用现有登录流程取得 Bearer token，且须先完成初始密码修改。

## HTTP 接口

REST 响应使用 `ApiResponse`。创建订单、追加商品、追加备注和上传图片返回 201，其他查询和修改返回 200。SSE、图片内容与导出下载直接返回对应内容，不套用 `ApiResponse`；失败仍返回标准 JSON 错误。

| 方法和路径 | 行为 |
| --- | --- |
| `POST /api/orders` | 创建正式订单，返回详情和服务端生成的 orderId、itemId |
| `GET /api/orders/{orderId}` | 订单基础信息、有效商品、每个商品最近三条 NOTE |
| `POST /api/orders/{orderId}/images` | multipart：必填 file，可选 itemId，返回图片元数据 |
| `GET /api/orders/{orderId}/images` | 查询图片元数据，包括已移除商品的保留图片 |
| `GET /api/orders/{orderId}/images/{imageId}` | 认证后读取属于该订单的图片二进制 |
| `DELETE /api/orders/{orderId}/images/{imageId}` | 软移除本订单图片，返回 200 和 data=null；重复移除不重复记录 |
| `POST /api/orders/{orderId}/exports/xlsx` | 生成单订单 XLSX、记录活动并发起下载 |
| `POST /api/orders/exports/zip` | 按日期及业务条件生成每单一个 XLSX 的 ZIP |
| `GET /api/orders/calendar?from=2026-09-28&to=2026-11-09` | 周历、月历共用的订单列表，按客户期望收货日期分组 |
| `GET /api/orders/workbench?date=2026-09-30` | 指定日期的订单统计与未完成、未取消订单，附商品规格和独立最近三条备注 |
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

备注请求为 `{"itemId":"<商品 UUID>","content":"客户要求少糖"}`。订单级备注只提交 content。备注不修改订单版本或商品更新时间；按商品查询备注可使用 `activities?itemId=<商品 UUID>&type=NOTE`。活动类型为 CREATED、ITEM_CHANGED、NOTE、PAYMENT_STATUS_CHANGED、ORDER_PRODUCTION_CHANGED、ORDER_FULFILLMENT_CHANGED、ORDER_CANCELLED、ORDER_INFORMATION_CHANGED、ITEM_ADDED、ITEM_REMOVED、IMAGE_ADDED、IMAGE_REMOVED、ORDER_EXPORTED；page 从 1 开始，size 默认 20、最大 100。商品最近备注按 createdAt、活动 id 倒序取三条，订单级备注不混入商品备注。

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

## 日历与当日工作台

两个查询沿用现有 Bearer JWT、员工权限与 `ApiResponse`，成功返回 200；未认证返回 401。日期参数必填，格式为 `yyyy-MM-dd`。缺少参数、无效日期、空区间、反向区间或超过 42 天的日历范围返回 `400 VALIDATION_FAILED`。

### 日历

`GET /api/orders/calendar?from=2026-09-28&to=2026-11-09` 查询半开区间 `[from,to)`，包含 9 月 28 日，不包含 11 月 9 日，共 42 天。周历例如使用 `from=2026-09-28&to=2026-10-05`；周历与月历使用相同接口及 DTO，只改变范围。不要求请求从周一开始。

`data` 是订单数组，空结果为 `[]`。每笔订单仅出现一次，包含：

| 字段 | 含义 |
| --- | --- |
| `orderId`、`orderNo` | 订单标识与订单号 |
| `calendarDate` | 客户期望收货日期 `requestedReceiveDate` |
| `status`、`currentStageCode`、`paymentStatus` | 整单状态、最近确认的制作节点、付款状态 |
| `fulfillmentType`、`plannedHandoffAt` | DELIVERY/PICKUP、计划交接时刻（UTC ISO 8601） |
| `items` | 有效商品数组，每项包含 `itemId`、`name`、`quantity` |

按 `calendarDate`、`plannedHandoffAt`、`orderNo` 升序稳定排列，商品按创建时间、商品 ID 排序。历史日历包含 COMPLETED 和 CANCELLED；不返回客户资料、商品备注或完整活动历史。多个商品及数量不会将一笔订单重复计算。计划交接时间用于显示和排序，不能代替收货日期归日；只修改计划交接时间不会迁移日历日期，修改 `requestedReceiveDate` 才会将订单移到新日期。

### 工作台

`GET /api/orders/workbench?date=2026-09-30` 的 `data` 结构：

```json
{
  "date": "2026-09-30",
  "metrics": { "totalOrders": 8, "createdOnDate": 2, "deliveryDueOnDate": 4 },
  "pendingOrders": []
}
```

`pendingOrders` 仅包含所选收货日期中非 COMPLETED、非 CANCELLED 的订单，包含制作中、待制作、待交接和配送中的订单，也包含自提订单。排序与日历一致。每项保留日历的订单字段，另有 `customer`（customerName、phone、memberPhone、buyerName）、`address`、`plannedFinishAt`；`items` 改为包含以下内容的完整工作台商品视图：

- `itemId`、`name`、`productType`、`quantity`、`unitPriceCents`、`memberPriceCents`。
- `attributes`：完整规格快照，包含现有尺寸、口味、祝福语等键；未设置的报价仍为 null。
- `recentNotes`：该商品独立的最近三条 NOTE；每条包含 `id`、`itemId`、`actorId`、`actorNameSnapshot`、`createdAt`、`content`。按 `createdAt DESC, id DESC` 排序，备注人是创建备注时的昵称快照，不混入其他商品或订单级备注。没有备注时为 `[]`。

有效商品均排除 `is_removed=true`。制作进度仍以订单的 `status/currentStageCode` 为准，员工确认所有商品完成相应工序后再推进整单；查询不扩展商品制作字段或商品状态机。

| 指标 | 订单计数口径 |
| --- | --- |
| `totalOrders` | 系统全部订单，包含已完成、已取消，不受所选收货日期限制 |
| `createdOnDate` | 创建时刻处于门店当天 `[00:00,次日00:00)` 的订单，不受收货日期或状态限制 |
| `deliveryDueOnDate` | 当天收货、DELIVERY 且非 COMPLETED/CANCELLED 的订单，含待制作、制作中、待配送和配送中 |

门店日期使用 `Asia/Shanghai`；例如 9 月 30 日的创建统计区间为 UTC `2026-09-29T16:00:00Z` 至 `2026-09-30T16:00:00Z`，包含前者、不包含后者。指标按订单计算，商品数量不影响统计。空工作台仍返回三个统计值与空 `pendingOrders`。

Application 通过 Domain 纯 Java 只读端口访问 Infrastructure 的 MyBatis 查询。日历最多两次 SQL；工作台最多四次 SQL（统计、订单、商品、按 itemId 分组的备注），空集合跳过后续商品或备注查询。只读 `REPEATABLE_READ` 事务保证各次查询来自同一数据库快照；不加载订单聚合、不修改版本、不产生业务活动、不发送 SSE。

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
| IMAGE_ADDED | 参考图片上传成功 | 商品 ID 或 null / 当前订单版本 |
| IMAGE_REMOVED | 参考图片首次软移除成功 | 原商品 ID 或 null / 当前订单版本 |
| PAYMENT_STATUS_CHANGED | 付款状态实际改变 | null / 修改后版本 |
| ORDER_PRODUCTION_CHANGED | 整单制作动作成功 | null / 修改后版本 |
| ORDER_FULFILLMENT_CHANGED | 整单交接动作成功 | null / 修改后版本 |
| ORDER_CANCELLED | 人工取消成功 | null / 修改后版本 |

夹层、抹面仍是整单节点，通知的 itemId 为 null。通知仅含四个定位字段，不含客户资料、备注正文、取消原因、付款详情或凭证。校验失败、409 冲突、事务回滚及提交失败均不通知；同值资料、商品或付款 PATCH，以及重复移除商品均不通知，但仍校验数据库当前版本。图片写入不要求 expectedVersion，重复移除图片也不通知。发送失败只清理相应连接，不影响订单提交或其他客户端。

前端收到 `order.changed` 后，自动使对应订单详情及列表、日历缓存失效，并通过 REST 重取数据。日历重新请求当前可见的 `calendar?from=...&to=...`，工作台重新请求所选日期的 `workbench?date=...`；事件不携带旧、新收货日期，不能只在当前列表已有该订单时才刷新。详情使用 `GET /api/orders/{orderId}`，备注可使用现有 activities 查询。`NOTE` 即使 version 未变化也必须重取工作台备注，不能按版本相同忽略通知。更新查询缓存时保留员工正在编辑且尚未保存的表单，使用最新版本提示或处理已有 409 冲突。

首次连接收到 ready、连接断开、重连成功和页面重新聚焦时，主动获取最新 REST 数据。每 15 秒发送一条 `:heartbeat` 注释，客户端忽略即可。每条连接最长 5 分钟，且不超过本次 JWT 剩余有效期；连接到期后重新连接，JWT 过期则先使用现有 `/api/auth/refresh` 流程取得新 token。

通知使用单实例进程内连接管理和提交后监听，不持久化、不重放，也不支持 Last-Event-ID 恢复。断线期间的变化靠 REST 重取补齐。前端接入说明见 [frontend/README.md](../frontend/README.md)。

## 图片与 Excel 导出

图片仅能上传到已创建订单，可关联整单或当前有效商品；已完成、已取消订单同样允许上传。员工 ID、昵称与上传时间均取自服务端。`V5__add_order_images.sql` 创建 `cake_order_image`，以 PostgreSQL BYTEA 保存图片；复合外键约束商品归属。上传校验和数量检查通过后，在锁定订单行的短事务内插入图片及 IMAGE_ADDED 活动，并发布 OrderChanged；原有 AFTER_COMMIT 监听器仅在提交成功后发送 SSE。不修改订单版本、更新时间、付款、制作或交付状态。

上传不使用客户端 MIME 判断格式，而是检测实际 JPEG/PNG 内容、校验尺寸并完整解码。展示名去除目录和控制字符，仅作展示，不参与服务器路径读取。元数据字段为 `imageId/orderId/itemId/contentType/filename/size/width/height/uploadedBy/uploaderNameSnapshot/uploadedAt`；列表不读取二进制。图片内容响应设置检测所得 MIME、inline 文件名、`no-store` 和 `nosniff`。商品被移除后图片仍可查询和读取，前端标明历史商品图片，但后续导出排除其图片。

`V6__soft_remove_order_images.sql` 添加 `is_removed BOOLEAN NOT NULL DEFAULT FALSE`。DELETE 在锁定订单行的同一事务中软移除并追加 IMAGE_REMOVED 活动，提交后发送原有 order.changed；活动保留 imageId、filename、itemId、服务端员工与时间，不含二进制。已移除图片不出现在普通列表、认证公开读取、有效图片计数或新导出快照中；重复移除返回 200，不重复写活动或发送通知。订单不存在返回 ORDER_NOT_FOUND，图片不存在或不属于目标订单返回 IMAGE_NOT_FOUND。原始内容保留给已取得元数据的导出快照，不物理删除或覆盖图片。

批量请求示例：

```json
{"from":"2026-10-01","to":"2026-11-01","status":"WAITING_PRODUCTION","fulfillmentType":"DELIVERY","paymentStatus":"UNPAID"}
```

`from/to` 必填，按 `requestedReceiveDate` 的 `[from,to)` 筛选；三个业务条件可选，值沿用现有状态契约。未指定条件时包含已完成和已取消订单。顺序沿用日期、交接时间、订单号。空结果返回 400 `EXPORT_EMPTY`；超过范围或数量返回 400 `EXPORT_LIMIT_EXCEEDED` 并提示缩小范围，不静默截断。

单单使用 `订单-{orderNo}.xlsx`，批量使用 `orders-{from:yyyyMMdd}-{to前一天:yyyyMMdd}.zip`；ZIP 内使用唯一、安全的服务端订单号文件名，非数字订单号回退为订单 UUID。下载成功返回 200、attachment 文件名、正确 MIME 和 `Cache-Control: no-store`。

每份 XLSX 使用相同的 POI 生成逻辑，含“订单、商品、备注、图片”工作表：订单完整业务信息、全部有效商品、完整规格 JSON、全部订单级 NOTE、每个有效商品最近三条 NOTE，以及订单级和有效商品图片。图片实际嵌入，按比例限定在 480×320 像素内，附关联对象、上传人及时间。金额从整数分精确转换为元字符串，空金额留空，不重算订单金额；时间按 `Asia/Shanghai` 展示。所有文本为普通字符串；超过 Excel 单元格长度的内容拆为连续行，按同一列顺序拼接即可恢复完整文本。无图订单正常导出。

固定上限集中在 `OrderFileLimits`；multipart 的对应传输上限位于 bootstrap `application.yml`：

| 资源 | 上限 |
| --- | --- |
| 单图 | 5 MiB；宽、高分别不超过 8192；总像素不超过 2400 万 |
| 每单图片 | 8 张未移除图片，包含关联已移除商品的保留图片；移除图片后释放额度 |
| multipart | 单文件 5 MiB、单请求 6 MiB |
| 批量 | 42 天、100 单，最多涉及 800 张图片 |
| 输出 | 每份 XLSX 64 MiB、最终 ZIP 256 MiB |
| 正文预检 | 一次导出最多读取 8 MiB 的订单、商品及备注文本，商品与所读取备注合计最多 10000 条；包含聚合内部读取的已移除商品及其最近备注 |

读取正文前先在数据库中统计体积及条数，防止在 Workbook 序列化之前耗尽内存。体积按读取记录的 UTF-8 JSON 表示统计，包含备注正文、操作者、时间、活动 details 等元数据；商品最近备注的读取范围与预检一致。正文超限返回 413 `EXPORT_CONTENT_TOO_LARGE`；不会截断备注或规格。文件大小超限即使被 POI 包装也保留 413 `EXPORT_FILE_TOO_LARGE`，同时删除未完成文件。

空或损坏图片返回 400 `INVALID_IMAGE`，不支持格式返回 415 `UNSUPPORTED_IMAGE_FORMAT`，尺寸超限返回 400 `IMAGE_DIMENSIONS_EXCEEDED`，单图超限返回 413 `IMAGE_TOO_LARGE`，单单数量超限返回 409 `ORDER_IMAGE_LIMIT_EXCEEDED`。不存在订单、无效商品归属沿用 404 `ORDER_NOT_FOUND`；路径中的订单与图片不匹配返回 404 `IMAGE_NOT_FOUND`。导出文件大小在写入中检查，超过上限返回 413 `EXPORT_FILE_TOO_LARGE`。

导出先在短 `REPEATABLE_READ` 事务中固定订单、备注、版本及未移除图片元数据，再于事务外逐单加载固定图片 ID 的原始内容并生成文件；同一时间只保留一份 Workbook。后续上传不会进入已有快照，后续软移除不破坏正在生成的快照。生成并关闭完整文件后，独立短事务为每张实际包含的订单追加一条 `ORDER_EXPORTED`，批量全部活动原子提交；日志成功提交后才发送文件。生成失败不写成功日志，日志失败不返回文件；正常结束、异常和客户端断开均清理临时文件。

活动可通过原 `GET /api/orders/{orderId}/activities?type=ORDER_EXPORTED` 查询，包含操作员工、时间、`mode=SINGLE/BATCH`、`format=XLSX`、`snapshotVersion`、`imageIds`；批量还包含共同 `batchId` 和 `filters`，不保存完整电话或图片内容。语义是“文件成功生成并已发起下载”，不表示客户端已收到或保存。导出不推进版本、不修改状态或更新时间、不发送 SSE；生成期间发生后续业务修改不影响已固定快照，日志记录实际导出版本。

## 验证

在仓库根目录使用 Java 21：

```sh
rtk proxy ./mvnw -pl WuhouCake-order,WuhouCake-bootstrap -am verify
rtk proxy ./mvnw -pl WuhouCake-bootstrap -am -Pintegration -Dit.test=OrderIT,OrderExportIT,InfrastructureIT -Dfailsafe.failIfNoSpecifiedTests=false verify
```

OrderIT 复用现有 integration 配置、JWT 测试密钥、隔离 schema 和 Redis namespace，需要现有 PostgreSQL、Redis 可连接。连接配置见 Bootstrap 的 application-integration.yml；测试不会修改真实订单。

OrderFilesTest 使用 POI 重读 XLSX、图片与 ZIP，验证完整 JSON、长文本续行、金额及时区、普通字符串、安全文件名、校验及输出上限；OrderExportServiceTest 验证快照过滤和生成/日志失败顺序。OrderExportIT 在独立 PostgreSQL schema 中运行 V5，覆盖真实 BYTEA、复合外键、并发上传、认证、已移除商品图片保留、单单及批量下载、筛选、逐单活动、事务回滚和临时文件清理；同时验证导出不修改订单或发出 SSE，文件生成不占用数据库事务。

2026-10-15 图片与导出验证：Java 21 下上述两条 Maven verify 均通过。常规检查共 169 项（订单模块 93 项、bootstrap 25 项，包含 ArchUnit）；真实 PostgreSQL/Redis 集成共 39 项（OrderIT 26 项、OrderExportIT 8 项、InfrastructureIT 5 项），无失败、错误或跳过。正文体积与记录数预检在真实数据库中验证超限拒绝，不截断内容。

2026-10-15 导出复核：Java 21 下常规检查共 173 项（订单模块 97 项、bootstrap 25 项，包含 ArchUnit）及 OrderExportIT 10 项通过，无失败、错误或跳过。补充真实 Workbook、ZIP 条目及 ZIP 收尾的大小超限与文件清理测试；HTTP 复制失败仍删除文件，清理同时失败时将其附加到原始异常；正文预算覆盖备注元数据和 details。使用 PostgreSQL 延迟约束触发器验证提交阶段失败：已插入的批量导出日志全部回滚，不返回 ZIP，完整生成的临时文件也被删除。

OrderTest 和 OrderServiceTest 验证制作、付款、商品修改，以及交接顺序、方式区分、取消原因、数据保留和事件生成；C0.5 覆盖所有状态资料与类型更正、字段清空与无变化版本检查、追加后的整单节点清空、至少一件有效商品及软删除后的历史归属。OrderStreamsTest 验证连接生命周期、JWT 到期、心跳、串行发送、队列上限和故障隔离；OrderStreamTransactionsTest 使用 Spring 事务管理器和 mock JDBC 验证提交后通知、回滚与提交失败不通知，覆盖三个新入口。OrderStreamWebTest 复用现有安全链验证认证、参数校验、错误包络及 SSE 协议。

OrderIT 包含两商品创建→更正资料→追加 C→移除 B→查询 B 历史→人工重新确认制作的闭环，以及待交接、配送中和终态的交接类型更正。两个写操作到达持久化后再竞争同一版本，分别检查资料与追加、两件商品同时移除只有一次提交；另验证无变化资料在读取后遇到并发追加时返回冲突。数据库活动写入失败、外层事务回滚均检查原数据、版本、活动和 SSE，在线员工收到通知后通过 REST 重取详情。

2026-10-12 Slice C0 验证：使用现有开发 Compose 的 PostgreSQL 17、Redis 7，Java 21 下 integration Maven verify 和 ArchUnit 检查通过。订单模块 55 项、bootstrap 25 项常规检查及 OrderIT 15 项、InfrastructureIT 5 项真实集成检查全部通过，无失败或跳过。已验证 Slice A/B1/B2/C0 的订单持久化、制作与交接闭环、取消、版本竞争、活动失败及事务回滚，以及其他员工收到 SSE 后通过 REST 查询最新状态和备注。

2026-10-13 Slice C0.5 验证：使用现有开发 Compose 的 PostgreSQL、Redis，Java 21 下上述两条 Maven verify 命令均通过。订单模块 82 项、bootstrap 25 项常规检查及 OrderIT 23 项、InfrastructureIT 5 项真实集成检查全部通过，无失败或跳过，包含 ArchUnit。已验证两商品订单的资料更正、追加 C、移除 B、B 历史查询及人工重新确认制作；资料和商品增减的数据库版本竞争、活动失败及外层回滚均无部分更新或错误通知。待交接、配送中及终态的类型更正已验证，其他在线员工可在收到 SSE 后通过 REST 重取最新详情。

技术行为参考：[Spring 事务绑定事件](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)与 [MyBatis 更新行数及命名参数契约](https://github.com/mybatis/mybatis-3/blob/master/src/site/markdown/java-api.md)。

2026-10-13 Slice C1 验证：Java 21 下常规 Maven verify 通过，订单模块 84 项、bootstrap 25 项检查全部通过，包含 ArchUnit。真实 PostgreSQL/Redis 集成运行中 InfrastructureIT 5 项通过，OrderIT 26 项中 25 项首次通过；一项新增用例因按数组下标比较商品规格失败，改为按 itemId 定位后单独重跑通过。C1 覆盖半开日期边界、42 天及跨月范围、稳定排序、多商品只计一单、收货日期迁移、交接时间不改变归日、终态历史、门店午夜创建统计、每件商品备注时间与 ID 倒序、软删除、未认证拒绝，以及查询不写版本/活动、不发 SSE。集成断言同时确认日历只调用两次查询、工作台只调用四次查询，不调用聚合仓储。

只读查询技术参考：[MyBatis 动态 SQL 与批量参数](https://mybatis.org/mybatis-3/dynamic-sql.html)、[PostgreSQL 17 窗口函数](https://www.postgresql.org/docs/17/functions-window.html)。

2026-10-15 C2-C1a：使用 JDK 25.0.4（构建目标 Java 21），受影响模块及依赖的 177 项常规检查通过，包含 ArchUnit；独立 PostgreSQL 数据库中的 OrderExportIT 13 项通过，无失败或跳过。新增验证包括图片归属与认证、幂等软移除、额度释放、活动失败回滚、图片事务提交失败不发送 SSE，以及生成中的导出保留快照图片而后续导出排除已移除图片。未重复执行 OrderIT 的完整制作、交付与付款集成链路；双员工真实浏览器验收见 [验证记录](../frontend/verification.md#c2-c1a-参考图片协作)。

2026-10-15 C2-C1b 前端接入现有单订单 XLSX、筛选 ZIP 和 ORDER_EXPORTED 查询。批量界面的结束日期包含当天，前端转换为本接口的右开区间；认证下载复用 Bearer 和会话刷新。活动展示单单／批量方式、筛选、快照版本及图片数，不将下载已发起解释为客户端已保存。导出后仍不发送 SSE，当前员工刷新活动查询，其他员工通过已有查询刷新读取；没有新增后端接口、行为或迁移。实际浏览器下载文件及验收记录见 [C2-C1b 验证](../frontend/verification.md#c2-c1b-订单文件下载与导出日志)。

当前后端包含日历、工作台、订单图片与 Excel/ZIP 导出；前端已接入图片协作和订单文件下载。不包含 AI 识别、服务端草稿、自动计价或商品级工序。

2026-10-15 C2-C1a/C2-C1b 整体审查：177 项常规检查及 OrderExportIT 15 项通过，包含 ArchUnit。新增 PostgreSQL 延迟约束触发器验证图片新增／软移除在提交阶段失败时，图片状态与活动日志同时回滚，AFTER_COMMIT 监听器不收到通知；既有导出日志提交失败、文件清理及并发软移除后的快照读取检查继续通过。后端业务实现和 V6 迁移保持原有行为。前端会话与生命周期修正及浏览器复核见 [整体审查记录](../frontend/verification.md#c2-c1ac2-c1b-整体审查与修复)。
