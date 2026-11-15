# 图片处理隔离与套餐恢复验证

日期：2026-11-15，Asia/Shanghai。起始代码基线 `022e59f`。核心隔离修复于 22:33 上线，最终元数据核对补丁于 22:50:51 上线。本文件与修复代码一同纳入版本管理；后续按提交发布的版本和校验结果保存在服务器发布目录的 `manifest.json` 与 `deployment.json`。

## 故障与修复范围

事故发生于 19:56:57 开始的套餐创建请求，用户确认上传了 7 张图片，认为是手机原图。现场请求处于 JPEG 解码/缩图，套餐事务一直等待客户端继续，认证接口也无响应。未取得事故原图及故障期 GC 日志，不能认定具体 JDK/GC 缺陷。VM Thread 累计 CPU 时间不是事故窗口采样。首次恢复记录见 [事故排查](2026-11-15-package-image-incident.md)。

修复涉及套餐及共用订单图片上传、图片维护入口、认证等待和套餐本机恢复；不修改数据库结构、历史数据、价格或生产交接规则。

## 实现

- JPEG/PNG 原始图片只解码一次，读取时按目标长边降采样，继续使用 Thumbnailator 的缩放和 EXIF 方向过滤器。保留透明、小图、截断拒绝及 1920 长边契约。
- 生产解码在独立 320 MiB/1 CPU 图片容器内进行：监督 JVM 48 MiB 堆、每图子 JVM 128 MiB 堆，单图 10 秒期限；主应用等待含正文最多 12 秒。超时终止并等待子进程退出、清理临时文件，然后才释放处理容量和返回响应。
- 主应用 multipart 入口一个活跃上传、两个等待名额，最多等待 2 秒。套餐原图逐张读取，不先把整批原图放入 byte[]；图片准备在事务外完成，提交时重新核对权限、版本和幂等键。已提交同键重放按原指纹验证，不再解码。
- 编辑、保存及幂等核对使用元数据查询，仅取文件名、类型和指纹，不读取已存图片 BLOB；避免大套餐的图片数据在事务及 MyBatis 缓存中累积。实际查看图片的接口继续按需读取内容。
- 套餐最多单次上传 16 张、原文件总量 64 MiB、处理后总量 32 MiB；单图限制仍为 5 MiB / 8192 单边 / 2400 万像素。
- 认证总期限 15 秒，包括 CSRF 和两段 JSON 正文。套餐及订单图片写入期限 60 秒，图片读取期限 30 秒。传输超时不自动重新创建，保留原 key 和待核对操作。
- 套餐编辑及待核对记录按账号和标签页保存在 IndexedDB，提交前先持久化文件及原请求。版本比较防止复制标签页的旧记录覆盖/删除新记录。明确拒绝会立即更新持久化状态；已确认服务端结果但本机清理失败时保留重试并显示原因。
- `prod` Web 禁止自动回退主 JVM 解码；非 Web 管理员命令仍可独立执行。健康检查有客户端期限，主应用 GC/safepoint 使用已有 Docker 日志轮转；图片处理日志不含原图或客户数据。

## 开源实现参考

- [Thumbnailator InputStreamImageSource](https://github.com/coobird/thumbnailator/blob/master/src/main/java/net/coobird/thumbnailator/tasks/io/InputStreamImageSource.java)：其大图内存优化使用 ImageReadParam subsampling。这里显式设定目标读取规模，避免依赖剩余堆空间触发的启发式分支；继续复用现有 0.4.21 库的缩放、EXIF 解析和方向变换。
- [libvips 线程模型](https://www.libvips.org/API/current/using-threads.html) 和 [读取模型](https://www.libvips.org/API/current/using-from-c.html)：参考其受控并发和避免不必要全图物化的原则，没有引入新的图片库或复制实现。
- [ImageMagick 资源策略](https://imagemagick.org/security-policy/)：参考分开约束内存、CPU/线程、磁盘、输入规模及处理时间的思路。实现使用独立进程与容器预算，不把 Java Future 超时误当作解码已经停止。
- [Java Image.flush](https://docs.oracle.com/en/java/javase/21/docs/api/java.desktop/java/awt/Image.html#flush())：BufferedImage 主 Raster 不会因 flush 被释放，因此不能靠 flush 消除重复解码峰值。

## 已完成验证

- Java 21 全单元及 ArchUnit：最终 418 项通过。真实 PostgreSQL/Redis 的完整集成回归：178 项通过；最终元数据补丁另通过 11 项套餐集成，断言创建/重放不调用完整图片读取接口。
- 前端测试 211 项、TypeScript/Vite 构建通过。浏览器 7 项通过：七图响应丢失后刷新、同键重试、核对时再遇 busy、草稿 CAS、明确拒绝后立即刷新、DELETE 结果确认后清理失败，以及原有多人换图和版本冲突。
- 子进程故障注入验证不可中断任务被终止、崩溃后下一张图仍可处理、响应正文挂起按期限退出。EXIF 1–8 方向和镜像全部通过。
- 追加最大 2400 万像素透明 PNG 验证，确认在 128 MiB 解码子堆内成功、透明度保持、输出严格为 1920×1280；按原图比例计算输出尺寸，消除降采样栅格向上取整产生的 1 像素偏差。真实子 JVM OOM 退出后，下一张图仍可处理。
- 首轮受限资源测试：七张 6000×4000 合成 JPEG，共 31,248,421 字节，含两张渐进 JPEG。132.88 秒完成 8 批，16 次过载拒绝；372 次读取无错误，p95 约 0.054 秒、最大约 0.237 秒。暂停图片容器时上传约 12.36 秒返回 `IMAGE_PROCESSING_TIMEOUT`，认证及读取继续成功。
- [30 分钟持续结果](2026-11-15-soak-30min.json)：1805.15 秒完成 125 批七图提交、250 次过载拒绝；5178 次读取无错误，p95 约 0.023 秒、最大约 1.006 秒。图片端暂停时上传约 12.59 秒受控超时；主应用及图片容器无 OOM kill 或重启，未发现残留空闲事务。
- [尺寸修正镜像复测](2026-11-15-final-probe.json)：在时间戳与尺寸边界修正后，镜像再次完成 7 批七图、14 次过载拒绝及图片端暂停验证；336 次读取无错误，p95 约 0.057 秒、最大约 0.514 秒。最终元数据补丁的 7 个图片隔离运行类与该镜像逐字节一致，并另跑单元/架构及套餐集成。不同候选的验证分别记录，不冒充同一镜像的完整长测。

压力测试在本机 Docker 的 linux/amd64 环境执行，app 为 256 MiB 堆/640 MiB 容器且限制 1 CPU，图片端为 320 MiB/1 CPU。主机为 arm64，存在模拟运行开销；这些数据不等同于真实门店网络或生产峰值。合成图片不能替代事故原图复现。

验收脚本：[image-isolation-probe.py](image-isolation-probe.py)。它也会对提前拒绝大请求造成的连接中断使用原键核对，避免漏查可能已提交的请求。运行步骤见 [测试指南](../testing.md)。

## 发布状态

生产版本：`20261115T144607Z-image-resilience`。2026-11-15 22:50:51（Asia/Shanghai）完成最终后台更新；核心隔离首次于 22:33:08 上线。

- 镜像 ID：`sha256:62d5d2911b752ef087c478a22f92a31f8d78095c7adc04863ae358218ec21f43`。
- JAR SHA-256：`69adad73edfba28713a9613ac09cd98bd00074687b84f6cd7d4fc905792f553d`。
- 后台发布目录：`/home/tago-deploy/wuhou/releases/20261115T144607Z-image-resilience`；前端继续使用 `20261115T140102Z-image-resilience/dist`。`manifest.json`、`stage-verified.json`、`deployment.json` 保存文件校验和发布结果；`env.before`、`compose.before.yml` 保留原配置，权限受限。
- 首次配置核对仅有 app 镜像、图片端连接、JVM 日志选项、图片服务依赖、新图片服务及前端挂载目录的预期差异；最终元数据补丁仅更换 app/image-worker 镜像，未重建网关或更换前端资产。
- 图片端真实 2×2 PNG 解码自检、主应用健康、app 到图片端连通、公网 CSRF 200、首页及所有 JS/CSS 哈希校验通过；发布后再次从外部验证 CSRF 约 90 毫秒。未使用真实员工凭据执行登录或写入真实业务测试数据。
- 上线后 app 与 image-worker 均为 healthy；空闲状态快照分别约 280.8 MiB / 29.16 MiB，不能当作压力峰值。数据库当前 Flyway V32 成功，空闲未提交事务为 0。
- 发布前备份：`backups/wuhou-20261115T135338Z.dump`（3,056,458 字节，pg_restore 索引检查通过）；最终切换前另保存发布目录中的 `pre-deploy.dump`。未恢复或改写数据库业务记录，没有数据库迁移。

第一次发布预检因 BusyBox wget 的二进制探针发送方式返回 `INVALID_IMAGE`，脚本在替换主应用/网关前恢复原配置，旧服务保持健康。改用明确 Content-Length 的二进制探针并在本地验证后，重新发布成功；前次结果保留于首次发布目录的 `deployment-previous-attempt.json`。

回滚应成套恢复 `env.before` 和 `compose.before.yml`，按原配置重建 app/image-worker/gateway；仅当回退目标没有图片服务时才停止新增图片容器。不自动恢复数据库备份，以免覆盖发布后的合法数据。回退到隔离修复之前的版本会重新引入原图片风险。
