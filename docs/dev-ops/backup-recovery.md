# 单机单盘备份与恢复

生产使用 PostgreSQL 17。每天北京时间 03:35 备份，正常时恢复点间隔约 24 小时。库、备份及发布文件共用服务器磁盘，备份用于误操作和应用故障后的恢复。异机或异盘备份可按需另外配置。

## 日常操作

部署目录为 `/home/tago-deploy/wuhou`。将 [脚本入口](compose/backup-ip-database.sh) 和 [实现](compose/backup-ip-database.py) 放在 `compose.yml` 同目录。部署账号应能运行 Docker、Python 3.11 或更新版本及 `logger`。状态目录由部署账号创建和读写。IP 部署的 app 使用同一 UID，只读挂载该目录，管理员登录后在「服务器情况」查看。

状态文件的 alerts 保留原有告警，integrityAlerts 提供新版完整性告警；应用回退后仍可读取磁盘和原有备份状态。执行 `./backup-ip-database.sh verify` 复核现有归档。首次部署也可执行 `./backup-ip-database.sh daily` 创建首份日常备份。核对 `maintenance/server-status/status.json` 存在，目录权限为 `0700`。以部署账号将以下两行写入 crontab，替换旧的 `wuhou-ip-backup` 项，保留证书续期和其他任务。服务器时区使用 Asia/Shanghai。脚本内部统一加锁，cron 直接调用。

```cron
35 3 * * * /home/tago-deploy/wuhou/backup-ip-database.sh daily >> /home/tago-deploy/wuhou/maintenance/backup.log 2>&1 # wuhou-ip-backup
*/5 * * * * /home/tago-deploy/wuhou/backup-ip-database.sh status >> /home/tago-deploy/wuhou/maintenance/backup.log 2>&1 # wuhou-ip-backup-status
```

- 手动补跑执行 `./backup-ip-database.sh daily`。发布使用 `./deploy-ip.sh --release "$candidate_image" "$candidate_release_dir"`，在切换前完成一次发布前备份。候选发布失败时按[发布恢复流程](ip-deployment.md#失败发布的恢复)处理。
- 每份备份目录包含 `database.dump` 和 `manifest.json`。导出、完整验读和校验清单写入完成后才发布。每天的日常任务对两类已发布归档复算 SHA-256，即使新备份失败也做复核。手动执行 `./backup-ip-database.sh verify` 可立即复核两类归档并更新状态。有归档损坏、不可读或扫描未完成时返回 `1`。空目录输出 `backup_verify_empty`，现有归档全部通过时返回 `0`。
- 轮换只以本轮通过校验的副本计算保留份数。日常备份保留最近 14 份有效副本。发布前备份保留最近 30 天内最多 5 份有效副本，并至少保留最新一份。出现损坏或无法确认的副本时，发布前备份至少保留最近两份已校验副本（如果存在）。损坏和不可读归档留供排查。本次最终归档回读校验失败时命令返回非零，发布停止。新备份失败或整轮复核未完成时，跳过对应轮换。
- 「服务器情况」每五分钟读取复核结果。发现损坏或复核结果缺失、超过 26 小时、文件已变更或读取失败时，按备份类型告警。最近校验成功显示最新好副本的备份时间。可查看 `maintenance/backup-integrity-daily.json` 和 `maintenance/backup-integrity-predeploy.json`，按归档目录名定位 `CORRUPT` 或 `UNREADABLE` 条目。
- 首次切换前用 `find backups releases -type f -name '*.dump' -printf '%s %p\n'` 盘点旧文件。旧目录中的发布回执和转储由运维保管。新备份策略覆盖统一目录。
- 备份失败、04:35 后缺当天有效备份、磁盘低于 4 GiB 或 15% 时查看「服务器情况」。部署账号可查 `maintenance/backup.log`，具备主机日志权限时也可用 `journalctl -t wuhou-backup --since today` 核对告警和恢复。空余不足 2 GiB 时中止备份，先从日志、发布文件和磁盘使用量定位来源。页面显示状态不可确认时检查采集 cron 及挂载权限，手动运行 `./backup-ip-database.sh status`。全部定时任务停摆时，页面会在状态摘要过期后提示。
- 恢复前使用清单核对大小及 SHA-256，再完整验读。检查输出仅显示校验结果。

```sh
BACKUP_DIR=/home/tago-deploy/wuhou/backups/daily/20261117T193501000000Z # 改为实际目录
python3 - "$BACKUP_DIR" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

folder = Path(sys.argv[1])
manifest = json.loads((folder / "manifest.json").read_text())
dump = folder / "database.dump"
with dump.open("rb") as source:
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
if dump.stat().st_size != manifest["bytes"] or digest.hexdigest() != manifest["sha256"]:
    raise SystemExit("备份校验不匹配")
print("SHA-256 和大小校验通过")
PY
docker run --rm -i --pull=never --network none --entrypoint pg_restore postgres:17-bookworm \
  --exit-on-error --file=/dev/null < "$BACKUP_DIR/database.dump"
```

## 在同机隔离库读取备份

在部署目录执行。先核对磁盘和内存余量。以下命令为 PostgreSQL 建立新卷和无网络容器。单单找回使用独立临时密码，整库切换时使用部署文件中原有的 `POSTGRES_PASSWORD`，通过交互输入保存到进程环境。该密码不要写入命令或日志。若原容器无法检查，使用部署记录中的 PostgreSQL 17 镜像。

```bash
set -euo pipefail
cd /home/tago-deploy/wuhou
restore_id=$(date -u +%Y%m%dT%H%M%SZ)
restore_volume="wuhou-ip-recovery-$restore_id"
restore_box="wuhou-ip-recovery-$restore_id"
pg_image=$(docker inspect -f '{{.Image}}' "$(docker compose ps -aq postgres)")
read -rsp 'PostgreSQL 恢复库初始化密码：' POSTGRES_PASSWORD
printf '\n'
export POSTGRES_PASSWORD
docker volume create "$restore_volume"
docker run --pull=never -d --name "$restore_box" --network none --memory 192m --cpus 0.30 \
  --mount "type=volume,src=$restore_volume,dst=/var/lib/postgresql/data" \
  -e POSTGRES_USER=wuhou -e POSTGRES_DB=wuhou -e POSTGRES_PASSWORD "$pg_image" \
  postgres -c shared_buffers=24MB -c maintenance_work_mem=12MB -c max_connections=6
unset POSTGRES_PASSWORD
for _ in {1..30}; do
  if docker exec "$restore_box" pg_isready -q -h 127.0.0.1 -U wuhou -d wuhou; then break; fi
  if [ "$(docker inspect -f '{{.State.Status}}' "$restore_box")" != running ]; then
    docker logs --tail 30 "$restore_box"
    exit 1
  fi
  sleep 2
done
docker exec "$restore_box" pg_isready -h 127.0.0.1 -U wuhou -d wuhou
docker exec -i "$restore_box" pg_restore --exit-on-error --single-transaction -U wuhou -d wuhou \
  < "$BACKUP_DIR/database.dump"
docker exec -i "$restore_box" psql -X -v ON_ERROR_STOP=1 -U wuhou -d wuhou <<'SQL'
SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 5;
SELECT count(*) FROM cake_order;
SELECT count(*) FROM cake_order_item;
SELECT count(*) FROM cake_order_image;
SELECT count(*) FROM identity_account;
SELECT count(*) FROM customer_order_submission;
SELECT count(*) FROM audit_operation;
SQL
```

检查恢复结果和备份时间。恢复出错时查看容器日志，在另一个新卷重试。

## 找回单笔订单

1. 先在「订单查询与统计」核对订单号、日期、联系电话及是否已经被标记删除。确认是软删除时，由有权限的员工从已删除订单打开原单并恢复。操作前核对是否已建立替代单、是否收款和是否交付。
2. 当前库找不到原单时，按上一节恢复当时备份。通过隔离库的 `docker exec -it "$restore_box" psql -X -U wuhou -d wuhou` 连接后执行 `BEGIN READ ONLY;`。在 `cake_order` 按订单号和日期核对订单，用原订单 ID 查看 `cake_order_item`、`cake_order_image`、`cake_order_activity` 以及 `customer_order_submission`，核实商品、图片、付款及来源。结合门店现有记录确认最新状态。
3. 确认需要补建后，通过工作台重录并补传参考图片，登记新旧单号和恢复依据。重新登记付款或业绩前由店长核对原记录。原单旧活动和来源记录可在隔离库核对。
4. 核对补建、图片和收款记录。用 `ROLLBACK;` 结束只读会话。确认不再需要隔离副本后，按容器和卷的准确名称停机并删除它们。Docker 卷列表中的生产卷需原样保留。

需要从隔离库导出图片时，在原单内核对图片 ID 和 `content_type`。把以下示例中的订单号、图片 ID 和后缀换为实际值，每次仅输出一张。导出的图片按订单资料权限保管。

```bash
set -o pipefail
order_no='已核对的原订单号'
image_id='已核对的图片 UUID'
file='/tmp/wuhou-recovered-image.png'
docker exec -i "$restore_box" psql -XAtq -v ON_ERROR_STOP=1 -v order_no="$order_no" \
  -v image_id="$image_id" -U wuhou -d wuhou <<'SQL' | python3 -c '
import os, sys
data = bytes.fromhex(sys.stdin.read().strip())
if not data:
    raise SystemExit("未找到该订单的图片")
os.umask(0o077)
with open(sys.argv[1], "xb") as target:
    target.write(data)
' "$file"
SELECT encode(image.content, 'hex')
FROM cake_order_image image JOIN cake_order orders ON image.order_id = orders.id
WHERE orders.order_no = :'order_no' AND image.id = :'image_id'::uuid;
SQL
```

## 恢复整库

1. 由店长和运维确认维护窗口、目标备份和可接受的数据损失。依上节先在新卷恢复并核对关键数据和 Flyway 版本。用 `docker exec -u postgres "$restore_box" pg_controldata /var/lib/postgresql/data` 记录新卷的集群标识。核对磁盘余量、自备份以来的新增业务和员工权限变更。
2. 用 `docker compose stop gateway app` 暂停入口和写入。原库能读时执行 `./backup-ip-database.sh predeploy` 保留冻结后的最后快照，校验失败时先排查。复制原 `.env` 到单一受限的恢复记录文件，权限 `0600`，登记原 PostgreSQL 卷、集群标识、镜像和发布版本。
3. 停止隔离容器，保留已恢复卷。停止并移除生产 PostgreSQL 的旧容器记录，保留其旧卷。依次执行 `docker compose stop postgres`、`docker compose rm -f postgres`。将 `.env` 的 `DEPLOY_POSTGRES_VOLUME` 和 `DEPLOY_POSTGRES_SYSTEM_IDENTIFIER` 改成已核对的新卷和标识，项目名保持 `wuhou-ip`。执行 `./deploy-ip.sh --check`，再执行 `./deploy-ip.sh postgres` 启动新数据库。校验新容器实际挂载新卷。
4. 公网入口仍暂停时，核对备份之后的账号禁用、角色变更和密码重置，补做必要的撤销。确认已吊销历史会话，再启动 app，核对登录、订单与图片数据、金额及审核记录。通过后执行 `./deploy-ip.sh` 恢复网关，确认新写入和下一份备份。
5. 如需切回原库，先停入口和 app，核对切换后的新写入并另存有效备份，再停止并移除当前 PostgreSQL 容器。恢复原 `.env`，用 `./deploy-ip.sh --check` 复核原卷和集群标识，再启动。两份数据库卷保留到人工确认恢复结果和切换后的写入处理完毕。

吊销历史会话时保持 app 停止。默认 IP 部署中的命名空间是 `wuhoucake:identity`。如配置过其他值，先核对实际值，再按该前缀清理 session 键。

```sh
docker compose exec -T redis sh -ec '
  export REDISCLI_AUTH="$REDIS_PASSWORD"
  keys=$(redis-cli --scan --pattern "wuhoucake:identity:session:*")
  for key in $keys; do redis-cli UNLINK "$key" >/dev/null; done
  remaining=$(redis-cli --scan --pattern "wuhoucake:identity:session:*")
  test -z "$remaining"
'
```
