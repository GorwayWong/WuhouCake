# 员工身份领域

维护员工账号、固定工号、可修改昵称、六种可兼任岗位、凭证与登录资格。店长岗位同时具有超级管理员身份，移除店长时同步撤销该身份，并保护最后一位管理员；旧岗位需逐人确认后迁移。公开契约为 `api.facade.IdentityFacade`，领域模型为不可变 `EmployeeAccount` 和有绝对截止时间的 `LoginSession`。

`api.facade.EmployeeAccess` 定义操作权限和派生 UI 能力，`EmployeeAccessPolicy` 组合多岗位权限与系统管理权限。账号视图包含当前有效的 `access`，每次认证重新计算；首次改密前与归档账号无有效能力。bootstrap 将权限装配到 HTTP 授权，业务模块通过 identity.api 使用权限契约。默认授权、岗位覆盖配置及敏感字段边界见[员工权限说明](../docs/authorization.md)。

domain 仅依赖自身与核心 JDK；密码哈希、JWT、Redis 和 MyBatis 通过领域端口适配。application 维护事务、管理员规则、凭证版本和审计；账号业务变更及非敏感前后快照同事务提交，失败一并回滚，登录/退出事件独立诊断。infrastructure 实现 PostgreSQL 仓储、Argon2id、Nimbus JWT、Redis 会话与失败次数计数。bootstrap 显式装配。

`identity → audit.api` 为单向依赖。归档不删除账号、工号和岗位。改密、重置、归档增加凭证版本，Redis 中残留的旧会话也不可使用。管理员生命周期使用同一个 PostgreSQL 事务锁；更新采用独立的并发版本。

凭证版本变化同时发布公开 api 契约 IdentityFacade.CredentialsRevoked(accountId, credentialVersion)。本进程的消费者仅在事务成功提交后处理；订单 SSE 据此关闭旧版本连接，事务回滚或提交失败时不误断。事件不包含密码或令牌，不增加订单业务活动；账号变更审计与业务同事务，凭证撤销通知仅在提交后处理。发送前仍以 authenticate(accountId, sessionId, credentialVersion) 校验 Redis 会话和数据库资格，覆盖注销、过期、通知遗漏及跨进程变更；不新增 Redis 发布订阅或账号表迁移。

运行、运维命令、HTTP 契约和已选择的认证边界见[账号运行说明](../docs/identity.md)。领域词汇见[CONTEXT](../CONTEXT.md)。

单模块验证：`./mvnw -pl WuhouCake-identity -am clean verify`；真实 HTTP 与 PostgreSQL/Redis 集成测试位于 bootstrap，执行 `./mvnw -Pintegration verify`。
