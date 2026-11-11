# 订单领域

客户扫码填单、客服确认接单及来源留痕见[客户填单说明](../docs/customer-entry.md)。未确认填单独立于正式订单，不进入下述制作日历、经营统计与导出。

Order 聚合管理多个商品、客户和交付安排、整单制作、付款及历史。bootstrap 显式装配，application 管理事务；员工须完成首次改密。业务范围与缺口见[当前范围](../docs/product-scope.md)，认证契约见[账号 API](../docs/identity.md)。

## HTTP 接口

付款分页明细：`GET /api/orders/workbench/payment-orders`，参数 date、kind（RECEIPT / SHIPPING_PAID / SHIPPING_UNPAID）、page（默认 1），每页 10 条。返回 date、kind、page、total、orders；订单摘要包含 orderId、orderNo、createdAt、calendarDate、paidAt、amountCents、paymentStatus、status、currentStageCode。金额为分字符串或 null，createdAt 按业务资料权限裁剪。要求 ORDER_READ 和 ORDER_AMOUNT_READ。统计、排序与返回规则见[周历付款说明](../docs/shipping-payment-summary.md)。

JSON 使用 ApiResponse。创建订单、追加商品、备注和图片返回 201，其余成功 JSON 操作返回 200。SSE、图片二进制、XLSX/ZIP 直接返回内容；未开始输出的错误仍使用 JSON 包。

| 方法和路径 | 用途 |
| --- | --- |
| POST /api/orders | 创建订单，返回真实 orderId/itemId |
| GET /api/orders/{id} | 详情、有效商品、各商品最近三条备注 |
| PATCH /api/orders/{id}/information | expectedVersion + changes，更正客户/交接/总额 |
| PATCH /api/orders/{id} | expectedVersion + itemId + changes，修改商品 |
| POST /api/orders/{id}/items | expectedVersion + item，追加商品 |
| POST /api/orders/{id}/items/{itemId}/remove | expectedVersion，软移除商品 |
| PATCH /api/orders/{id}/payment-status | expectedVersion + paymentStatus |
| POST /api/orders/{id}/production-actions | expectedVersion + action |
| PATCH /api/orders/{id}/items/{itemId}/production-status | expectedVersion + completed，所有有效商品（含主蛋糕）逐项确认 |
| POST /api/orders/{id}/fulfillment-actions | expectedVersion + action |
| POST /api/orders/{id}/cancel | expectedVersion + reason |
| POST /api/orders/{id}/restart | expectedVersion，仅已取消订单；须同时具有 ORDER_CANCEL 与 ORDER_PRODUCTION_UPDATE |
| POST /api/orders/{id}/notes | content、可选 itemId，空 itemId 为整单备注 |
| GET /api/orders/{id}/activities | 可选 itemId/type，page 从 1 起、size 默认 20/最大 100 |
| GET /api/orders/calendar | from/to，按取货日期查询 [from,to)，最多 42 天 |
| GET /api/orders/workbench | date，指定门店日期的统计与未完成/未取消待办 |
| GET /api/orders/workbench/receipt-summary | date，按北京时间付款日汇总订单数和金额 |
| GET /api/orders/workbench/cake-bases | date，按取货日期汇总蛋糕尺寸、胚口味及数量 |
| GET /api/order-packages | keyword 名称子串搜索、page 默认 1、size 默认 20/最大 50，返回 Page |
| GET /api/order-packages/{id} | 有效套餐详情，包含 version 和 updatedAt |
| POST /api/order-packages | name + items + originalAmountCents + 可选 memberAmountCents；带 UUID Idempotency-Key，返回 201 |
| PUT /api/order-packages/{id} | 同新建字段，另含 expectedVersion，返回 200 |
| GET /api/order-packages/{id}/items/{itemId}/images/{imageId} | 经授权读取当前条目的图片 |
| DELETE /api/order-packages/{id}?expectedVersion=版本号 | 软删除套餐，返回 200 JSON；不影响已带入订单的商品 |
| GET /api/orders/stream | Bearer + Fetch SSE |
| POST /api/orders/{id}/images | multipart file、必填有效 itemId，可选 UUID Idempotency-Key |
| GET /api/orders/{id}/images | 图片元数据，不读取二进制 |
| GET /api/orders/{id}/images/{imageId} | 认证图片内容 |
| DELETE /api/orders/{id}/images/{imageId} | 软移除图片 |
| POST /api/orders/{id}/exports/xlsx | 导出已保存单单，无请求体 |
| POST /api/orders/exports/zip | from/to、可选 status/fulfillmentType/paymentStatus |
| POST /api/orders/recognition/parse | text，规则识别，不调用模型 |
| POST /api/orders/recognition/assist | text、allowExternalProcessing，可选语义补充 |

订单接口由业务能力授权，登录和首次改密是前置条件；财务查询、付款汇总和导出还要求相关数据读取权限，见[权限契约](../docs/authorization.md)。

## 录单、修改与一致性

### 套餐填写模板

首页“套餐管理”与“订单查询与统计”同级，仅店长 `STORE_MANAGER`（含迁移前的 `MANAGER`）可维护；套餐列表和详情还允许具有 ORDER_CREATE 权限的员工读取，写接口与应用服务均校验店长岗位。

套餐名称去掉首尾空白后为 1–80 个字符，有效套餐名称区分大小写且唯一，已删除套餐的名称可重新使用。套餐总数不设上限，列表按 updatedAt 降序和 ID 稳定分页；keyword 按普通文本子串匹配，不把 `%`、`_` 当通配符。

每个套餐至少一项商品。条目使用稳定 UUID `itemId`、`name`、固定类型 `OTHER`、正整数 `quantity`、可选多行 `attributes.specification` 和可空 `imageId`。套餐原价必填、会员价可空，金额单位均为整数分。旧套餐未设价时保持空值，录单或编辑时补填。

无新图片时可提交 JSON。带新图片的 POST/PUT 使用 multipart：`package` 部件为相同契约的 application/json，文件部件名为该行的新 `imageId`。每行最多一张，图片限 JPEG/PNG、单张 5 MiB、整次请求 64 MiB。保留原图时使用同一条目和图片 ID，无需再次上传。保存、替换、清理图片与套餐写入在同一事务；已删除或替换的图片不再可读。可下单的员工仍可读取模板与图片；只有店长或具备金额查看权限的员工可读取套餐价格。

带入时在草稿内按名称和规格合并其他商品，保留已有图、缺图才补；两种整单金额按份累计。没有会员价的部分按原价计入，有内容或金额的草稿先显示确认。带入后图片随草稿和订单独立保存，套餐修改或删除不影响已经带入的内容。

PUT 与 DELETE 以 expectedVersion 条件更新，旧版本返回 409 CONCURRENT_MODIFICATION；已删除套餐详情返回 404 PACKAGE_NOT_FOUND。有效套餐同名写入由数据库唯一索引保证，返回 409 PACKAGE_NAME_CONFLICT。店长核对最新版本后可继续保存保留的输入，前端不会自动覆盖。

创建请求携带 UUID Idempotency-Key，相同标识和相同内容返回原套餐，不增加套餐及审计记录；同标识并发请求在现有事务内串行核实，避免误报名称冲突。原套餐已被修改或删除时分别返回 409 PACKAGE_CREATION_CONFLICT 或 404 PACKAGE_NOT_FOUND。前端在结果未确认时锁住输入，按原标识确认创建；修改、删除先读取详情核实，必要时按原版本重试。新建、修改、删除与 order.package_created / order.package_updated / order.package_deleted 审计同事务提交。完整 before/after 保存在 cake_order_package_change，审计 details.changeId 关联快照，并含名称、版本和商品项数摘要，避免通用审计单字段长度限制影响套餐保存。

套餐创建、修改和删除成功提交后，通过现有 `/api/orders/stream` 连接发送 `package.changed`，仅携带 packageId、version、deleted，不包含套餐名称或商品内容。前端取消旧的列表读取和目标套餐在途带入读取，再重新查询所有活动套餐列表；ready、网络恢复和页面回到前台时补读，进入新建订单时也重新核对。已删除或移出当前筛选的选项清空，当前分页失效时回到有效页。刷新只更新套餐候选，不重建订单草稿或套餐编辑表单；在途带入取消后提示核对，迟到响应不追加旧商品。回滚、旧版本冲突、幂等创建重试及重复删除不发送变更通知。通知沿用现有单实例 SSE 会话与权限边界，不增加连接或轮询。

V18 为 V17 的增量迁移，保留既有商品和创建时间并初始化版本、修改时间。启用唯一索引前检查去空格后重名，发现重名即停止，不自动改名或删除；应由店长确认名称调整后重试迁移。可在升级前只读检查：`SELECT btrim(name), count(*) FROM cake_order_package GROUP BY btrim(name) HAVING count(*) > 1;`。

~~~json
{
  "customer": {"customerName":"合成客户","phone":"13800000000","memberPhone":null,"buyerName":null},
  "fulfillment": {
    "type":"DELIVERY","address":"合成市示例路1号",
    "requestedReceiveDate":"2026-11-01",
    "requestedReceiveAt":"2026-11-01T19:00:00+08:00",
    "plannedHandoffAt":"2026-11-01T18:00:00+08:00"
  },
  "items":[
    {"name":"生日蛋糕","productType":"CAKE","quantity":1,"unitPriceCents":19929,
     "attributes":{"size":"8","flavor":"动物奶油","base":"原味","filling":"芒果"}},
    {"name":"杯子蛋糕","productType":"CUPCAKE","quantity":6,"attributes":{}}
  ],
  "totalAmountCents":32050
}
~~~

- phone、requestedReceiveDate 和至少一件有名称/数量的商品必填；DELIVERY 必须有非空地址，PICKUP 可空。客户姓名、会员电话、客户侧下单人、交接时间 plannedHandoffAt、计划出品时间、报价和总额可选。只填日期且无具体时刻时，取货时间保存为 null，之后可补填或清空。正式 API 的 phone 是最长 32 字符的非空文本，不提供电话真实性验证。
- 数量为 1–2147483647 的整数；订单与套餐金额为 0–9007199254740991 的整数分，超限、小数或负数返回 400 VALIDATION_FAILED。空值与 0 不同；汇总金额以精确整数分字符串返回。
- 商品类别为 `CAKE`（蛋糕）和 `OTHER`（其他）。V27 统一旧非蛋糕类别，将其业务属性整理进多行规格；所有历史套餐行转为其他。活动日志不重写。
- 新商品不保存单价或会员单价。旧创建请求可重试，携带的旧商品报价不参与新计价。商品编辑不接受价格字段。历史金额保留原值，只向有金额权限的员工提供，详情与导出将其作为规格中的历史参考显示。
- productType 省略时默认 CAKE，去空格并转为大写。attributes 保留未知规格；CAKE 的 base/filling/flavor 缺失、null、空字符串或纯空白时，写入和读取均使用原味/芒果/原味奶油；明确填写的值保留。历史读取不写库，以后保存时写入默认值；客户填单及核对复用相同默认值。新建、追加及明确修改的蛋糕 size 只接受正数、最多两位小数、整数部分最多九位，存为无单位数值文本；非法值返回 400。旧规格可读，未改尺寸时不会因旧尺寸异常阻止其他字段更正。
- 商品分类统一为 CAKE、TEA_BREAK、COOKIE、SNACK、DRINK、READY_BAKERY。V22 归并订单商品、套餐、待确认核对数据中的旧分类，保留 attributes、原始填单和历史快照。写入时归一化 DONUT/CUPCAKE/OTHER→TEA_BREAK、BREAD→READY_BAKERY；未知历史类型保留读取。蛋糕统计仍只统计 CAKE。
- 时间以 ISO 8601 带偏移输入、UTC 输出，界面统一为取货与出品。取货为客户或配送员从门店取走商品的时间。前端出品默认取货前一小时，手动值保持并可恢复自动；接口的 plannedFinishAt 接收最终安排，允许空值。
- 公开字段名不变。新建以 plannedHandoffAt 优先，缺失回退 requestedReceiveAt，写入时同步两者和北京时间 requestedReceiveDate。PATCH 明确修改取货时间时同步旧收货字段；传 null 可清除时刻，日期仍必填。历史订单查询优先 plannedHandoffAt，再回退 requestedReceiveAt 和 requestedReceiveDate；日历、工作台、经营查询 RECEIVE、出货汇总和日期导出使用同一有效取货日期。无关编辑不回填，来源记录及审计保留原值。客户填单 Review 的 plannedFinishAt 为可空出品时间。
- 员工手工创建订单固定归属当前认证员工；请求中的 creditedEmployeeId 保留兼容接收，但不用于选择手工订单归属。客户扫码填单确认仍使用核对时显式选择的在职员工。旧单不推定归属。详情 creditedEmployee 含 ID、工号和姓名快照；createdBy 始终是实际创建人。资料 changes 还接受 creditedEmployeeId，改变归属同事务记录前后值和实际操作者。
- 资料 changes 接受 customerName、phone、memberPhone、buyerName、fulfillmentType、address、requestedReceiveDate、requestedReceiveAt、plannedHandoffAt、plannedFinishAt、totalAmountCents、creditedEmployeeId。商品 changes 接受 name、productType、quantity、unitPriceCents、memberPriceCents、attributes。未提交字段保持，允许清空的字段为 null；attributes 顶层合并、null 删除（蛋糕 base/filling/flavor 回落默认），结构值整体替换。
- 所有状态都能更正资料和约定金额；商品仅在出胚、夹层、抹面、装饰可增删改，待配送须先退回装饰。至少一件有效商品；软移除保留历史，不能再编辑该商品或为其添加备注。
- 追加商品时回到出胚。若此前已进入下一工序，则重置有效商品的备齐勾选。商品名称、类型、数量或规格变更会清除该项备齐勾选。价格修改和移除保留节点。商品变化不改约定总额和付款。更正交接方式时，整单状态保持当前节点。

写请求带当前 expectedVersion。有效资料、商品、付款和状态变化同事务推进一次版本并记录活动；无实际变化仍校验版本，但不写版本/时间/活动。409 CONCURRENT_MODIFICATION 后须读取最新状态人工复核，不自动重试。备注、图片不增加订单版本，仍会发 SSE；导出不记新活动、不发 SSE。

创建接口可带 UUID 格式的 `Idempotency-Key` 请求头。标识按实际创建员工隔离；同标识及相同内容的并发或后续重试仅创建一单、一组商品及一条创建活动，后续请求返回原订单的最新详情，不再推送创建事件。相同标识改用不同内容返回 409 IDEMPOTENCY_KEY_CONFLICT。预约标识、订单和创建活动同事务提交，失败全部回滚；仅保存请求内容指纹及订单引用，不复制客户资料。已成功的提交即使归属员工随后归档，仍可重试读取原单。未带此请求头的调用每次创建新单；网页在当前草稿生命周期内始终携带标识。

## 整单状态

新订单为 `CAKE_BASE`、`UNPAID`、version 0。整单 `status` 表示当前节点，整单 `currentStageCode` 保留在 API 响应中，值为 `null`。付款可独立更正。UNPAID→PAID 记录 paidAt，重复确认保留原时间，改回 UNPAID 清空时间。历史已付款且无日期的订单仍显示时间未记录。

| 动作 | 当前节点 | 结果 |
| --- | --- | --- |
| `COMPLETE_BASE` | 出胚 `CAKE_BASE` | 夹层 `LAYER` |
| `COMPLETE_LAYER` | 夹层 `LAYER` | 抹面 `FROSTING` |
| `COMPLETE_FROSTING` | 抹面 `FROSTING` | 装饰 `DECORATING` |
| `COMPLETE_DECORATION` | 装饰，全部有效商品已勾选备齐 | 待配送 `WAITING_DELIVERY` |
| `COMPLETE_DELIVERY` | 待配送，方式为配送 | 已配送 `COMPLETED` |
| `CONFIRM_PICKUP` | 待配送，方式为自提 | 已配送 `COMPLETED` |
| `ROLLBACK_PRODUCTION` | 夹层、抹面或装饰 | 退回上一道工序 |
| `REOPEN_PRODUCTION` | 待配送 | 退回装饰 |
| `ROLLBACK_FULFILLMENT` | 已配送 | 退回待配送 |

普通回退保留商品备齐勾选。退回出胚或通过 `POST /api/orders/{id}/restart` 恢复已取消订单时，将所有有效商品重置为 `NOT_STARTED`。恢复要求 `ORDER_CANCEL` 和 `ORDER_PRODUCTION_UPDATE`，通过独立接口记录 `RESTART_CANCELLED` 活动。每次移动推进一次版本，事务内记录前后状态，提交后推送 SSE。取消需提供原因，适用于出胚到待配送的订单。

升级由 Flyway V25 执行。旧待制作和未确认夹层的制作中单转为出胚，旧已夹层转为抹面，旧已抹面和其他已确认转为装饰。旧待自提及配送中转为待配送。保留交接方式、原有勾选、付款、版本及审计记录。部署时暂停写入并备份数据库，迁移前后按状态核对数量，前后端同批切换并刷新已打开页面，再恢复写入。

活动包含服务端操作者和昵称快照、时间、动作及适用的 before/after；按 createdAt/id 倒序分页。各商品最近三条 NOTE 只属于该商品，整单备注不混入。历史导出活动继续可读，不再新增。

## 查询与 SSE

日历使用 [from,to)；工作台 date 按 Asia/Shanghai。非法、反向、空或超过 42 天的日历范围返回 400。统计字段：totalOrders 是全部订单数，createdOnDate 是门店当天创建数，deliveryDueOnDate 是该取货日尚未完成/取消的配送订单数，均不是商品数量统计。

`GET /api/orders/workbench` 的 `includeMetrics` 默认 `true`，继续返回上述统计；显式传 `false` 时 `metrics` 为 `null`，只读取当天订单、商品及备注，不计算全局统计。日历工作台使用此轻量读取，页面统计使用当天全部有效订单。

每张工作台订单的 `latestNote` 返回整单及有效商品中最新的一条 NOTE，按 createdAt/id 倒序确定；没有备注时为 null。已移除商品的备注不参与卡片摘要，各商品的 recentNotes 仍只包含该商品最近三条备注。

日历响应增加只读 `customerPhoneLast4` 字符串，保留客户手机号末四位及前导零，仅用于日期概览；工作台响应不增加此字段，继续返回 `customer.phone`。日历和工作台均包含该取货日全部状态（含完成、取消）的订单；前端日期概览显示全部订单，筛选仅作用于当天时间轴列表。经营查询 `GET /api/admin/orders` 按订单查询及客户、金额、业务资料读取能力授权，参数 from/to（右开区间，最多 366 天）、dateBasis（RECEIVE 默认按取货日期，CREATED 按北京时间录单日期）、status/paymentStatus/fulfillmentType、sizeInches、creditedEmployeeId、unassigned、includeCancelled、keyword、page/size（1 起、最大 100）。未知枚举、非法日期/尺寸/UUID/分页返回 400；空结果正常返回空列表及零统计。尺寸只匹配有效 CAKE 商品，累加 quantity；旧异常尺寸安全排除于精确尺寸筛选，未设尺寸时仍可查询并计为待核对。

`allUnpaid=true` 查询全部历史未付款订单，不限日期，忽略其他筛选，包含已取消单，按 created_at、order_no、id 升序；支持分页与同口径导出。

查询返回整段范围的 totals、sizes、employees，分页仅影响 items。尺寸按规范数值合并，各组订单数分别去重，混合尺寸订单会进入多组，不可相加；员工按稳定账号分组，显示最近录单的归属快照，历史未归属独立成组。金额仅求已填写约定金额，按手动付款标记分列，并单列未填金额订单数；不按尺寸分摊整单金额，本阶段提供员工业绩汇总，不计算提成。

`GET /api/admin/orders/export` 使用相同业务条件及可重复读快照，返回“统计”“尺寸统计”“员工业绩”“订单明细”“商品明细”五张 XLSX 表。最多 10,000 单、50,000 行商品，订单商品描述和商品明细各限 8 MiB、单格 32767 字符；超限 REPORT_LIMIT_EXCEEDED，不截断。默认排除取消单；includeCancelled=true 包含，status=CANCELLED 明确只看取消。约定总额不是实收或提成；JSON 金额汇总/明细用整数分字符串保留精度。导出数量为可计算的数值单元格，工号/订单号等为文本，不执行输入公式；表头冻结并支持筛选。

SSE 使用带 Bearer 的 Fetch，先发送 ready/data={}，提交成功后发送 order.changed，载荷为 orderId、itemId、changeType、version、orderNo，不携带客户联系方式。资料迁日、备注和图片同版本通知都触发 REST 重取；不能用版本相同丢弃通知。读取和导出不推送。前端保留本次在线期间最近 20 张订单的更新提示，重连通过 REST 补齐数据，完整操作仍以订单日志为准。

连接绑定账号、会话和凭证版本，注册及每个 ready/事件/心跳发送前复验身份。同进程凭证撤销成功提交后清空旧流队列并关闭，回滚不误断；新版本和其他员工保持。单实例、15 秒心跳、最长 5 分钟，不持久化、不重放、不支持 Last-Event-ID。跨进程账号变更由后续复验兜底，空闲连接最迟下一次心跳关闭。

断开后的 I/O 生命周期交由 Servlet 完成，已识别的断连仅记 DEBUG，不再输出 JSON；真正未知服务端故障仍诊断。已输出的字节不能撤回。源码与实际回归见[会话撤销](../docs/verification/2026-10-16-sse-revocation.md)、[正常断开](../docs/verification/2026-10-16-sse-disconnect.md)。

## 图片与导出

创建商品项接受可选 UUID `itemId`，提供时作为新商品的稳定标识，重复标识返回 400，与已有商品冲突返回 409；省略时由服务端生成，旧请求的创建幂等指纹保持。

员工新建订单时可逐商品选图并随本机草稿恢复；订单创建后按商品 ID 上传 JPEG/PNG。上传必须指定有效商品，检测真实内容并解码，不能仅凭扩展名/MIME 放行。元数据与 BYTEA 内容同事务写入，图片及活动失败一并回滚。上传可带 UUID Idempotency-Key，订单内唯一；相同键及相同商品、规范化文件名和原始内容返回原图，不重复写图、活动或通知；同键不同请求返回 409，原图已移除时也返回 409。每商品计数与幂等检查在订单行锁内执行。移除释放额度并保留历史；商品移除后图片可查阅，但后续导出不包含该商品的图片。内容请求认证、no-store、nosniff；不支持 HEIC 或 OCR。

| 资源 | 上限 |
| --- | --- |
| 单图 | 5 MiB；宽高各不超过 8192，总像素不超过 2400 万 |
| 每商品图片 | 5 张未移除图片，无整单 8 张限制；历史超额及未关联图片继续读取 |
| multipart | 单文件 5 MiB、单请求 6 MiB |
| 批量导出 | 42 天、100 单、最多 800 张图片；超量报错，不截断前 100 单 |
| 输出文件 | 每份 XLSX 64 MiB，ZIP 256 MiB |
| 正文预检 | 8 MiB，商品与所读取备注合计最多 10000 条；包含内部读取的历史商品/最近备注 |

ZIP 筛选 from/to 是取货日期右开区间，界面结束当天须先加一天；未筛选状态时包含完成和取消。空结果、非法筛选、超范围/数量/内容均返回可理解错误。

XLSX 含“订单信息、商品明细、工作备注、参考图片”四张表。有效商品规格转换为可读字段，状态和类型使用中文；备注及图片通过商品序号、名称关联，不展示内部 UUID、版本、原始 JSON。包含全部整单备注、各有效商品最近三条备注和有效图片，图片实际嵌入。金额精确转为元文本，未填金额显示“未填写”，零元显示 0.00；时间按北京时间，长文本拆连续行，文本不作为公式执行。ZIP 根目录每单一个安全订单号文件名，使用 UTF-8 和普通 Deflate；每单模板与单独导出一致。

`POST /api/admin/orders/exports/zip` 接收管理查询 JSON 条件，按全部匹配订单生成逐单 ZIP，最多 100 单、256 MiB。管理查询及该导出接受 `deleted=true`：按删除日期筛选保留期内的只读订单，包含原已取消订单。已删除查询的 totals 仅 orderCount 有意义，其余统计字段为零，sizes/employees 为空；汇总表导出拒绝该模式。单单 Excel 和 ZIP 显示删除员工、原因、时间和保留截止。删除接口、到期清理及图片维护命令见[维护说明](../docs/order-maintenance.md)。

短 REPEATABLE_READ 事务固定订单、备注和有效图片 ID，事务外逐单生成文件；后续移除不破坏正在生成的既有快照，后续上传不混入。导出不新增活动、不改变版本/状态/付款，临时文件在正常结束、异常和复制中断时清理。文件名分别为订单-{orderNo}.xlsx、orders-{from:yyyyMMdd}-{to前一天:yyyyMMdd}.zip。

常见错误：400 VALIDATION_FAILED/INVALID_IMAGE/IMAGE_DIMENSIONS_EXCEEDED/EXPORT_LIMIT_EXCEEDED/EXPORT_EMPTY；404 ORDER_NOT_FOUND/IMAGE_NOT_FOUND；409 CONCURRENT_MODIFICATION/ORDER_NOT_EDITABLE/ORDER_IMAGE_LIMIT_EXCEEDED 或非法状态转换；413 IMAGE_TOO_LARGE/EXPORT_FILE_TOO_LARGE/EXPORT_CONTENT_TOO_LARGE；415 UNSUPPORTED_IMAGE_FORMAT。固定限制以 [OrderFileLimits](src/main/java/org/xaspire/WuhouCake/order/domain/model/valobj/OrderFileLimits.java) 和 bootstrap multipart 配置为准。

## 可选文本识别

RecognitionDraft 非持久化，fields 映射客户/交付/总额，items 为各商品候选。每个字段独立包含 value、source（RULE/MODEL/DEFAULT，缺失为 null）、evidence、needsReview、issues；整数分候选用十进制文本，正式订单仍提交整数。部分字段失败不丢弃其他有效候选。

规则支持明确年份日期、中文月日、今天/明天/后天和常见中文时刻，也支持电话、标签、编号商品、尺寸/数量/金额规范化和正文/须知分段。缺年份取北京时间不早于当天的最近合法日期，补入的年份随字段 issues 返回。日期和时刻分行时先收集再校验，冲突返回字段原因。预定单的收货日期归旧收货信息，取货日期归取货信息。新建页优先带入明确的取货候选。仅给出取货日期时，识别结果的 plannedHandoffAt 保留 RULE 来源和空值，取货日期由 requestedReceiveDate 返回。连贴多张带标题的预定单时只解析第一张，单行拼接也可在带字段的第二个标题处截断。原文最多 12000 字符、最多 20 个商品块，超限告知且不串入最后一项。须知中的配送门槛、餐具尺寸、可选夹馅不作为本单事实；只有日期不补时刻，不猜名称/数量，不推断会员、付款或交接方式。不能确定的内容待人工。

前后端共用 [cake-defaults.json](src/main/resources/order/cake-defaults.json)：CAKE 默认原味内胚/芒果夹馅，DEFAULT 与原文明示分开，显式夹馅优先；非蛋糕不套用默认。旧口味模板的芒果等选项是夹馅，不是奶油。修改默认资源需重建前后端。

录单页只调用 parse 规则识别。保留的 assist 接口在服务端重新解析，仅在 allowExternalProcessing=true 且有合适商品语义片段时调用百炼。只补充已定位商品的名称、奶油、内胚、夹馅、祝福语和要求；不补客户/日期/数量/金额，不新增商品。模型值须通过固定本地 Schema 子集、类型、归属和连续原文证据校验；类名/未知占位、矛盾建议或规则冲突拒绝。MODEL 始终待确认，不能自动保存。

两接口认证、no-store，不创建订单、不记活动、不改版本或持久化原文；模型失败保留规则和手工录单，不重试整个过程。正式创建仍由原订单接口完整验证。

### 百炼配置

~~~dotenv
RECOGNITION_ASSIST_ENABLED=false
RECOGNITION_ASSIST_BASE_URL=https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
RECOGNITION_ASSIST_MODEL=qwen3.7-flash
RECOGNITION_ASSIST_TIMEOUT_MILLIS=8000
RECOGNITION_ASSIST_MAX_CONCURRENT=2
~~~

DASHSCOPE_API_KEY 仅通过服务端受限配置注入；普通 .env 文件不会由 Spring 自动加载。缺配置时禁用补充，保留规则/手工功能。Compose 当前没有透传这些识别变量，启用时需调整服务器环境映射。仅发送待理解的商品片段及归属，不重复发送已解析姓名/电话/地址；片段仍须人工检查个人信息。真实客户外发须另获明确授权，前端逐次展示片段并征得同意。不得输出密钥、原文或模型正文到业务数据库/生产调试日志。

使用现有 RestClient/JDK HTTP/Jackson，无 AI SDK 或新依赖。HTTPS 入口（HTTP 仅本机测试）、连接最长 2 秒、请求默认 8 秒（1–60000 ms）、并发默认 2（1–8）；满额立即降级，不排队、不自动重试、不重定向。每片段最多 2000 字符、合计 4000，响应 64 KiB、输出 2048 token。固定 [Schema](src/main/resources/order/recognition-assist-schema.json) 仅使用已实现的 object/array/string、required、additionalProperties、enum、长度/数量子集，禁止远程引用；新增关键字需补实现和测试。

调用按供应商 token 计费，费用和数据保留以[百炼价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[服务说明](https://help.aliyun.com/zh/model-studio/faq-about-alibaba-cloud-model-studio)为准，不承诺零保留。只完成过 5 次合成真实调用，未核查账单或验证真实客户语料；初次语义问题及有限复测见[百炼报告](../docs/verification/2026-10-16-bailian-live.md)。生产默认关闭。

## 验证

常规单元、ArchUnit、真实 HTTP/数据库、文件及故障回归命令统一维护在[验证摘要](../frontend/verification.md#验证入口)。原阶段测试数量、分支操作过程和 Slice 计划不再作为当前契约；独立验收报告保留其执行基线与未验证边界。

文字识别支持“规格（寸）”“规格(寸)”作为 size 标签，原“尺寸／蛋糕尺寸”继续可用；普通“规格”仍映射 specification，不根据寸数猜测商品分类。表单中的“蛋糕胚”仍对应 base，接口字段和历史数据格式保持。

### 订购方式

员工创建订单可选填顶层 `orderingMethod` 文本；资料修改使用 `changes.orderingMethod`。
该字段独立于配送／自提和填单来源，去除首尾空白后最多 80 字符，空内容保存为 `null`。
详情仅在具有 `ORDER_BUSINESS_DETAILS_READ` 权限时返回实际值；修改沿用 `expectedVersion` 和资料修改审计。
旧请求可省略，历史订单保持空值；客户填单、识别和导出列不增加此字段。

### 整单双报价与支付登记

`POST /api/orders` 新增可选 `originalAmountCents`、`memberAmountCents`、`paymentMethod`。金额为整数分，会员价非 null 时优先（包括 0），否则采用原价，成交金额继续通过 `totalAmountCents` 返回并用于汇总；同时传入不一致的成交金额会被拒绝。旧客户端仅传 `totalAmountCents` 仍可创建订单。

方式为 `UNIONPAY`、`MEMBER_CARD`、`BANK_TRANSFER`、`SERVICE_WECHAT`、`CASH`、`UNPAID`。省略时沿用未付默认值；指定非未付方式需付款操作权限，创建事务内同时保存已付款和服务器时间。未对接实际支付通道。

`PATCH /api/orders/{id}/information` 可更正双报价，服务端重新计算成交金额；修改金额不改付款状态或付款时间。`PATCH /api/orders/{id}/payment-status` 支持同时传 `paymentMethod`，状态与方式必须一致；已付只改方式保留原付款时间。两类写入沿用 `expectedVersion` 与审计，创建沿用幂等标识。V26 新增可空列，不回填历史订单渠道或报价。
