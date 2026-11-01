# 订单删除仅限店长

2026-10-29：`ORDER_DELETE` 默认只授予 `STORE_MANAGER`；兼任店长保留权限。前厅主管、前厅店员、旧 `MANAGER` 或仅有 `SUPER_ADMIN` 身份不因此获得删除权限。非店长岗位配置删除权限会拒绝启动，避免配置重新扩大授权。

`ORDER_DELETED_READ`、取消订单、客户未确认填单删除和保留期清理规则不变。HTTP 与应用服务继续使用现有权限检查；前端继续依据服务端权限隐藏订单删除入口，无新增岗位判断。

## 验证

- EmployeeAccessPolicyTest、EmployeeAccessPropertiesTest，以及主工程和模块的 Architecture/ArchitectureRules 定向测试通过。
- 前端 `tests/access.test.ts` 通过，覆盖前厅不可删除但可查已删除记录、店长可删除。
- WorkflowManagementIT 使用随机数据库 schema 和 Redis 命名空间运行：20 项中 19 项通过。覆盖前厅删除返回 403、店长对各状态订单删除成功、重复删除、版本冲突、回滚、到期清理和竞争处理。
- 唯一失败是既有商品类型预期：`mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs` 仍预期 `CUPCAKE`，实际为规范化后的 `TEA_BREAK`；本次未修改该不相关断言，不能将整组集成验证标为全通过。
- 首次集成启动受 dev 的 `CUSTOMER_ENTRY_PUBLIC_ORIGIN=auto` 环境变量影响；测试进程取消该变量及 dev profile 后正常运行，未修改环境配置文件。

运行中的业务后端本轮未重启；部署或重启新构建后生效。前端重新读取当前账号能力后隐藏删除按钮。
