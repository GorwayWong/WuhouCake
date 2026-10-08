package org.xaspire.WuhouCake.audit.domain;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.audit.domain.model.aggregate.Operation;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
import static org.junit.jupiter.api.Assertions.*;

class OperationTest {
    @Test void anonymousFailuresCanBeRecorded() {
        assertDoesNotThrow(() -> new Operation(UUID.randomUUID(), Instant.now(), "identity.login", "FAILURE", null, "001", null, null, "request"));
    }
    @Test void rejectsControlCharactersAndUnboundedActions() {
        assertThrows(IllegalArgumentException.class, () -> new Operation(UUID.randomUUID(), Instant.now(), "identity.login", "SUCCESS", null, "001", "name\nforged", null, "request"));
        assertThrows(IllegalArgumentException.class, () -> new Operation(UUID.randomUUID(), Instant.now(), "a".repeat(81), "SUCCESS", null, null, null, null, null));
    }
    @Test void rejectsInvalidQueryRangesAndPagination() {
        var now = Instant.now();
        assertThrows(IllegalArgumentException.class, () -> new Operations.Search(null, null, null, now, now, 1, 20));
        assertThrows(IllegalArgumentException.class, () -> new Operations.Search(null, null, null, null, null, 1, 101));
    }
}
