# Prod 管理员运维

用于首次创建超级管理员，以及管理员忘记密码时恢复账号。唯一超级管理员忘记密码，也可以直接在服务器执行恢复命令，无需旧密码或其他管理员。

| 场景 | 操作 |
| --- | --- |
| 系统还没有超级管理员 | `init-admin` 初始化首位管理员 |
| 还有可登录的超级管理员 | 在线创建其他超管或重置其他账号，见[账号 API](../identity.md#http-契约) |
| 唯一管理员或全部管理员忘记密码 | `reset-admin-password` 恢复指定 ACTIVE 超管 |

## 1. 执行前准备

使用**当前线上相同版本**的 JAR 或镜像，连接**线上同一个数据库**，沿用现有 `SPRING_*` 数据库、Redis 配置。命令不启动 HTTP，不需要 JWT 私钥，无需停止或重启正在运行的应用。

以下示例使用 Bash，路径按服务器部署调整。以运行 JAR 的系统用户准备专用运维目录：

```bash
WUHOUCAKE_JAR=/srv/wuhoucake/application.jar
WUHOUCAKE_ADMIN_DIR=/srv/wuhoucake/admin-ops
umask 077
mkdir -p "$WUHOUCAKE_ADMIN_DIR"
chmod 700 "$WUHOUCAKE_ADMIN_DIR"
```

JAR 方式需要 Java 21 或以上，并设置 `SPRING_DATASOURCE_URL`、`SPRING_DATASOURCE_USERNAME`、`SPRING_DATASOURCE_PASSWORD`、`SPRING_DATA_REDIS_HOST`、`SPRING_DATA_REDIS_PASSWORD`；Redis 端口默认 6379。宿主机运行时使用宿主机可达地址，不能直接照搬 Compose 内的 `postgres`、`redis` 服务名。

凭证文件必须是普通文件，权限 `600`，不能是符号链接。用编辑器填写密码，不把密码写入命令行、脚本日志或 Git。Compose 部署可直接使用第 4 节的执行方式。

## 2. 首次初始化

用编辑器保存 `$WUHOUCAKE_ADMIN_DIR/init-admin.json`，将示例中的 password 替换为自己的 **15—128 字符**初始口令：

```json
{"employeeNumber":"0001","nickname":"店长","password":"SET_YOUR_OWN_LONG_PASSPHRASE"}
```

```bash
chmod 600 "$WUHOUCAKE_ADMIN_DIR/init-admin.json"
java -jar "$WUHOUCAKE_JAR" \
  --spring.profiles.active=prod \
  --wuhoucake.identity.command=init-admin \
  --wuhoucake.identity.credential-file="$WUHOUCAKE_ADMIN_DIR/init-admin.json"
```

成功显示 `Administrator initialized: <accountId>`。首次登录后必须改为与初始口令不同的新密码，改密成功后重新登录，才能使用管理员功能。完成后删除初始化文件。

初始化仅在数据库中不存在任何超级管理员时执行；再次运行会报 `ADMINISTRATOR_ALREADY_INITIALIZED`，不会覆盖已有账号。后续新增超管使用 `POST /api/admin/employees`，指定 `systemRole=SUPER_ADMIN`，不再次执行初始化命令。

## 3. 忘记密码恢复

保存 `$WUHOUCAKE_ADMIN_DIR/recover-admin.json`，只填写目标管理员工号：

```json
{"employeeNumber":"0001"}
```

```bash
chmod 600 "$WUHOUCAKE_ADMIN_DIR/recover-admin.json"
java -jar "$WUHOUCAKE_JAR" \
  --spring.profiles.active=prod \
  --wuhoucake.identity.command=reset-admin-password \
  --wuhoucake.identity.credential-file="$WUHOUCAKE_ADMIN_DIR/recover-admin.json" \
  --wuhoucake.identity.credential-output="$WUHOUCAKE_ADMIN_DIR/new-temporary-password.txt"
```

**输出文件必须事先不存在，不要提前创建。** 命令自动以 `600` 权限创建，写入新的临时密码，并显示 `Administrator password reset; change password on next login.`

恢复成功后：

1. 从输出文件领取临时密码，通过受控方式交给对应管理员。
2. 该管理员的旧密码及全部旧登录状态立即失效；其他员工不受影响。
3. 管理员用临时密码登录，先修改为自己的新密码，再重新登录。
4. 确认完成后删除恢复输入文件及临时密码文件。

恢复保留原账号、工号、岗位和历史关联，仅适用于 `ACTIVE` 超级管理员，不解除归档。非交互式脚本必须指定输出文件；不要把临时密码收集进部署日志。

## 4. Docker Compose 执行

使用仓库的 prod 配置，从仓库根目录执行。PostgreSQL、Redis 和环境网络须已经就绪，`prod.env` 中的镜像、连接配置及 `IDENTITY_KEY_DIR` 使用线上实际值。

默认镜像以 `10001:10001` 运行。恢复操作前，将专用目录和输入文件交给该用户，保持目录 `700`、输入文件 `600`：

```bash
sudo chown 10001:10001 "$WUHOUCAKE_ADMIN_DIR" "$WUHOUCAKE_ADMIN_DIR/recover-admin.json"
docker compose --env-file docs/dev-ops/env/prod.env \
  -f docs/dev-ops/compose/docker-compose-app.yml \
  run --rm --no-deps -T \
  --volume "$WUHOUCAKE_ADMIN_DIR:/run/admin-ops" \
  app \
  --spring.profiles.active=prod \
  --wuhoucake.identity.command=reset-admin-password \
  --wuhoucake.identity.credential-file=/run/admin-ops/recover-admin.json \
  --wuhoucake.identity.credential-output=/run/admin-ops/new-temporary-password.txt
```

临时密码会保存在宿主机的 `$WUHOUCAKE_ADMIN_DIR/new-temporary-password.txt`，由有权限的运维用户读取。该方式复用 app 的网络和环境配置，创建一次性容器，执行后自动删除，不发布应用端口。

初始化也使用上述 Compose 命令：先将 `init-admin.json` 的所有者设为 `10001:10001`，把 command 改为 `init-admin`、credential-file 改为 `/run/admin-ops/init-admin.json`，并省略 credential-output。输入 JSON 与第 2 节相同。

## 5. 常见失败

| 提示或现象 | 处理 |
| --- | --- |
| `ADMINISTRATOR_ALREADY_INITIALIZED` | 已有超管；忘记密码应执行恢复命令 |
| `NOT_FOUND` | 检查工号及数据库连接，确认使用线上同一个数据库 |
| `FORBIDDEN` / `AUTHENTICATION_FAILED` | 目标不是超级管理员或已归档；此命令不恢复归档账号 |
| `Invalid credential file` / `VALIDATION_FAILED` | 检查 JSON、字段名称、工号和初始口令长度 |
| `AccessDeniedException` / 文件权限错误 | 检查执行用户；目录可遍历、文件可读且不允许组或其他用户访问 |
| `FileAlreadyExistsException` | 为输出文件换一个尚不存在的文件名，不覆盖已有凭证文件 |
| 数据库或 Redis 连接错误 | 核对环境变量、网络、端口及账号配置，修正后重试 |

以命令退出码 `0` 和对应成功提示确认完成。失败后先检查原因；若输出文件已存在但为空，使用新文件名重试。临时密码未领取或丢失时可再次执行恢复，前一次生成的密码会失效。
