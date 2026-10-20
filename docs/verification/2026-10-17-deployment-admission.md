# 部署站点准入：静态核对与待提供信息

2026-10-17，基线 `d3694eb7838e694699eb2fd3052717af5e7083d0`，初始工作区干净。本轮仅核对源码、示例配置和部署契约；尚未获得站点 URL、实际代理配置或测试身份。**部署站点准入仍为 NOT RUN**，不改变[核心验收的 CONDITIONAL GO](2026-10-17-core-uat-rerun.md)。没有连接生产数据库、启动部署、调用模型或改动生产配置。

## 已核对的应用契约

下表“已核对”仅表示当前代码/示例具有该行为，不能替代站点实测 PASS。

| 范围 | 仓库实际情况 | 站点必须核对 |
| --- | --- | --- |
| HTTPS 与发布 | app Compose 默认 prod、宿主机 127.0.0.1:8080；环境 Compose 不发布数据库/Redis 端口。仓库没有 TLS 站点/反向代理配置，前端 dist 需单独发布 | 公网/内网 URL、证书链与域名、HTTP→HTTPS、实际 TLS 终止层、前后端同站点及 /api 路由 |
| 刷新 Cookie | 公共配置 secure-cookie=true，dev 显式 false；wuhoucake_refresh 为 Secure、HttpOnly、SameSite=Lax、Path=/api/auth，无 Domain 配置 | 实际 profile/覆盖值、浏览器接收与发送、刷新/退出清除、多个 Set-Cookie 是否完整转发 |
| CSRF Cookie | XSRF-TOKEN 为 Secure、SameSite=Lax、Path=/，刻意允许前端读取；认证 POST 使用 X-XSRF-TOKEN | 代理保留 Cookie 和头，不能把所有 Cookie 一概改为 HttpOnly；认证响应不缓存 |
| 代理协议识别 | 未显式设置 server.forward-headers-strategy，安全链没有显式 HTTPS 重定向；不能仅据代码判断代理后的 HSTS/安全协议识别 | 边缘重定向/HSTS、Forwarded/X-Forwarded-* 的生成与可信边界；取得拓扑后再确定是否需要应用侧设置 |
| SSE | GET /api/orders/stream；text/event-stream、no-store、X-Accel-Buffering:no；ready、15 秒心跳、最长 5 分钟后重连 | 每一层代理/CDN 均实际流式转发、不缓存；不聚合压缩帧；空闲超时长于心跳并留余量；保留 Bearer；断线、过期及撤销后的行为 |
| XLSX/ZIP | 认证 POST，返回正确 MIME、Content-Disposition、Content-Length、no-store、nosniff，完成/中断后删除临时文件；前端严格核对 MIME | 代理不把 API 改成 HTML 错误页，不截断文件，不缓存用户文件；中文文件名、实际保存与内容完整性；生成首字节前的超时及临时空间 |
| 大小与写入重试 | 单图 5 MiB、multipart 请求 6 MiB，XLSX 64 MiB、ZIP 256 MiB；客户端业务写入不自动重试 | WAF/代理上传限制覆盖 6 MiB 请求，响应额度覆盖导出；不得通过代理非幂等重试导致重复业务变化 |
| 运行版本 | Dockerfile 使用 eclipse-temurin:21-jre-alpine，UID 10001；既有复跑使用 JDK 25、目标 Java 21 | 实际镜像 tag/digest、代码 SHA、JDK、启动 profile、实例数；需在真实镜像/运行时补验，当前仅支持单业务实例 |

源码依据：[部署 Compose](../dev-ops/compose/docker-compose-app.yml)、[公共配置](../../WuhouCake-bootstrap/src/main/resources/application.yml)、[安全链](../../WuhouCake-bootstrap/src/main/java/org/xaspire/WuhouCake/bootstrap/security/SecurityConfiguration.java)、[Cookie](../../WuhouCake-identity/src/main/java/org/xaspire/WuhouCake/identity/adapter/web/IdentityController.java)、[SSE 响应](../../WuhouCake-order/src/main/java/org/xaspire/WuhouCake/order/adapter/web/OrderStreamController.java)、[文件响应](../../WuhouCake-order/src/main/java/org/xaspire/WuhouCake/order/adapter/web/OrderFileController.java)、[前端文件校验](../../frontend/src/exportFiles.ts)、[部署镜像](../../WuhouCake-bootstrap/Dockerfile)。

## 配置验证与参考

使用合成环境变量对 app/environment 两组 Compose 执行 `rtk proxy docker compose --env-file docs/dev-ops/env/prod.env.example -f <对应文件> config --format json`，均解析成功。归约核对结果：app 为 prod、127.0.0.1:8080，没有代理服务；数据库/Redis 没有发布宿主机端口。没有启动容器，也未读取实际 prod.env 或输出连接秘密。未重复运行业务测试，上一轮 355 项结果仍归属于其原基线。

通过 Context7 核对官方文档：

- 若实际使用 NGINX，须核对 [HTTP 代理规则](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)：禁缓冲响应头是否被忽略、逐次读取间隔超时、非幂等请求重试及缓存。不能因为应用发出了头就断言全部链路已禁缓冲。
- NGINX 的默认请求体限制为 1m；若未覆盖，会低于本系统图片上传契约，见[官方 core 模块](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)。这只是待核对风险，尚不能记为当前站点 FAIL。
- TLS 终止后的 Forwarded 处理必须结合可信代理拓扑；Spring Boot 可选择 NATIVE/FRAMEWORK，非受支持云环境默认 NONE，见 [Spring Boot 3.5 代理说明](https://docs.spring.io/spring-boot/3.5/how-to/webserver.html#howto.webserver.use-behind-a-proxy-server)。本轮不预设代理产品或直接改变信任设置。

## 还需要的环境信息

先提供前三项即可继续站点只读核对，其余用于认证和真实流式/文件验收：

1. **入口与环境性质**：完整 URL（含子路径）、前后端是否同域；这是隔离验收、试用还是生产站点；是否需 VPN/内网访问。
2. **访问链路**：浏览器→CDN/WAF/LB→代理→应用的实际层次，相关产品/版本，TLS 在哪一层终止；不知道的项直接标未知。
3. **脱敏配置位置**：当前生效的站点/反向代理配置及 CDN/LB 相关规则，可给本地绝对路径。保留 location/路由、转发头、缓存/缓冲/压缩、超时、上传限制、错误页和重试规则；不需要 TLS 私钥、数据库密码或供应商密钥。
4. **实际运行身份**：APP_IMAGE/tag/digest、部署 SHA、JDK、profile、实例数、应用监听地址；是否有额外 Compose override 或配置覆盖。只需这些白名单值，不需要完整环境变量或整份含密钥的进程参数。
5. **合成测试身份**：两个普通员工及一个可管理这些测试员工的管理员，或在隔离环境中用于创建它们的合成管理员。凭证放本机权限 600 的受限文件，只提供文件路径，不在聊天粘贴密码。
6. **测试数据与授权范围**：可使用的合成订单/图片、允许新增合成数据和重置/归档的测试账号、可执行时段。若只有生产站点，先限定为无需登录的证书/跳转等检查，另确认隔离验收环境后再执行写入。

登录会写会话/身份审计；下载接口会追加 ORDER_EXPORTED 活动；制作、备注、图片、重置及归档也会写入。因此后续不能把认证下载或撤销测试称为完全只读，不能默认使用真实员工或真实订单。

## 收到信息后的站点验证

先检查证书/跳转与实际代理配置，再在允许的合成范围内验证：浏览器 Cookie 与登录刷新/退出；两个独立会话观察 ready、心跳和订单事件；关闭/重连、5 分钟换流、管理员撤销与健康流；页面实际下载 XLSX/ZIP、中文文件名、CRC/内容及 no-store；一项接近上传限制的合成图片。结果按真实证据更新 PASS/FAIL/NOT RUN，当前均不得提前标通过。
