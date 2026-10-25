# 员工权限与界面能力

员工可兼任六个岗位：店长 `STORE_MANAGER`、裱花主管 `PASTRY_SUPERVISOR`、前厅主管 `FRONT_DESK_SUPERVISOR`、裱花师 `DECORATOR`、烘焙师 `BAKER`、前厅店员 `FRONT_DESK_CLERK`。岗位权限取并集。店长同时具有 `SUPER_ADMIN` 身份，可管理员工并查询审计；授予、撤销店长岗位会同步调整系统身份，撤销最后一位在职管理员会被拒绝。系统身份变化撤销旧凭证。

旧 `MANAGER`、`FRONT_DESK`、`PASTRY_CHEF` 标识保留原含义，供未确认的存量账号和历史审计使用；不会自动推断新岗位。逐人确认后通过维护命令迁移，见[订单与账号维护](order-maintenance.md)。新建员工界面仅提供六个新岗位。

后端负责拒绝越权操作和裁剪结构化敏感字段。前端根据当前账号返回的能力调整页面、按钮和信息区块，不需要自行解释岗位名称，也不能用隐藏按钮替代服务端校验。

## 当前账号契约

`GET /api/me` 保留原有账号字段，增加 `data.access`；管理员查询和修改账号返回的账号视图也包含该字段。

```json
{
  "permissions": ["ORDER_READ", "ORDER_PRODUCTION_UPDATE", "ORDER_NOTE_CREATE"],
  "uiCapabilities": ["ORDER_WORKBENCH", "ORDER_PRODUCTION"]
}
```

集合无排序保证。首次改密前或账号已归档时，权限和 UI 能力均为空；首次改密前仍可读取 `/api/me`、修改密码，认证接口保持原有行为。缺失权限默认拒绝，不根据前端传入的岗位、权限或令牌中自报的角色授权。

`permissions` 表示可执行的操作和可读取的数据；`uiCapabilities` 是同一权限集合派生的展示能力。前端可以用操作权限控制按钮，用 UI 能力控制导航和信息区块。页面能力只表示可进入对应功能，订单状态、并发版本、对象归属等业务约束仍由业务用例校验。

| UI 能力 | 展示用途 | 所需权限 |
| --- | --- | --- |
| `ORDER_WORKBENCH` | 日历、工作台、订单查看 | `ORDER_READ` |
| `ORDER_ENTRY` | 新建订单 | `ORDER_CREATE`、`ORDER_CUSTOMER_READ`、`ORDER_AMOUNT_READ` |
| `ORDER_MANAGEMENT` | 订单查询与统计 | `ORDER_MANAGEMENT_READ`、`ORDER_CUSTOMER_READ`、`ORDER_AMOUNT_READ`、`ORDER_BUSINESS_DETAILS_READ` |
| `ORDER_CUSTOMER_DETAILS` | 客户信息 | `ORDER_CUSTOMER_READ` |
| `ORDER_BUSINESS_DETAILS` | 下单时间和下单员工等业务资料 | `ORDER_BUSINESS_DETAILS_READ` |
| `ORDER_AMOUNTS` | 金额与付款状态 | `ORDER_AMOUNT_READ` |
| `ORDER_ACTIVITY_LOG` | 完整订单活动记录 | `ORDER_READ`、`ORDER_ACTIVITY_READ`、`ORDER_CUSTOMER_READ`、`ORDER_AMOUNT_READ`、`ORDER_BUSINESS_DETAILS_READ` |
| `ORDER_PRODUCTION` | 制作操作 | `ORDER_PRODUCTION_UPDATE` |
| `CUSTOMER_SUBMISSIONS` | 客户填单处理 | `CUSTOMER_SUBMISSION_PROCESS`、`ORDER_CUSTOMER_READ`、`ORDER_AMOUNT_READ` |
| `CUSTOMER_ENTRY` | 员工填单二维码 | `CUSTOMER_ENTRY_MANAGE` |
| `EMPLOYEE_MANAGEMENT` | 员工账号管理 | `EMPLOYEE_MANAGE` |
| `AUDIT_LOG` | 身份审计 | `AUDIT_READ` |

## 操作权限

`ORDER_PHONE_READ` 仅允许在订单详情及返回详情的写响应中读取完整联系电话。`ORDER_DELETE` 允许带原因删除订单；`ORDER_DELETED_READ` 允许在 30 天保留期内读取、导出已删除订单。删除权限不由取消权限推定。

业务 HTTP 接口按请求方法和路径显式授权，未映射的接口或方法返回拒绝。匿名访问受保护接口返回 401；已登录但权限不足返回 403 `FORBIDDEN`。已匹配接口的业务错误继续使用现有错误契约。

| 权限 | 操作范围 |
| --- | --- |
| `ORDER_READ` | 订单详情、日历、工作台、图片读取、SSE 订阅 |
| `ORDER_CREATE` | 新建订单、文本规则解析和辅助识别 |
| `ORDER_EDIT` | 修改订单信息、商品属性、增删商品 |
| `ORDER_CANCEL` | 取消订单 |
| `ORDER_PAYMENT_UPDATE` | 修改付款状态 |
| `ORDER_PRODUCTION_UPDATE` | 制作流程操作 |
| `ORDER_FULFILLMENT_UPDATE` | 自提和配送流程操作 |
| `ORDER_NOTE_CREATE` | 添加工作备注 |
| `ORDER_IMAGE_UPLOAD` / `ORDER_IMAGE_DELETE` | 上传 / 删除图片 |
| `ORDER_CUSTOMER_READ` | 客户姓名、联系方式、地址等结构化资料；读取客户填单来源还需要 `ORDER_READ` |
| `ORDER_AMOUNT_READ` | 订单金额、商品价格、会员价和付款状态 |
| `ORDER_BUSINESS_DETAILS_READ` | 订单及商品创建时间、订单创建者、确认时间和下单员工归属 |
| `ORDER_ACTIVITY_READ` | 完整订单活动记录；另需 `ORDER_READ` 及客户、金额、业务资料读取权限 |
| `ORDER_MANAGEMENT_READ` | 订单查询与统计；另需客户、金额、业务资料读取权限 |
| `ORDER_EXPORT` | 单单 Excel、批量 ZIP；另需客户、金额、业务资料读取权限。查询结果导出还需 `ORDER_MANAGEMENT_READ` |
| `CUSTOMER_SUBMISSION_PROCESS` | 客户填单查询、核对、删除；查询和保存还需两项敏感数据读取权限，确认转单还需 `ORDER_CREATE` |
| `CUSTOMER_ENTRY_MANAGE` | 查看和管理本人二维码入口 |
| `CUSTOMER_ENTRY_MANAGE_ALL` | 在具备入口管理权限的前提下，管理其他员工已有入口；不改变入口创建的现有约束 |
| `EMPLOYEE_DIRECTORY_READ` | 员工选项目录 |
| `EMPLOYEE_MANAGE` / `AUDIT_READ` | 员工账号管理 / 身份审计；仅系统超级管理员拥有，不允许在岗位配置中授予 |

客户填单处理继续允许有处理权限的员工协作处理其他入口收到的填单；二维码入口管理仍执行归属校验。公开填单入口要求归属员工在职且具备入口岗位资格，改密状态不影响其已有公开入口。

## 岗位权限配置

未配置时，店长、前厅主管和前厅店员具有完整订单资料读取、订单业务操作、删除和已删除查询权限。裱花主管、裱花师、烘焙师沿用制作组操作权限，但不授予 `ORDER_CUSTOMER_READ`、`ORDER_AMOUNT_READ`、`ORDER_BUSINESS_DETAILS_READ`、`ORDER_DELETE`、`ORDER_DELETED_READ`。制作组通过独立的 `ORDER_PHONE_READ` 读取完整客户手机号，其“客户与交付”区域仅显示该手机号和收货日期、期望收货时间、取货时间、计划出品时间；不可读取客户姓名、会员手机号、订购人、配送地址、金额与经营资料。付款汇总、完整活动日志、财务查询和导出仍要求相关完整数据权限。兼任前厅或店长时取权限并集。

制作人员可以通过 `GET /api/orders/{id}/notes` 阅读工作备注。此接口只返回 `NOTE`，忽略其他活动类型参数，需要 `ORDER_READ`；不返回订单创建或字段修改快照。制作、备注、图片等写操作仍使用各自操作权限。

通过 `wuhoucake.authorization.job-permissions` 覆盖具体岗位的完整权限集合。配置只影响列出的岗位，未列出岗位保留上述默认值；空集合表示该岗位不提供业务权限。多岗位按并集计算，因此只收窄一个兼任岗位不会撤销另一个岗位授予的权限。

下面示例将制作岗位限制为查看制作相关订单信息、操作制作流程、添加工作备注。它展示了后端差异化能力，不会自动修改部署配置。

```yaml
wuhoucake:
  authorization:
    job-permissions:
      DECORATOR:
        - ORDER_READ
        - ORDER_PHONE_READ
        - ORDER_PRODUCTION_UPDATE
        - ORDER_NOTE_CREATE
```

配置在启动时绑定并校验；未知岗位、未知权限、为岗位授予系统管理权限均阻止启动。修改配置需要重启服务，各实例应使用一致配置。账号岗位调整则在下次认证请求中即时生效，不要求重新登录。

## 数据与会话边界

订单详情及所有返回订单详情的写接口统一应用权限投影。没有完整客户读取权限时，配送地址返回 `null`；仅有 `ORDER_PHONE_READ` 时客户对象只返回 phone，其余客户字段为 `null`，两项权限均无时客户对象为 `null`；没有金额读取权限时，付款状态、付款时间 `paidAt`、订单金额、单价和会员价返回 `null`；没有业务资料读取权限时，订单及商品创建时间、订单创建者、确认时间及下单员工归属返回 `null`。日历中的付款状态和电话尾号，以及工作台中的客户、地址和价格也使用相应权限。计划出品时间始终保留在制作资料中。

完整活动记录可能包含历史字段快照，因此同时要求客户、金额和业务资料读取权限；导出、查询统计亦检查这三项权限，客户填单明细检查客户和金额读取权限。自由文本备注、商品属性和图片属于制作资料，不进行内容识别或自动脱敏；业务录入时应将客户和金额资料放在对应结构化字段。

JWT 仍只携带账号、会话和凭证版本。每个请求重新验证数据库账号和 Redis 会话，计算当前有效权限后再授权，不把岗位权限冻结进令牌。SSE 在建立连接和发送前重新验证读取权限；权限消失时关闭连接，不继续推送事件。

## 扩展与验证

新增操作时，在 `EmployeeAccess.Permission` 增加稳定权限码，显式映射 HTTP 方法和路径，按需补充 UI 能力及岗位授予规则。新权限不会自动进入默认岗位授权。新增敏感返回字段时，必须同步扩展 `OrderViewAccess` 或为相关接口设置数据权限；所有返回订单详情的路径均应使用该投影。新增岗位时同步更新身份枚举、请求校验、岗位策略和对应测试，不授予未定义岗位隐式权限。

前端读取 `access` 控制付款汇总、付款筛选、业务资料、财务查询与导出入口。没有业务资料读取权限的订单读取员工使用制作视图：款式图片优先、制作参数逐行放大、计划出品时间及特殊要求突出显示，工作备注默认折叠。客户端应在权限变化后重新获取 `/api/me`，业务状态导致的操作限制仍需遵守。周历汇总契约见[出货付款汇总](shipping-payment-summary.md)。

验证覆盖权限配置绑定、多岗位并集、系统身份隔离、首次改密限制、敏感字段裁剪、HTTP 越权拒绝、SSE 失权关闭，以及真实数据库和会话下岗位调整后的即时权限变化。

```bash
./mvnw -pl WuhouCake-bootstrap -am verify
./mvnw -pl WuhouCake-bootstrap -am -Pintegration \
  -Dit.test=IdentityIT,OrderIT,WorkflowManagementIT,CustomerSubmissionIT \
  -Dfailsafe.failIfNoSpecifiedTests=false verify
```

集成测试使用独立临时 schema 和 Redis 命名空间，连接参数见 `WuhouCake-bootstrap/src/main/resources/application-integration.yml`。
