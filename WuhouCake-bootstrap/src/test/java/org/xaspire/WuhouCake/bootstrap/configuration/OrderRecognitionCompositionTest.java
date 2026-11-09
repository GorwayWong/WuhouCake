package org.xaspire.WuhouCake.bootstrap.configuration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.xaspire.WuhouCake.order.adapter.web.OrderRecognitionController;
import org.xaspire.WuhouCake.order.application.service.OrderRecognitionService;
import static org.junit.jupiter.api.Assertions.*;

class OrderRecognitionCompositionTest {
    @Test void rulesUseTheConfiguredClockAndRemainAvailableWithoutModelAssistance() {
        new WebApplicationContextRunner().withUserConfiguration(OrderRecognitionComposition.class)
                .withBean(ObjectMapper.class, ObjectMapper::new)
                .withBean(Clock.class, () -> Clock.fixed(Instant.parse("2026-11-08T16:30:00Z"), ZoneOffset.UTC))
                .withPropertyValues("wuhoucake.order-recognition.assist.enabled=false")
                .run(context -> {
                    assertNull(context.getStartupFailure());
                    assertNotNull(context.getBean(OrderRecognitionController.class));
                    var result = context.getBean(OrderRecognitionService.class).parse("收货时间：11月8号下午17:00");
                    assertEquals("2027-11-08T17:00", result.fields().get("requestedReceiveAt").value());
                    assertTrue(result.fields().get("requestedReceiveAt").needsReview());
                    assertFalse(result.assistAvailable());
                });
    }
}
