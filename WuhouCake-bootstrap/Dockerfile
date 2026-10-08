FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY target/WuhouCake-bootstrap-*.jar /app/application.jar
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/actuator/health/liveness || exit 1
ENTRYPOINT ["java", "-jar", "/app/application.jar"]
