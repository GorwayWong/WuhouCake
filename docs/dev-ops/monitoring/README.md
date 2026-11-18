# 生产指标采集

将 [scrape.yml](scrape.yml) 合并到已有的外部 Prometheus 配置。用可信运维采集器执行以下只读命令，将输出通过私网 HTTPS 和采集凭据分别提供给 `/app` 与 `/worker` 两个采集路径。IP 部署在服务器 Compose 目录执行命令。标准部署追加 `--env-file` 和对应 app Compose 的 `-f` 参数。采集服务要保留抓取错误状态，抓取间隔可用 30 秒。

```sh
docker compose exec -T app wget -qO- http://127.0.0.1:8080/actuator/prometheus
docker compose exec -T image-worker wget -qO- http://127.0.0.1:8091/metrics
```

只有应用容器回环地址可访问 Actuator 指标。业务网关仅代理 `/api/`；Worker 端口留在受信任的 Compose 网络。采集器使用已有的授权运维通道，避免将 Docker socket、Docker API、Actuator 或 Worker 端口直接提供给外部采集机。Compose 清单无需运行监控容器。

| 指标 | 用途 |
| --- | --- |
| `jvm_memory_*`、`tomcat_*`、`hikaricp_connections_*` | JVM 内存、Tomcat 线程、连接池与等待 |
| `http_server_requests_seconds_bucket` | 应用端 HTTP 延迟分布。分别用 `histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{job="wuhou-app"}[5m])))` 和 0.99 计算 P95/P99 |
| `wuhou_uploads_active`、`wuhou_uploads_{succeeded,rejected,failed}_total` | 按 order/package 统计通过鉴权的 multipart 请求。rejected 包含入口 BUSY 和 4xx，failed 包含 5xx 及中断。按成功、拒绝、失败三类增量求占比 |
| `wuhou_image_worker_active`、`wuhou_image_worker_{admitted,rejected,success,failed,timeout}_total` | Worker 并发、准入和解码结果，按已准入次数计算失败和超时比率 |
| `wuhou_files_{active,rejected_total}`、`wuhou_exports_{requests,timeouts}_total` | 图片下载和导出准入。导出生成期限或文件传输期限超时各计一次，客户端断开单独处理 |
| `wuhou_sse_connections`、`wuhou_sse_queue_overflows_total` | 活动 SSE 连接和队列溢出 |
| `wuhou_temp_{used,free,reserved,capacity}_bytes`、`wuhou_temp_{cleanup_failures,rejections}_total` | 文件系统已用、可用空间，以及应用已预留、预算和失败次数。读取失败时磁盘值为 -1 |

[alerts.yml](alerts.yml) 是外部 Prometheus 规则示例。OOM 规则使用既有 cAdvisor 兼容采集的 `container_oom_events_total` 和 Compose 服务标签，告警后关联 Docker 容器状态的 `.State.OOMKilled` 与 `oom` 事件。若现有容器采集使用其他指标，按实际名称调整该规则。采集规则只使用固定业务类别、框架路径模板和服务标签。

临时存储告警适用于默认目录和可选专用盘。空闲不足 128 MiB 或读取失败时保留原低空间告警。近 5 分钟内准入拒绝计数增加时单独告警。单次导出需预留 768 MiB，外加 64 MiB 空闲保护和活动预留，因此磁盘余量高于 128 MiB 时也可能发生拒绝。实际发出通知需要外部 Prometheus 采集并加载规则，以及 Alertmanager 或现有告警投递服务。可用 `promtool test rules docs/dev-ops/monitoring/alerts.test.yml` 验证规则。

## 主应用探测

把 [blackbox.yml](blackbox.yml) 的公网 API 模块合并至私网 Blackbox Exporter，并移除原 `wuhou_ready` 模块和对应凭据挂载。更新 [scrape.yml](scrape.yml) 中的公网 API、私有采集器和探测器地址。Prometheus 直接通过 HTTPS 和采集凭据抓取私有采集器的 `/ready`。将 [就绪采集脚本](../compose/probe-ip-readiness.sh) 放到 IP 部署目录，由采集器在受认证的 `/ready` 执行。响应使用 Prometheus 文本格式，禁用缓存，并且接口不接受探测地址参数。

```sh
./probe-ip-readiness.sh
```

脚本检查应用容器内固定的 readiness 地址，覆盖 PostgreSQL 和 Redis。任一依赖不可用、应用未就绪或探测不可达时输出 `wuhou_app_ready 0`。采集器执行失败时返回非 2xx。容器存活检查使用 liveness。日常备份告警由主机任务汇总到「服务器情况」及 `wuhou-backup` 系统日志，见[备份与恢复](../backup-recovery.md)。

将 `WuhouAppScrapeUnavailable` 和 `WuhouAppProbeUnavailable` 路由到现有 Alertmanager 通知通道并启用恢复通知。预发布依次模拟应用停止、数据库停止和网关不可达，每次确认对应探测失败、持续 2 分钟后触发以及恢复后的通知，再进行下一项。缺失也会触发告警，因此安装时先启用探测目标再加载规则。

员工登录的两个并发名额由 `wuhou_login_active` 暴露，`wuhou_login_rejected_total` 记录因满载返回 `LOGIN_BUSY` 的次数。结合登录延迟和 JVM 堆占用检查高峰容量。
