package org.xaspire.WuhouCake.order.domain;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderDeletion;
import static org.junit.jupiter.api.Assertions.*;

class OrderDeletionTest {
    @Test void retentionExpiresAtExactlyThirtyTimesTwentyFourHours() {
        var at = Instant.parse("2026-10-25T08:00:00Z");
        var deletion = new OrderDeletion(at, UUID.randomUUID(), "前厅店员", " 合成删除 ");
        assertEquals("合成删除", deletion.reason());
        assertEquals(at.plus(Duration.ofDays(30)), deletion.expiresAt());
        assertFalse(deletion.expired(deletion.expiresAt().minusNanos(1)));
        assertTrue(deletion.expired(deletion.expiresAt()));
    }
}
