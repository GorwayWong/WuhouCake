package org.xaspire.WuhouCake.bootstrap;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.xaspire.WuhouCake.bootstrap.integration.ProbeMapper;
import org.xaspire.WuhouCake.bootstrap.integration.ProbeRecord;
import org.xaspire.WuhouCake.bootstrap.integration.TestPersistenceConfiguration;
import org.xaspire.WuhouCake.shared.infrastructure.redis.RedisLock;
import org.xaspire.WuhouCake.shared.infrastructure.redis.RedisStrings;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.locations=classpath:db/integration-migration",
        "spring.flyway.default-schema=integration_probe",
        "spring.flyway.schemas=integration_probe",
        "spring.flyway.table=integration_flyway_schema_history"
})
@ActiveProfiles("integration")
@Import(TestPersistenceConfiguration.class)
class InfrastructureIT {
    @Autowired TestRestTemplate http;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;
    @Autowired ProbeMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;
    @Autowired Flyway flyway;
    @Autowired StringRedisTemplate redis;
    @Autowired RedisStrings strings;
    @Autowired RedisLock locks;
    @Autowired JsonCodec json;

    @Test
    void bootstrapStartsWithTechnicalMigrationAndNoSampleRoutes() {
        var health = http.getForEntity("/actuator/health", Map.class);
        assertEquals(HttpStatus.OK, health.getStatusCode());
        assertEquals("UP", health.getBody().get("status"));
        assertNotNull(flyway.info().current());
        assertEquals(1, jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'integration_probe' "
                        + "AND table_name = 'integration_flyway_schema_history'", Integer.class));
        assertTrue(mappings.getHandlerMethods().keySet().stream()
                .flatMap(mapping -> mapping.getPatternValues().stream())
                .noneMatch(path -> path.startsWith("/api/samples")));
    }

    @Test
    void mybatisPlusUsesPostgresWithinTheTransaction() {
        transactions.executeWithoutResult(status -> {
            jdbc.execute("CREATE TEMP TABLE scaffold_probe (id BIGINT PRIMARY KEY, note VARCHAR(120)) ON COMMIT DROP");
            mapper.insert(new ProbeRecord(1L, "mybatis-plus"));
            assertEquals("mybatis-plus", mapper.selectById(1L).getNote());
        });
    }

    @Test
    void databaseSavepointRollsBackMybatisChanges() {
        TransactionTemplate nested = new TransactionTemplate(transactions.getTransactionManager());
        nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
        transactions.executeWithoutResult(status -> {
            jdbc.execute("CREATE TEMP TABLE scaffold_probe (id BIGINT PRIMARY KEY, note VARCHAR(120)) ON COMMIT DROP");
            assertThrows(IllegalStateException.class, () -> nested.executeWithoutResult(inner -> {
                mapper.insert(new ProbeRecord(2L, "rollback"));
                throw new IllegalStateException("rollback");
            }));
            assertEquals(0L, mapper.selectCount(null));
        });
    }

    @Test
    void redisLeaseCanOnlyBeReleasedByItsOwner() {
        String key = "wuhoucake:integration:lock:" + UUID.randomUUID();
        try {
            assertTrue(locks.tryAcquire(key, "owner", Duration.ofSeconds(30)));
            assertFalse(locks.tryAcquire(key, "other", Duration.ofSeconds(30)));
            assertFalse(locks.release(key, "other"));
            assertTrue(locks.release(key, "owner"));
            assertTrue(locks.tryAcquire(key, "new-owner", Duration.ofSeconds(30)));
            assertFalse(locks.release(key, "owner"));
            assertTrue(locks.release(key, "new-owner"));
        } finally {
            redis.delete(key);
        }
    }

    @Test
    void redisStringsHaveTtlAndJsonRoundTrips() {
        String key = "wuhoucake:integration:json:" + UUID.randomUUID();
        try {
            strings.put(key, json.write(Map.of("answer", 42)), Duration.ofSeconds(30));
            assertEquals(42, json.read(strings.get(key).orElseThrow(), Map.class).get("answer"));
            assertTrue(redis.getExpire(key) > 0);
            assertTrue(strings.delete(key));
            assertTrue(strings.get(key).isEmpty());
        } finally {
            redis.delete(key);
        }
    }
}
