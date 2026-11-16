FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --chmod=644 target/WuhouCake-bootstrap-*.jar /app/application.jar
RUN mkdir -p /app/image-worker && unzip -j /app/application.jar 'BOOT-INF/lib/WuhouCake-order-*.jar' 'BOOT-INF/lib/thumbnailator-*.jar' -d /app/image-worker
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -T 2 --spider http://127.0.0.1:8080/actuator/health/liveness || exit 1
ENTRYPOINT ["sh", "-ec", "scratch=${APP_TEMP_DIR:-/tmp/wuhoucake-app}; if [ -z \"${APP_TEMP_DIR:-}\" ]; then mkdir -p -m 700 \"$scratch\"; fi; exec java \"-Djava.io.tmpdir=$scratch\" -jar /app/application.jar \"$@\"", "wuhoucake"]
