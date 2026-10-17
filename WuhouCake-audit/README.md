# 操作审计领域

通过 `api.facade.AuditFacade` 提供追加事件和超级管理员分页查询。事件保存动作、结果、时间、操作者身份快照、目标、requestId 及受限的 details 文本键值，不接收密码、令牌或任意请求载荷。domain 保持纯 Java，PostgreSQL 适配和显式装配遵循仓库五层规则。

audit 不依赖 identity；查询资格由 bootstrap 注入的 `AuditAccess` 端口检查。identity 只调用 audit 公开 API。`append` 使用独立事务，由调用方决定提交后失败策略；`appendChange` 要求已有事务，用于员工资料前后值记录，失败时与资料更新一起回滚。订单业务活动仍属于订单领域。

首期无更新、删除、导出、清理或 HTTP 追加接口。内部调用 `append(Command)` 时，必须由调用方传入服务端确认的操作者和事实；未知登录者允许 actorId 为空。

查询 API、字段、错误码及运维监控见[账号运行说明](../docs/identity.md)。单模块验证：`./mvnw -pl WuhouCake-audit -am clean verify`。真实集成测试位于 bootstrap。
