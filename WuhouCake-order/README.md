# 订单领域

客户扫码填单、客服确认接单及来源留痕见[客户填单说明](../docs/customer-entry.md)。未确认填单独立于正式订单，不进入下述制作日历、经营统计与导出。

Order 聚合管理多个商品、客户和交付安排、整单制作、付款及历史。bootstrap 显式装配，application 管理事务；员工须完成首次改密。业务范围与缺口见[当前范围](../docs/product-scope.md)，认证契约见[账号 API](../docs/identity.md)。

## HTTP 接口

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
| POST /api/orders/{id}/fulfillment-actions | expectedVersion + action |
| POST /api/orders/{id}/cancel | expectedVersion + reason |
| POST /api/orders/{id}/notes | content、可选 itemId，空 itemId 为整单备注 |
| GET /api/orders/{id}/activities | 可选 itemId/type，page 从 1 起、size 默认 20/最大 100 |
| GET /api/orders/calendar | from/to，按收货日期查询 [from,to)，最多 42 天 |
| GET /api/orders/workbench | date，指定门店日期的统计与未完成/未取消待办 |
| GET /api/orders/stream | Bearer + Fetch SSE |
| POST /api/orders/{id}/images | multipart file、可选有效 itemId |
| GET /api/orders/{id}/images | 图片元数据，不读取二进制 |
| GET /api/orders/{id}/images/{imageId} | 认证图片内容 |
| DELETE /api/orders/{id}/images/{imageId} | 软移除图片 |
| POST /api/orders/{id}/exports/xlsx | 导出已保存单单，无请求体 |
| POST /api/orders/exports/zip | from/to、可选 status/fulfillmentType/paymentStatus |
| POST /api/orders/recognition/parse | text，规则识别，不调用模型 |
| POST /api/orders/recognition/assist | text、allowExternalProcessing，可选语义补充 |

当前业务安全链允许所有已改密员工访问订单接口，包括批量导出；不提供管理员专属订单数据查询或导出授权。

## 录单、修改与一致性

~~~json
{
  "customer": {"customerName":"合成客户","phone":"13800000000","memberPhone":null,"buyerName":null},
  "fulfillment": {
    "type":"DELIVERY","address":"合成市示例路1号",
    "requestedReceiveDate":"2026-11-01",
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

- phone、requestedReceiveDate、plannedHandoffAt 和至少一件有名称/数量的商品必填；DELIVERY 必须有非空地址，PICKUP 可空。客户姓名、会员电话、客户侧下单人、计划出品时间、报价和总额可选。正式 API 的 phone 是最长 32 字符的非空文本，不提供电话真实性验证。
- 数量为 1–2147483647 的整数；金额为非负 Long 整数分，不接收浮点小数或负数。前端以元输入并限制在 JavaScript 安全整数范围；空值与 0 不同，不按商品报价自动计算订单总额。
- productType 省略时默认 CAKE，去空格并转为大写。attributes 保留未知规格；CAKE 的 base/filling 缺失、null、空白时，写入和读取均使用原味/芒果，读取不写库。奶油仍存 flavor。新建、追加及明确修改的蛋糕 size 只接受正数、最多两位小数、整数部分最多九位，存为无单位数值文本；非法值返回 400。旧规格可读，未改尺寸时不会因旧尺寸异常阻止其他字段更正。
- 时间以 ISO 8601 带偏移输入、UTC 输出，前端按北京时间展示；收货日期决定日历归日，交接时刻不替代收货日期。
- 创建可传 creditedEmployeeId，省略时归属当前员工；需为在职员工。旧单不推定归属。详情 creditedEmployee 含 ID、工号和姓名快照；createdBy 始终是实际创建人。资料 changes 还接受 creditedEmployeeId，改变归属同事务记录前后值和实际操作者。
- 资料 changes 接受 customerName、phone、memberPhone、buyerName、fulfillmentType、address、requestedReceiveDate、plannedHandoffAt、plannedFinishAt、totalAmountCents、creditedEmployeeId。商品 changes 接受 name、productType、quantity、unitPriceCents、memberPriceCents、attributes。未提交字段保持，允许清空的字段为 null；attributes 顶层合并、null 删除（蛋糕 base/filling 回落默认），结构值整体替换。
- 所有状态都能更正资料和约定金额；商品仅在 WAITING_PRODUCTION/PROCESSING 可增删改，待交接须先重新制作。至少一件有效商品；软移除保留历史，不能再编辑该商品或为其添加备注。
- 制作中追加商品清空已确认的整单节点；修改/移除不主动清空节点。商品变化不改约定总额和付款。DELIVERING 改为 PICKUP 时转 WAITING_PICKUP；完成/取消后的交接类型更正不重开状态。

写请求带当前 expectedVersion。有效资料、商品、付款和状态变化同事务推进一次版本并记录活动；无实际变化仍校验版本，但不写版本/时间/活动。409 CONCURRENT_MODIFICATION 后须读取最新状态人工复核，不自动重试。备注、图片不增加订单版本，仍会发 SSE；导出不记新活动、不发 SSE。

创建接口可带 UUID 格式的 `Idempotency-Key` 请求头。标识按实际创建员工隔离；同标识及相同内容的并发或后续重试仅创建一单、一组商品及一条创建活动，后续请求返回原订单的最新详情，不再推送创建事件。相同标识改用不同内容返回 409 IDEMPOTENCY_KEY_CONFLICT。预约标识、订单和创建活动同事务提交，失败全部回滚；仅保存请求内容指纹及订单引用，不复制客户资料。已成功的提交即使归属员工随后归档，仍可重试读取原单。未带此请求头的调用每次创建新单；网页在当前草稿生命周期内始终携带标识。

## 整单状态

新订单 WAITING_PRODUCTION / UNPAID / version 0。付款仅 PAID/UNPAID，可双向手工更正，与制作互不阻断。

| 制作 action | 前置条件 | 结果 |
| --- | --- | --- |
| START_PRODUCTION | WAITING_PRODUCTION | PROCESSING |
| COMPLETE_LAYER | PROCESSING，节点为空 | LAYER_DONE |
| COMPLETE_FROSTING | PROCESSING，节点 LAYER_DONE | FROSTING_DONE |
| COMPLETE_PRODUCTION | PROCESSING，任意节点 | DELIVERY→WAITING_DELIVERY；PICKUP→WAITING_PICKUP |
| REOPEN_PRODUCTION | WAITING_DELIVERY/WAITING_PICKUP | PROCESSING，清空节点 |

| 交付 action | 前置条件 | 结果 |
| --- | --- | --- |
| START_DELIVERY | DELIVERY / WAITING_DELIVERY | DELIVERING |
| COMPLETE_DELIVERY | DELIVERY / DELIVERING | COMPLETED |
| CONFIRM_PICKUP | PICKUP / WAITING_PICKUP | COMPLETED |

夹层和抹面可跳过，未记录不得展示成已完成；制作完成不自动送达。取消要求非空原因，完成/取消的终态不能再次取消。无独立商品制作按钮、部分交付或配送任务聚合。

活动包含服务端操作者和昵称快照、时间、动作及适用的 before/after；按 createdAt/id 倒序分页。各商品最近三条 NOTE 只属于该商品，整单备注不混入。历史导出活动继续可读，不再新增。

## 查询与 SSE

日历使用 [from,to)；工作台 date 按 Asia/Shanghai。非法、反向、空或超过 42 天的日历范围返回 400。统计字段：totalOrders 是全部订单数，createdOnDate 是门店当天创建数，deliveryDueOnDate 是该收货日尚未完成/取消的配送订单数，均不是商品数量统计。

工作台 pendingOrders 字段返回该收货日全部状态的订单，前端再按同一状态/付款筛选规则显示日历与单日列表。经营查询 `GET /api/admin/orders` 向所有已改密员工开放，参数 from/to（右开区间，最多 366 天）、dateBasis（RECEIVE 默认按收货日期，CREATED 按北京时间录单日期）、status/paymentStatus/fulfillmentType、sizeInches、creditedEmployeeId、unassigned、includeCancelled、keyword、page/size（1 起、最大 100）。未知枚举、非法日期/尺寸/UUID/分页返回 400；空结果正常返回空列表及零统计。尺寸只匹配有效 CAKE 商品，累加 quantity；旧异常尺寸安全排除于精确尺寸筛选，未设尺寸时仍可查询并计为待核对。

查询返回整段范围的 totals、sizes、employees，分页仅影响 items。尺寸按规范数值合并，各组订单数分别去重，混合尺寸订单会进入多组，不可相加；员工按稳定账号分组，显示最近录单的归属快照，历史未归属独立成组。金额仅求已填写约定金额，按手动付款标记分列，并单列未填金额订单数；不按尺寸分摊整单金额，本阶段提供员工业绩汇总，不计算提成。

`GET /api/admin/orders/export` 使用相同业务条件及可重复读快照，返回“统计”“尺寸统计”“员工业绩”“订单明细”“商品明细”五张 XLSX 表。最多 10,000 单、50,000 行商品，订单商品描述和商品明细各限 8 MiB、单格 32767 字符；超限 REPORT_LIMIT_EXCEEDED，不截断。默认排除取消单；includeCancelled=true 包含，status=CANCELLED 明确只看取消。约定总额不是实收或提成；JSON 金额汇总/明细用整数分字符串保留精度。导出数量为可计算的数值单元格，工号/订单号等为文本，不执行输入公式；表头冻结并支持筛选。

SSE 使用带 Bearer 的 Fetch，先发送 ready/data={}，提交成功后发送 order.changed，载荷为 orderId、itemId、changeType、version、orderNo，不携带客户联系方式。资料迁日、备注和图片同版本通知都触发 REST 重取；不能用版本相同丢弃通知。读取和导出不推送。前端保留本次在线期间最近 20 张订单的更新提示，重连通过 REST 补齐数据，完整操作仍以订单日志为准。

连接绑定账号、会话和凭证版本，注册及每个 ready/事件/心跳发送前复验身份。同进程凭证撤销成功提交后清空旧流队列并关闭，回滚不误断；新版本和其他员工保持。单实例、15 秒心跳、最长 5 分钟，不持久化、不重放、不支持 Last-Event-ID。跨进程账号变更由后续复验兜底，空闲连接最迟下一次心跳关闭。

断开后的 I/O 生命周期交由 Servlet 完成，已识别的断连仅记 DEBUG，不再输出 JSON；真正未知服务端故障仍诊断。已输出的字节不能撤回。源码与实际回归见[会话撤销](../docs/verification/2026-10-16-sse-revocation.md)、[正常断开](../docs/verification/2026-10-16-sse-disconnect.md)。

## 图片与导出

创建后上传 JPEG/PNG，检测真实内容并解码，不能仅凭扩展名/MIME 放行。元数据与 BYTEA 内容同事务写入，图片及活动失败一并回滚。移除释放额度并保留历史；商品移除后图片可查阅，但后续导出不包含该商品的图片。内容请求认证、no-store、nosniff；不支持 HEIC 或 OCR。

| 资源 | 上限 |
| --- | --- |
| 单图 | 5 MiB；宽高各不超过 8192，总像素不超过 2400 万 |
| 每单图片 | 8 张未移除图片，包含已移除商品关联的保留图 |
| multipart | 单文件 5 MiB、单请求 6 MiB |
| 批量导出 | 42 天、100 单、最多 800 张图片；超量报错，不截断前 100 单 |
| 输出文件 | 每份 XLSX 64 MiB，ZIP 256 MiB |
| 正文预检 | 8 MiB，商品与所读取备注合计最多 10000 条；包含内部读取的历史商品/最近备注 |

ZIP 筛选 from/to 是收货日期右开区间，界面结束当天须先加一天；未筛选状态时包含完成和取消。空结果、非法筛选、超范围/数量/内容均返回可理解错误。

XLSX 含订单、商品、备注、图片四张表：有效商品及完整规格 JSON、全部整单备注、各有效商品最近三条备注、有效整单/商品图片；图片实际嵌入。金额精确转为元文本，空金额留空；时间按门店时区，长文本拆连续行，文本不作为公式执行。

短 REPEATABLE_READ 事务固定订单、备注和有效图片 ID，事务外逐单生成文件；后续移除不破坏正在生成的既有快照，后续上传不混入。导出不新增活动、不改变版本/状态/付款，临时文件在正常结束、异常和复制中断时清理。文件名分别为订单-{orderNo}.xlsx、orders-{from:yyyyMMdd}-{to前一天:yyyyMMdd}.zip。

常见错误：400 VALIDATION_FAILED/INVALID_IMAGE/IMAGE_DIMENSIONS_EXCEEDED/EXPORT_LIMIT_EXCEEDED/EXPORT_EMPTY；404 ORDER_NOT_FOUND/IMAGE_NOT_FOUND；409 CONCURRENT_MODIFICATION/ORDER_NOT_EDITABLE/ORDER_IMAGE_LIMIT_EXCEEDED 或非法状态转换；413 IMAGE_TOO_LARGE/EXPORT_FILE_TOO_LARGE/EXPORT_CONTENT_TOO_LARGE；415 UNSUPPORTED_IMAGE_FORMAT。固定限制以 [OrderFileLimits](src/main/java/org/xaspire/WuhouCake/order/domain/model/valobj/OrderFileLimits.java) 和 bootstrap multipart 配置为准。

## 可选文本识别

RecognitionDraft 非持久化，fields 映射客户/交付/总额，items 为各商品候选。每个字段独立包含 value、source（RULE/MODEL/DEFAULT，缺失为 null）、evidence、needsReview、issues；整数分候选用十进制文本，正式订单仍提交整数。部分字段失败不丢弃其他有效候选。

规则支持明确年份日期、时刻、电话、标签、编号商品、尺寸/数量/金额规范化和正文/须知分段。原文最多 12000 字符、最多 20 个商品块，超限告知且不串入最后一项。须知中的配送门槛、餐具尺寸、可选夹馅不作为本单事实；只有日期不补时刻，不猜名称/数量，不推断会员、付款或交接方式。不能确定的内容待人工。

前后端共用 [cake-defaults.json](src/main/resources/order/cake-defaults.json)：CAKE 默认原味内胚/芒果夹馅，DEFAULT 与原文明示分开，显式夹馅优先；非蛋糕不套用默认。旧口味模板的芒果等选项是夹馅，不是奶油。修改默认资源需重建前后端。

parse 不调用模型；assist 服务端重新解析，仅在 allowExternalProcessing=true 且有合适商品语义片段时调用百炼。只补充已定位商品的名称、奶油、内胚、夹馅、祝福语和要求；不补客户/日期/数量/金额，不新增商品。模型值须通过固定本地 Schema 子集、类型、归属和连续原文证据校验；类名/未知占位、矛盾建议或规则冲突拒绝。MODEL 始终待确认，不能自动保存。

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
