# 账号运行与 API

本文描述当前身份实现；生产管理员操作步骤单独维护在[管理员运维](dev-ops/admin-prod.md)。订单业务活动与身份操作审计是不同记录，分别见[订单说明](../WuhouCake-order/README.md)和[审计模块](../WuhouCake-audit/README.md)。

## 员工管理与订单归属

超级管理员页面 `#/admin/employees` 提供查询、创建、编辑姓名/岗位、重置密码和归档。工号固定，岗位不等于系统权限；归档代替物理删除，保留历史身份。账号响应增加 version，管理员编辑使用该业务版本，不能用 credentialVersion 代替。

| 接口 | 契约 |
| --- | --- |
| GET /api/employees/options | 已改密员工可读取 ID、工号、姓名、状态；默认仅在职，includeArchived=true 包含历史员工；不返回凭证和密码信息 |
| PATCH /api/admin/employees/{id} | expectedVersion、nickname、jobRoles；仅超级管理员，归档员工不可编辑，过期版本 409，无变化不递增版本 |

账号创建、姓名/岗位修改、密码变更/重置、归档及管理员初始化/恢复均与审计同事务提交，details 保存适用的前后姓名、岗位、状态和版本等非敏感快照；审计失败回滚业务变更。创建、重置密码的初始密码只在当次响应中返回，前端页面关闭后清除。登录和退出等会话事件独立记录，审计故障不阻止退出或使失效凭证恢复。

订单独立保存下单员工 ID 和当时的工号/姓名快照，实际创建人与每次操作人来自服务器认证。选择新归属时锁定并校验在职资格；归档不改写旧订单归属。历史未归属订单保持未归属，不自动认定创建者。

## 首次本地配置

先按[快速开始](../README.md#2-快速开始)构建 JAR、启动 PostgreSQL/Redis 并加载本地环境变量。Web 启动必须显式选择 dev 或 prod，并提供持久 RSA 密钥；缺失密钥不会自动生成临时密钥。

以下生成命令需要本机 OpenSSL，仅用于首次配置；已有环境继续使用原来的配对密钥，不重复生成：

~~~bash
umask 077
mkdir -p secrets/identity
chmod 700 secrets/identity
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/identity/private.pem
openssl pkey -in secrets/identity/private.pem -pubout -out secrets/identity/public.pem
chmod 600 secrets/identity/private.pem
export IDENTITY_PRIVATE_KEY="$PWD/secrets/identity/private.pem"
export IDENTITY_PUBLIC_KEY="$PWD/secrets/identity/public.pem"
~~~

私钥和命令凭证文件须为普通文件、非符号链接、所有者可读、组及其他用户无权限，大小不超过 16 KiB；建议权限 600，目录 700。公钥须可读并与私钥匹配，RSA 至少 2048 位。secrets/ 已被 Git 忽略，密钥不进入前端或仓库。

用本机编辑器创建 secrets/identity/init-admin.json，替换示例口令，不把真实口令放到命令行：

~~~json
{"employeeNumber":"0001","nickname":"店长","password":"SET_YOUR_OWN_LONG_PASSPHRASE"}
~~~

~~~bash
chmod 600 secrets/identity/init-admin.json
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=dev \
  --wuhoucake.identity.command=init-admin \
  --wuhoucake.identity.credential-file="$PWD/secrets/identity/init-admin.json"
~~~

成功输出 Administrator initialized 和账号 ID；完成后删除初始化凭证文件。命令只在数据库没有任何超级管理员时执行，不覆盖既有账号。随后正常启动后端，首次登录先改密，再用新密码重新登录。

Application 检测到 wuhoucake.identity.command 参数时自动使用非 Web 模式，执行后关闭上下文，不开放 HTTP；显式指定其他 Web 模式会被拒绝。命令需要数据库和 Redis 配置，不需要 JWT 密钥。忘记管理员密码时使用 reset-admin-password：只恢复 ACTIVE 超管，生成临时密码，不解除归档；无交互终端时必须指定一个尚不存在的 credential-output 文件。完整命令、容器用户与文件所有权见[管理员运维](dev-ops/admin-prod.md)。

## 配置

| 配置 | 当前默认或要求 |
| --- | --- |
| IDENTITY_PRIVATE_KEY / IDENTITY_PUBLIC_KEY | Web JVM 的 PEM 绝对路径；不提供默认密钥 |
| wuhoucake.identity.issuer | urn:wuhoucake:identity |
| wuhoucake.identity.audience | wuhoucake-api |
| wuhoucake.identity.access-lifetime | 15m |
| wuhoucake.identity.session-lifetime | 7d，绝对到期；refresh 不延长 |
| wuhoucake.identity.secure-cookie | 默认/prod 为 true，dev 为 false |
| wuhoucake.identity.redis-namespace | wuhoucake:identity；集成验证使用独立值 |

时长至少 1 秒，access 不得长于 session，session 最长 7 天。Compose 使用 IDENTITY_KEY_DIR 挂载到 /run/identity，再设置两个容器内路径；宿主机 JVM 的两个文件变量与此不同。数据库、Redis 及 profile 映射见[部署配置](dev-ops/README.md#4-环境变量)。

现有镜像以 10001:10001 运行，挂载目录和私钥须对该运行用户可读，同时保持私钥的受限权限；不能用放宽组/其他用户权限绕过启动检查。宿主机 JVM 则由实际运行该 JVM 的用户读取密钥。

## 浏览器认证

1. 请求 GET /api/auth/csrf，接收 XSRF-TOKEN Cookie。认证 POST 的 X-XSRF-TOKEN 头须携带该 Cookie 的解码值。
2. POST /api/auth/login 提交 employeeNumber、password。data 返回 accessToken、tokenType、expiresIn、passwordChangeRequired；刷新凭证只通过 Cookie 传输，不在 JSON 中返回。
3. Cookie 名为 wuhoucake_refresh，HttpOnly、SameSite=Lax、路径 /api/auth，dev 关闭 Secure、prod 启用。业务请求通过 Authorization: Bearer 携带 RS256 JWT；HTTP session 无状态。
4. login/logout 会清除 CSRF Cookie，后续认证 POST 前重新取得 CSRF。refresh 依赖刷新 Cookie 和 CSRF，不依赖已到期 Bearer。
5. 前端 access token 仅驻留内存；多个 401 共用一次刷新。切换员工后，旧请求不能使用新员工凭证重试或清除其登录状态。

每次鉴权都会检查 Redis 会话是否存在且未到期、账号是否 ACTIVE、会话和账号凭证版本是否匹配。岗位不是权限：MANAGER 不等于 SUPER_ADMIN。当前所有完成改密的员工共享订单业务权限；管理员专属能力仅为 /api/admin 下的账号管理和审计查询。

新建、重置或恢复的账号须首次改密。改密前只允许 GET /api/me 和 POST /api/me/password，其他业务请求返回 PASSWORD_CHANGE_REQUIRED；认证端点仍可用于退出。新密码必须与当前密码不同，改密成功会撤销旧凭证，前端需重新登录。

员工没有统一默认密码。管理员新增或重置后，系统随机生成初始密码，员工管理页定位到本次密码提示，可展开查看并复制。临时密码只保留在当前页面内存，关闭或离开后不能找回；未记录时应重置生成新的初始密码，再交给该员工。

首次改密的“当前密码”填写初始化或重置时使用的旧密码，新密码需输入两次一致后才提交。当前密码校验失败返回 400 CURRENT_PASSWORD_INCORRECT，保留当前会话及输入，不修改密码、不撤销凭证；界面明确提示新密码尚未保存。只有真正过期或已撤销的身份返回 401。

## HTTP 契约

响应为 ApiResponse，含 code、message、data；分页 data 为 items、total、page、size。创建员工返回 201，其他成功操作返回 200。认证与敏感凭证响应 no-store，/api 路径也统一设置 no-store。

| 方法和路径 | 输入 | 权限/结果 |
| --- | --- | --- |
| GET /api/auth/csrf | 无 | 匿名，设置 CSRF Cookie，data.headerName |
| POST /api/auth/login | employeeNumber、password | CSRF；返回令牌视图并设置刷新 Cookie |
| POST /api/auth/refresh | 刷新 Cookie，无 JSON 必填字段 | CSRF；绝对会话到期不延长 |
| POST /api/auth/logout | 刷新 Cookie | CSRF；撤销该 session，清除刷新/CSRF Cookie |
| GET /api/me | Bearer | 当前账号，可在首次改密前调用 |
| PATCH /api/me/nickname | nickname | 改名，不改变固定工号 |
| POST /api/me/password | currentPassword、newPassword | 改密、清除刷新 Cookie，旧凭证失效 |
| GET /api/admin/employees | 可选 employeeNumber、nickname、status、jobRole、page、size | SUPER_ADMIN；分页查询 |
| POST /api/admin/employees | employeeNumber、nickname、jobRoles、可选 systemRole | SUPER_ADMIN；data.account 和 temporaryPassword |
| POST /api/admin/employees/{id}/reset-password | 无请求体 | SUPER_ADMIN；只重置其他 ACTIVE 账号，返回临时密码 |
| POST /api/admin/employees/{id}/archive | 无请求体 | SUPER_ADMIN；保留工号、岗位和历史 |
| GET /api/admin/audit-logs | 可选 actorId、action、result、from、to、page、size | SUPER_ADMIN；时间为 Instant，区间 [from,to) |

有效业务约束以领域校验为准，不能只参考 HTTP 注解的较宽上限：

- 工号为 1–32 个字母、数字、下划线或短横线，规范化为大写且不可改；归档不释放工号。
- 昵称去除两端空白后为 1–40 个 Unicode 码点，不允许控制字符；新密码为 15–128 个合法 Unicode 码点。
- jobRoles 至少一项，取 MANAGER、FRONT_DESK、PASTRY_CHEF；systemRole 为 STAFF（省略时默认）或 SUPER_ADMIN；status 为 ACTIVE/ARCHIVED。
- page 从 1 开始，最大 1,000,000；size 为 1–100，默认 20。分页和枚举非法返回 VALIDATION_FAILED。
- 禁止自行归档；至少保留一位 ACTIVE 超管。归档不物理删除账号，没有取消归档接口，也没有在线解锁/改工号接口。

常见错误：401 AUTHENTICATION_FAILED；403 FORBIDDEN、PASSWORD_CHANGE_REQUIRED、SELF_ARCHIVE_FORBIDDEN；409 EMPLOYEE_NUMBER_CONFLICT、LAST_ADMINISTRATOR、ACCOUNT_ARCHIVED、CONCURRENT_MODIFICATION；429 LOGIN_THROTTLED；400 VALIDATION_FAILED、CURRENT_PASSWORD_INCORRECT 或 PASSWORD_REUSE_FORBIDDEN。输入不合法、数据库不可用等全局错误见现有 ApiErrors，不能用通用 500 解释业务拒绝。

## 撤销、SSE 与审计

改密、重置、归档和管理员恢复递增凭证版本，Redis 中残留的旧 session 也无法再通过鉴权。当前 Web 进程在成功提交后关闭该账号旧版本 SSE，清空排队帧；新版本和其他员工连接保留，事务失败不误断。

每个 ready、订单事件和 15 秒心跳发送前再次复验身份，连接最长 5 分钟。独立命令进程不会向正在运行的服务广播本地撤销事件；后者在下一次发送或心跳复验关闭旧流。已进入网络的字节无法撤回；不提供跨实例即时广播或事件重放。

身份审计记录操作人、目标、动作、结果、时间和 requestId，不保存密码、密码哈希、刷新凭证或令牌。事务性账号变更使用 appendChange 与业务一起提交或回滚；非事务性的登录/退出审计失败单独诊断。订单业务历史使用自己的活动记录。SSE 正常断开按 DEBUG 处理，不再次写 JSON；真正服务端故障仍保留诊断。

源码依据：[IdentityController](../WuhouCake-identity/src/main/java/org/xaspire/WuhouCake/identity/adapter/web/IdentityController.java)、[IdentityService](../WuhouCake-identity/src/main/java/org/xaspire/WuhouCake/identity/application/service/IdentityService.java)、[SecurityConfiguration](../WuhouCake-bootstrap/src/main/java/org/xaspire/WuhouCake/bootstrap/security/SecurityConfiguration.java)、[IdentityCommands](../WuhouCake-bootstrap/src/main/java/org/xaspire/WuhouCake/bootstrap/configuration/IdentityCommands.java)。实际验证见[验证摘要](../frontend/verification.md)。
