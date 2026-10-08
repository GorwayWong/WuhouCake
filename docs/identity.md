# 账号运行与 API

## 运行配置

先按[根说明](../README.md)准备 PostgreSQL、Redis 和 RSA 密钥。普通启动需要 `IDENTITY_PRIVATE_KEY`（PKCS#8 私钥）和 `IDENTITY_PUBLIC_KEY`（X.509 公钥）；私钥必须为普通文件、仅所有者可读，推荐目录 700、文件 600。密钥不随启动更换，不提交仓库。所有者权限检查要求 POSIX 文件系统。

生产使用同源 HTTPS，TLS 由反向代理终结，`wuhoucake.identity.secure-cookie` 默认为 true；dev 仅为本机 HTTP 配置 false。Compose 通过 `IDENTITY_KEY_DIR` 只读挂载密钥目录到 `/run/identity`。Linux 部署时将目录与私钥交给镜像运行用户 `10001:10001`，确保该用户可读私钥、公钥且目录可遍历；直接运行 JVM 时交给 JVM 的运行用户。不要用放宽私钥权限解决容器访问问题。

配置项：`wuhoucake.identity.issuer` 默认 `urn:wuhoucake:identity`，audience 默认 `wuhoucake-api`，访问令牌默认 15 分钟，会话最长 7 天。两种时长至少为 1 秒，访问令牌不能长于会话；会话剩余不足 1 秒时刷新返回 401，不再签发零秒有效期令牌。`redis-namespace` 默认 `wuhoucake:identity`，共享 Redis 的独立环境须采用不同前缀。数据库迁移为 V1 员工账号及岗位、V2 操作审计。

## 初始化与恢复

命令模式不启动 HTTP，不需要 JWT 密钥。与应用使用同一数据库；通过相应 profile 和 `SPRING_*` 配置连接。凭证放在普通文件中，目录 700、文件 600，文件不能为符号链接。密码不放在命令行参数中。

初始化文件结构（实际密码自行设置，至少 15 个字符）：

```json
{"employeeNumber":"0001","nickname":"店长","password":"replace with your initial passphrase"}
```

```bash
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=prod \
  --wuhoucake.identity.command=init-admin \
  --wuhoucake.identity.credential-file=/secure/init-admin.json
```

只有不存在任何超级管理员时才会初始化；再次执行报 `ADMINISTRATOR_ALREADY_INITIALIZED`，不覆盖账号。首次登录只能查看自己、改密、刷新和退出；新密码必须与当前密码不同。

恢复文件只包含 `{"employeeNumber":"0001"}`：

```bash
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=prod \
  --wuhoucake.identity.command=reset-admin-password \
  --wuhoucake.identity.credential-file=/secure/recover-admin.json \
  --wuhoucake.identity.credential-output=/secure/new-temporary-password.txt
```

输出文件必须不存在，命令以 600 权限创建；从该文件领取临时密码后按本地凭证流程销毁。交互式终端可省略输出文件，由命令向操作者输出；非交互执行必须指定文件，避免将临时密码写入部署日志。恢复只作用于 ACTIVE 超级管理员，不恢复归档账号；旧会话立即失效。

## 浏览器认证

1. `GET /api/auth/csrf`，浏览器接收 `XSRF-TOKEN` Cookie；响应提供请求头名称。
2. 登录、刷新、退出时，把 Cookie 的值写入 `X-XSRF-TOKEN` 请求头。首次获取凭证、登录成功和退出成功后重新获取 CSRF Cookie。
3. 登录响应返回访问 JWT；前端仅保存在内存，通过 `Authorization: Bearer <token>` 调用业务 API。刷新凭证仅由 `wuhoucake_refresh` HttpOnly Cookie 携带，路径为 `/api/auth`，不出现在 JSON 中。
4. 页面刷新或访问令牌到期后调用刷新接口，获取新的访问 JWT。固定刷新凭证不轮换，多标签页可并发刷新；到期固定为原登录时间加 7 天，任何请求均不延期。
5. 退出撤销当前会话；改密、重置、归档增加数据库凭证版本，使该员工全部旧会话失效。旧 Redis 记录可能保留至 TTL，到期自动清理，但不能通过版本检查。

业务 API 不通过 Cookie 认证。初期不开放跨源 CORS，前端开发应使用同源代理。认证及个人数据响应禁止缓存。固定刷新凭证未实现重放检测；泄露后依靠主动撤销或到期失效。数据库、Redis 认证检查失败返回 503；会话过期或被撤销返回 401。

## HTTP 契约

全部响应采用 `ApiResponse`：`{"success":true,"data":...,"code":null,"message":null}`。错误只返回稳定 code，不回显请求、密码或令牌。未知 JSON 字段拒绝，操作者来自服务端认证上下文。

| 方法与路径 | 请求及响应 data |
| --- | --- |
| GET `/api/auth/csrf` | `{headerName}`，并设置 CSRF Cookie |
| POST `/api/auth/login` | `{employeeNumber,password}` → `{accessToken,tokenType,expiresIn,passwordChangeRequired}` |
| POST `/api/auth/refresh` | 无 JSON，使用刷新 Cookie → 同上 |
| POST `/api/auth/logout` | 无 JSON，清除 Cookie；重复退出成功 |
| GET `/api/me` | 当前 AccountView |
| PATCH `/api/me/nickname` | `{nickname}` → 更新后的 AccountView |
| POST `/api/me/password` | `{currentPassword,newPassword}` → null；成功后重新登录 |
| GET `/api/admin/employees` | 工号精确匹配、昵称包含匹配，支持 `status`、`jobRole`、`page`、`size` |
| POST `/api/admin/employees` | `{employeeNumber,nickname,jobRoles,systemRole?}` → `{account,temporaryPassword}`，201 |
| POST `/api/admin/employees/{id}/reset-password` | 无 JSON → `{account,temporaryPassword}`；不可重置自己或归档账号 |
| POST `/api/admin/employees/{id}/archive` | 无 JSON → AccountView；幂等，不得归档自己或最后一位有效超管 |
| GET `/api/admin/audit-logs` | 支持 `actorId`、`action`、`result`、`from`、`to`、`page`、`size` |

AccountView 包含 `accountId,employeeNumber,nickname,jobRoles,systemRole,status,passwordChangeRequired,credentialVersion,createdAt,archivedAt`。岗位为 `MANAGER/FRONT_DESK/PASTRY_CHEF`，可多选；系统身份为 `STAFF/SUPER_ADMIN`，默认 STAFF；状态为 `ACTIVE/ARCHIVED`。临时密码生成后只返回一次，丢失时重新重置。

分页从 1 开始，默认 20 条，最多 100 条，返回 `{items,total,page,size}`。记录按时间、ID 倒序；时间使用带时区的 ISO 8601，审计 `from` 含边界、`to` 不含边界。常用错误：400 `VALIDATION_FAILED/PASSWORD_REUSE_FORBIDDEN`；401 `AUTHENTICATION_FAILED`；403 `FORBIDDEN/PASSWORD_CHANGE_REQUIRED/SELF_ARCHIVE_FORBIDDEN`；404 `NOT_FOUND`；409 `EMPLOYEE_NUMBER_CONFLICT/CONCURRENT_MODIFICATION/LAST_ADMINISTRATOR/ACCOUNT_ARCHIVED`；429 `LOGIN_THROTTLED`；503 `SERVICE_UNAVAILABLE`。

## 审计与验证

不存在的已授权资源返回 404，不支持的 HTTP 方法返回 405 `METHOD_NOT_ALLOWED`，不支持的请求媒体类型返回 415 `UNSUPPORTED_MEDIA_TYPE`。

记录 identity 的登录、退出、昵称修改、改密、创建、重置、归档，以及运维初始化和恢复。每条记录包含动作、结果、时间、人员快照、目标及 requestId。登录失败没有已确认的 actorId；工号是规范化的尝试登录标识。岗位不决定权限，审计查询仅允许超级管理员。审计表无在线更新和删除接口。

成功变更在提交后通过独立事务尝试写审计。失败不回滚业务，记录 `audit_write_failed` 结构化错误并增加 Micrometer `wuhoucake.audit.failures` 计数；退出会话已撤销后，人员快照读取失败也不会阻止退出，降级记录已确认的账号 ID，并以 `audit_metadata_failed` 记录错误、增加同一计数。仅在内部监控系统配置采集，不新增公开监控端点。极端故障下允许记录缺失，不提供可靠投递或补录。所有审计事件均使用服务端事实，不记录完整请求体或凭证。

默认验证：`./mvnw clean verify`。实际 PostgreSQL、Redis 就绪后执行 `./mvnw -Pintegration verify`；测试使用独立 schema、Redis 前缀和临时 RSA 测试密钥，不污染员工数据。集成连接可通过 `SPRING_DATASOURCE_*`、`SPRING_DATA_REDIS_*` 覆盖，仅使用专用测试数据库。

参考：[Spring JWT](https://docs.spring.io/spring-security/reference/6.5/servlet/oauth2/index.html)、[Spring CSRF](https://docs.spring.io/spring-security/reference/6.5/servlet/exploits/csrf.html)、[Spring 密码存储](https://docs.spring.io/spring-security/reference/6.5/features/authentication/password-storage.html)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[若依 TokenService](https://github.com/yangzongzhuan/RuoYi-Vue/blob/master/ruoyi-framework/src/main/java/com/ruoyi/framework/web/service/TokenService.java)。
