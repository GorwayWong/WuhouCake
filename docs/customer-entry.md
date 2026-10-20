# 客户扫码填单

## 业务流程

前台或管理人员在工作台「客户填单」中生成自己的固定二维码。客户免登录填写联系电话、配送／自提、期望收货日期和具体时刻、地址以及一个或多个商品，会员手机号选填。客户提交后只能联系发码客服更正，本期没有公开历史查询、详情查询或修改接口。

填单独立于正式订单，状态为 `PENDING`、`CONFIRMED`、`DELETED`。待确认填单不进入制作日历、经营统计、员工业绩或订单导出。前台和管理人员默认查看自己二维码收到的填单，也可处理全部客服的填单；只有糕点师岗位的员工不能处理这些填单。

员工核对时可保存草稿。确认前必须补齐整单约定总额、在职业绩归属员工和内部交接时间。商品单价与会员价选填，整单金额不按单价自动求和。客户期望收货时间与内部交接时间分别保存。确认生成正式 `WAITING_PRODUCTION`／`UNPAID` 订单，之后沿用员工既有修改与履约规则。

| 信息 | 保存含义 |
| --- | --- |
| 客户填写来源 | `CUSTOMER_SUBMITTED`；手机号未经验证，不能视为客户身份 |
| 发码客服 | 原始二维码所属员工及姓名快照，不自动获得业绩归属 |
| 确认员工 | 正式订单的 `createdBy` 及创建活动操作者 |
| 业绩归属员工 | 员工确认时显式选择，沿用现有统计字段 |
| 客户提交时间 | 保存在原始填单中 |
| 订单创建、确认时间 | 取客服确认时刻 |

同原始手机号、同北京时间收货日期的待确认填单提示更新版本。旧单仍可确认，须先明确核实更新填单。不同日期分别处理，不自动覆盖、合并或删除。客服删除待确认填单后，日常列表不再展示，原始内容和删除活动继续保留用于追溯；没有恢复入口。确认后的填单不能通过此删除功能删除正式订单。

## 字段契约

蛋糕使用现有规格字段：`size` 为正数寸数，必填；`base` 为内胚，默认原味；`filling` 为夹心／配料，默认芒果；`flavor` 为奶油；`message` 为祝福语；`requirements` 为其他要求。非蛋糕不自动补入原味／芒果，也不强制蛋糕尺寸。每份填单 1–30 项商品，名称最多 128 字符，手机号最多 32 字符，地址及每项规格最多 2000 字符。手机号只校验填写格式和长度，不验证持有人。

客户表单中不存在价格、业绩归属、员工身份、来源和订单状态。公开请求使用独立 DTO，未知字段拒绝；属性也仅接收上述客户字段。电话号码接受 6–15 位数字，可带国际前缀 `+`、空格、括号或短横线；保存前移除分隔符，不推定国家区号，不验证持有人。联系电话与会员手机号分别保存，不触发会员查询、定价或扣款。

客户原始填写不可覆盖。核对记录包含更正前后值、真实操作员工及时间；正式订单创建日志标记「来源：用户填写」，订单详情提供原始填写与处理记录入口。客户字段快照与差异方法集中在 `CustomerSubmission` 中，用作未来修改能力的基础；本期没有客户修改用例或开关，未来须另行确定身份验证与修改状态规则。

## HTTP 接口

所有响应沿用 `ApiResponse`。公开入口只有以下两项能力：

| 方法和路径 | 行为 |
| --- | --- |
| `GET /api/public/order-entries/{token}` | 返回有效入口的客服显示名 |
| `POST /api/public/order-entries/{token}/submissions` | 提交填单，必带 UUID `Idempotency-Key`；只返回填单 ID 和编号 |

公开请求正文为 `phone`、`memberPhone`、`fulfillmentType`、`address`、`requestedReceiveAt`、`items`。每项商品包含 `name`、`productType`、`quantity`、`attributes`。时间用带偏移 ISO 8601，界面按北京时间显示；`requestedReceiveAt` 同时确定期望收货日期。

员工端接口均需有效员工登录，服务端再次检查岗位：

| 方法和路径 | 行为 |
| --- | --- |
| `GET /api/customer-submissions?mine=true&status=PENDING&page=1&size=20` | 分页查询；可选全部客服及 `CONFIRMED` 状态 |
| `GET /api/customer-submissions/{id}` | 原始内容、核对结果、更新填单提示、处理日志 |
| `PATCH /api/customer-submissions/{id}` | `{expectedVersion, review}` 保存核对结果 |
| `POST /api/customer-submissions/{id}/confirm` | `{expectedVersion, acknowledgedNewerSubmissionId?}` 确认生成正式订单 |
| `DELETE /api/customer-submissions/{id}` | `{expectedVersion}` 软删除未确认填单 |
| `GET /api/customer-submissions/entry?ownerId=...` | 本人二维码；管理人员可查询同事二维码 |
| `POST /api/customer-submissions/entry?ownerId=...` | `{action}`：`CREATE`、`ENABLE`、`DISABLE`、`RESET`；其他员工先由本人生成入口 |
| `GET /api/orders/{id}/customer-origin` | 登录员工读取正式订单来源、发码客服及客户原始期望时间；员工直接录单返回 null |

`review` 包含客户 `content`、与商品逐项对应的可选 `prices`、`totalAmountCents`、`creditedEmployeeId`、`plannedHandoffAt`。金额单位为非负整数分，空与零不同。状态变化使用版本校验；`409 CONCURRENT_MODIFICATION` 后读取最新状态人工核对。保存与确认是两个独立操作，不自动覆盖他人核对结果。

同一入口与幂等标识只接收同一份规范化内容，不同内容返回 `409 IDEMPOTENCY_KEY_CONFLICT`。确认事务原子保存订单、填单状态、唯一关联与日志；重试已成功确认的操作返回原订单，不再建单。确认时检测到尚未核实的新填单返回 `409 NEWER_SUBMISSION_EXISTS`。

## 部署与保护

前后端保持同源，部署端须提供 HTTPS，代理 `/api` 到后端并给前端提供 SPA 入口。客户页面路径为 `/#/fill/{token}`。二维码通过浏览器本地 `qrcode` 生成，不请求外部二维码网站。

| 环境变量 | 默认及用途 |
| --- | --- |
| `CUSTOMER_ENTRY_PUBLIC_ORIGIN` | 开发默认 `http://localhost:5173`；生产 Compose 必填实际公开 HTTPS 源站，不能带路径、凭证或查询参数 |
| `CUSTOMER_ENTRY_PER_MINUTE` | 每来源 IP 每分钟 10 次提交 |
| `CUSTOMER_ENTRY_PER_HOUR` | 每来源 IP 每小时 100 次提交 |
| `CUSTOMER_ENTRY_MAX_BODY_BYTES` | 131072，即 128 KiB；硬上限 1 MiB |
| `CUSTOMER_ENTRY_TRUSTED_PROXIES` | 默认空；逗号分隔的可信代理准确 IP 地址，不接收网段表达式 |

Redis 使用既有身份配置的命名空间，原子维护分钟和小时固定窗口计数。它限制提交请求，不按手机号封禁客户；超限返回 `429 SUBMISSION_THROTTLED`，Redis 故障返回可重试的 `503 SERVICE_UNAVAILABLE`。入口可由本人停用或重置，离职归档及不再具有前台／管理岗位时停止接收新填单；已有内容继续由其他员工处理。

默认忽略所有转发头。仅当直连来源在可信代理清单内，才从 `X-Forwarded-For` 右侧向左取第一个不受信任的来源。代理必须正确追加真实来源；勿同时开启会预先改写 `remoteAddr` 的全局转发头处理，以免绕过本入口的可信边界。对外代理同步限制请求大小，并避免把填单正文、手机号和二维码 URL 记录到访问日志。

发布前须配置实际源站，并在实际 HTTPS、代理及手机上验证二维码、填单和员工处理流程。本地或浏览器手机视口通过不等于已上线。
