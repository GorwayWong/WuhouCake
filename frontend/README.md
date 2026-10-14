# 午逅 Story 工作台（Slice C2-A / C2-B1c.2）

独立 React + TypeScript + Vite 前端。服务端数据使用 TanStack Query；没有新增后端领域模块、逐商品制作状态机或权限引擎。

## 本地运行

需要 Node.js 22.18+，以及已启动的 WuhouCake 后端、PostgreSQL 和 Redis。后端按仓库现有方式配置 RSA 密钥和员工账号。

```sh
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。开发代理默认把 `/api` 原样转发到 `http://127.0.0.1:8080`；后端端口不同时：

```sh
API_PROXY_TARGET=http://127.0.0.1:18080 npm run dev
```

```sh
npm test
npm run build
```

`dist/` 为静态构建产物。生产应通过 HTTPS 在同一站点提供静态文件与 `/api` 反向代理；保留 Cookie、Authorization 和 SSE 流，不缓冲 `/api/orders/stream`，代理读超时应长于心跳间隔。`vite preview` 仅预览静态产物，不代替生产代理配置。本轮不部署。

## 页面与边界

- 工作台的「新建订单」进入 `#/orders/new`，默认带入选中收货日期和配送方式。客户电话、收货日期、计划交接时间、商品名称及配送地址必填；支持多个独立规格商品，至少保留一件。金额以元录入、整数分提交，空金额与零金额不同，订单总金额不按商品报价计算。计划出品对应 `plannedFinishAt`，时间按北京时间提交。
- 录单草稿仅存当前标签页内存，后台数据刷新不回填表单。返回、后退、退出和正常刷新／关闭有未保存提醒；确认离开后丢弃。认证失效后，同一员工重新登录可继续草稿及原日历位置；换员工或成功退出清除草稿。浏览器刷新、关闭后的草稿无法恢复，移动系统强制结束浏览器不能保证提醒。
- 创建成功后使用服务端返回的真实订单及商品标识，刷新相关缓存并进入详情，可继续现有付款、制作及交付操作。提交不自动重试；4xx 明确拒绝（408 除外）提示订单未创建。网络中断、请求超时、5xx 或无法解码的成功响应按结果未知处理，保留输入及提交时的日期、电话提示；核对入口在新标签页打开对应收货日期的工作台，不清除原草稿。修改草稿不会隐藏结果未知提示，换员工或离开录单页时清除。
- 登录、首次改密、会话恢复及退出。首次改密页显示当前工号，成功后清空密码、保留工号并提示使用新密码重新登录。Access token 仅驻留内存，刷新凭证沿用服务端 HttpOnly Cookie。认证 POST 前读取 CSRF Cookie；并发 401 共用一次刷新。
- 周历与月历共用日期块，显示全部商品名称、订单状态和付款状态。以 `calendarDate`（后端按 `requestedReceiveDate` 投影）归日，`plannedHandoffAt` 只用于显示和排序。星期一为周起点，月历最多 42 格；切换周/月保留选中日期。手机横向滑动日期区域。
- 周历下方显示统计及所选日待办。统计直接使用服务端口径：总订单为全库数量，新下单按所选日创建时间统计，“当日需配送”仍读取 `deliveryDueOnDate`，表示所选日尚未完成/取消的配送订单。待办不含已完成、已取消订单，但这些订单仍能从日历进入详情。每个商品展示接口返回的最近三条商品备注，订单级备注不混入。
- `#/orders/{UUID}` 顶部并列呈现整单制作与交付、金额与付款，手机端先显示付款；每项业务操作只有一个入口，操作反馈显示在顶部。客户、全部有效商品、分页备注与日志依次在下方。进度只读取订单级 `status/currentStageCode`，区分配送与自提；跳过夹层/抹面时标为“未记录”，取消时显示流程终止。制作活动历史默认收起，可展开读取原有记录。动作按钮提交整单 API 和当前 `expectedVersion`，状态转换、金额与权限校验由后端决定。制作中可直接完成制作。
- 付款、制作、交付和取消成功后，用服务端返回的最新详情更新缓存，并等待相关查询刷新后恢复操作；旧版本响应不覆盖缓存中更高版本的详情。各动作独立提交，失败不撤销其他成功动作。409 重新获取状态并提示人工核对，不自动重试。
- 「客户与交付」的「编辑资料」在原区域编辑客户、交接安排及约定总金额；仅提供保存修改、取消，顶部付款入口保持唯一。所有订单状态均可更正资料；配送须有地址，自提可保留或清空地址。约定金额不按商品报价计算，也不改变付款状态。交接类型对应的订单状态由服务端返回结果决定，不自动触发制作或交付动作。
- 资料编辑从打开时的详情初始化独立草稿与版本，SSE 和查询刷新不回填输入。一次保存只 PATCH 实际修改字段；可选字段清空为 null，未改动不发送请求。金额复用整数分转换，空金额与零不同；UTC 时间显示为北京时间，未改的分钟输入不回写秒／微秒。收货日期和计划交接时间分别修改，保存沿用原有缓存刷新、日历迁日和修改日志。
- 资料修改发生 409 时保留草稿，刷新后在表单下方显示最新资料供核对；再次点击保存使用该次读取的版本，仅提交员工改过的字段，保留同事修改的其他资料。尚未获取新版本时保存禁用；再次出现并发修改仍返回 409，不自动重试。取消编辑恢复最新只读详情。返回、后退、退出及正常刷新／关闭对未保存资料给予离开提醒；草稿只在当前详情页面内存中保存。
- 「全部商品」在待制作、制作中提供单商品内联编辑、追加及一次确认的软移除；至少保留一件有效商品。待配送／待自提须先执行已有「重新制作」，配送中、已完成、已取消不提供商品修改入口。商品增减和报价修改不改变约定总金额或付款状态。
- 商品编辑仅 PATCH 稳定 itemId 的实际差异；常用文本规格按 attributes 顶层键提交，清空已有规格使用 null。未修改、未知、数组、对象和其他非文本规格保留原值；结构化规格只读展示。追加复用录单校验与元转整数分逻辑，商品标识取服务端响应。制作中追加按服务端结果清空整单节点；修改和移除不主动清除节点。最新商品变更在原商品区提醒制作同事复核，历史和独立最近备注沿用原接口。
- 同一详情仅保留一个资料或商品表单，后台更新不回填草稿，其他写入入口在编辑期间禁用。若编辑期间同事将订单推进到待交接，草稿保留，可执行已有「重新制作」，随后核对最新订单再保存。商品 409 保留输入并展示最新商品，员工再次保存才使用复核版本；不自动重试或覆盖其他字段。编辑中的商品被同事移除时仍保留草稿，禁止继续保存。追加网络失败、5xx 或无法解码的成功响应按结果未知处理，保留输入，先核对最新有效商品及日志，再决定是否重新保存。
- 详情写入期间阻止站内返回、后退、切换订单和退出，保存／取消及其他写入操作禁用；服务端响应写入缓存并等待必要查询刷新后恢复导航。资料和商品草稿沿用未保存离开确认；正常刷新／关闭由浏览器原生 beforeunload 提醒，浏览器允许用户确认离开，系统强制关闭无法保证请求完成。
- 备注与取消原因是独立本地输入状态，不从查询结果回填。后台刷新和 409 不覆盖输入；成功提交后才清空对应表单。成功提示可关闭，离开页面的草稿不持久化。
- 日历使用订单号，无手机号尾号扩展。采用附带午逅 logo 和参考图的黄色/浅色视觉语言；没有蛋糕照片字段时使用商品图标，不虚构商品照片。登录页为新增设计，不宣称参考图中存在登录页。

## API 映射

| 页面/操作 | API |
| --- | --- |
| CSRF、登录、恢复、退出 | `GET /api/auth/csrf`，`POST /api/auth/login`、`refresh`、`logout` |
| 当前员工、首次改密 | `GET /api/me`，`POST /api/me/password` |
| 周/月历 | `GET /api/orders/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`，右边界不含 |
| 所选日期统计与待办 | `GET /api/orders/workbench?date=YYYY-MM-DD` |
| 人工录单 | `POST /api/orders` |
| 订单详情 | `GET /api/orders/{id}` |
| 客户、交接、约定金额修改 | `PATCH /api/orders/{id}/information`，`expectedVersion` + `changes` |
| 修改指定商品 | `PATCH /api/orders/{id}`，`expectedVersion` + `itemId` + 差异 `changes` |
| 追加商品 | `POST /api/orders/{id}/items`，`expectedVersion` + `item` |
| 软移除商品 | `POST /api/orders/{id}/items/{itemId}/remove`，`expectedVersion` |
| 备注、制作时间线、修改日志 | `GET /api/orders/{id}/activities?page=1&size=20&type=...`，独立分页 |
| 整单制作 | `POST /api/orders/{id}/production-actions` |
| 付款 | `PATCH /api/orders/{id}/payment-status` |
| 配送、自提 | `POST /api/orders/{id}/fulfillment-actions` |
| 取消 | `POST /api/orders/{id}/cancel` |
| 添加整单/商品备注 | `POST /api/orders/{id}/notes` |
| 实时通知 | `GET /api/orders/stream`，Bearer + Fetch |

## 实时同步

每个已登录应用实例只在 `Workspace` 顶层创建一条 SSE 连接；页面组件不单独订阅。Fetch 携带 Bearer，`eventsource-parser` 处理分块、UTF-8、CRLF 和心跳注释。退出、卸载和 JWT 更新均先清理旧连接。

`order.changed` 使对应订单详情与活动查询、全部日历范围缓存和工作台缓存失效；当前挂载的查询立即重新获取，未挂载的查询在再次打开时读取新数据。所有通知都处理，不以 `version` 丢弃 NOTE。迁日时重新获取当前完整范围，避免旧日期残留。

服务端没有消息重放：`ready`、JWT 更新、窗口恢复前台和网络恢复均重新同步 REST。连接失败指数退避至最多约 30 秒；45 秒未收到任何数据则主动断开并重连。数据请求透传 Query 的 AbortSignal，旧请求不会覆盖新结果。突发并发写入交给后端乐观锁；409 展示可操作的错误并重新获取，不自动重复业务动作。

## 验证

`npm test` 使用 Node 内置测试运行器，覆盖跨年/闰月的查询范围、同版本 NOTE、迁日后的范围失效、并发 401 单次刷新、SSE 分块解码、断线重连和单连接清理，以及录单金额精度、门店时间转换、多商品请求结构、创建异常分类和核对入口日期。资料编辑覆盖差异字段、可选值清空、UTC 初始化与时间精度保留、冲突复核后提交；商品编辑覆盖单商品差异、JSONB 保留、null 删除、金额转换、数量与最后一件限制和冲突草稿。真实浏览器验证过程与范围见 [verification.md](verification.md)。

实现参考：通过 Context7 核对 [TanStack Query 查询失效](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)、[查询取消](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)、[业务响应更新缓存](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)、[等待业务操作后的查询刷新](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)、[Vite 同源代理](https://vite.dev/config/server-options.html#server-proxy) 和 [eventsource-parser](https://github.com/rexxars/eventsource-parser)。

## C2-B 待办

下一阶段 C2-B1d 为完整订单协作业务验收。图片上传、商品模板及 AI 识别未实现。录单状态确认复用现有详情操作；本轮保留 OrderItem 的 `productionStatus/currentStageCode` 类型，不据此渲染独立制作流程。
