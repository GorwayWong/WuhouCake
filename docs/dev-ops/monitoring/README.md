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
| `wuhou_files_{active,rejected_total}`、`wuhou_exports_{requests,timeouts}_total` | 图片下载、导出准入、导出数量与服务端超时 |
| `wuhou_sse_connections`、`wuhou_sse_queue_overflows_total` | 活动 SSE 连接和队列溢出 |
| `wuhou_temp_{used,free,reserved,capacity}_bytes`、`wuhou_temp_{cleanup_failures,rejections}_total` | 临时盘已用、可用、已预留、预算和失败次数。读取失败时磁盘值为 -1 |

[alerts.yml](alerts.yml) 是外部 Prometheus 规则示例。OOM 规则使用既有 cAdvisor 兼容采集的 `container_oom_events_total` 和 Compose 服务标签，告警后关联 Docker 容器状态的 `.State.OOMKilled` 与 `oom` 事件。若现有容器采集使用其他指标，按实际名称调整该规则。采集规则只使用固定业务类别、框架路径模板和服务标签。
