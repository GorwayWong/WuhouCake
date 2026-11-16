FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --chmod=644 target/WuhouCake-bootstrap-*.jar /app/application.jar
RUN mkdir -p /app/image-worker && unzip -j /app/application.jar 'BOOT-INF/lib/WuhouCake-order-*.jar' 'BOOT-INF/lib/thumbnailator-*.jar' -d /app/image-worker
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -T 2 --spider http://127.0.0.1:8080/actuator/health/liveness || exit 1
ENTRYPOINT ["sh", "-ec", "rm -rf /tmp/wuhoucake-app && mkdir -m 700 /tmp/wuhoucake-app && exec java -Djava.io.tmpdir=/tmp/wuhoucake-app -jar /app/application.jar \"$@\"", "wuhoucake"]
