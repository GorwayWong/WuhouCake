#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ ! -f docs/dev-ops/env/dev.env ]]; then
  echo '缺少 docs/dev-ops/env/dev.env，请先按 macos-local-workflow.md 完成首次配置。' >&2
  exit 1
fi
set -a
source docs/dev-ops/env/dev.env
set +a

# 构建和运行使用同一 JDK，不依赖 Conda 或终端 PATH 中的 java。
JAVA_HOME="$(/usr/libexec/java_home -F -v 21)" || {
  echo '未找到 JDK 21，请安装后重试。' >&2
  exit 1
}
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
export IDENTITY_PRIVATE_KEY="${IDENTITY_PRIVATE_KEY:-$PWD/secrets/identity/private.pem}"
export IDENTITY_PUBLIC_KEY="${IDENTITY_PUBLIC_KEY:-$PWD/secrets/identity/public.pem}"
export CUSTOMER_ENTRY_PUBLIC_ORIGIN="${CUSTOMER_ENTRY_PUBLIC_ORIGIN:-auto}"

"$JAVA_HOME/bin/java" -version
docker compose --env-file docs/dev-ops/env/dev.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml \
  -f docs/dev-ops/compose/docker-compose-environment-dev.yml up -d --wait

./mvnw -pl WuhouCake-bootstrap -am -DskipTests package
exec "$JAVA_HOME/bin/java" -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar --spring.profiles.active=dev
