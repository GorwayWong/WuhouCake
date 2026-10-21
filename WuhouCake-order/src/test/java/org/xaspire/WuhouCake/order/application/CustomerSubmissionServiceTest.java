package org.xaspire.WuhouCake.order.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.api.command.SubmissionCommands;
import org.xaspire.WuhouCake.order.application.service.CustomerSubmissionService;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CustomerSubmissionServiceTest {
    private static final Instant NOW = Instant.parse("2026-11-02T10:00:00Z");
    private final CustomerSubmissions store = mock(CustomerSubmissions.class);
    private final IdentityFacade identity = mock(IdentityFacade.class);
    private final OrderService orders = mock(OrderService.class);
    private final UUID id = UUID.randomUUID(), owner = UUID.randomUUID(), candidate = UUID.randomUUID();
    private final CustomerSubmissionService service = new CustomerSubmissionService(store, identity, orders,
            new JsonCodec(new ObjectMapper().findAndRegisterModules()), Clock.fixed(NOW, ZoneOffset.UTC), "https://example.test", mock(AuditFacade.class));

    @BeforeEach void setup() {
        when(identity.me()).thenReturn(new IdentityFacade.AccountView(owner, "0001", "客服", Set.of("FRONT_DESK"), "STAFF", "ACTIVE", false, 0, NOW, null));
        var content = new CustomerSubmission.Content("13800000000", null, "PICKUP", null, NOW,
                List.of(new CustomerSubmission.Product("蛋糕", "CAKE", 1, Map.of("size", "8"))));
        var submission = new CustomerSubmission(id, UUID.randomUUID(), owner, "客服", 1, "PENDING", content,
                new CustomerSubmission.Review(content, null, 100L, owner, NOW), null, NOW, NOW);
        when(store.find(eq(id), anyBoolean())).thenReturn(submission);
        when(store.duplicates(submission)).thenReturn(List.of(record(0, "WAITING_PRODUCTION")));
    }
    private CustomerSubmissions.Duplicate record(long version, String status) {
        return new CustomerSubmissions.Duplicate("ORDER", candidate, version, status, "001", "13800000000", LocalDate.of(2026, 11, 2), NOW,
                List.of(new CustomerSubmissions.DuplicateItem("蛋糕", 1)), 100L, "客服", NOW, !"CANCELLED".equals(status));
    }
    @Test void allCandidateVersionsAndStatusesContributeToTheAcknowledgement() {
        String original = service.detail(id).duplicateCheckToken();
        assertEquals(original, service.detail(id).duplicateCheckToken());
        var submission = store.find(id, false);
        when(store.duplicates(submission)).thenReturn(List.of(record(1, "WAITING_PRODUCTION")));
        assertNotEquals(original, service.detail(id).duplicateCheckToken());
        assertRejected(new SubmissionCommands.Confirm(1, original, null));
        when(store.duplicates(submission)).thenReturn(List.of(record(1, "CANCELLED")));
        assertRejected(new SubmissionCommands.Confirm(1, original, null));
        when(store.duplicates(submission)).thenReturn(List.of());
        assertRejected(new SubmissionCommands.Confirm(1, original, null));
        verifyNoInteractions(orders);
    }
    @Test void oldSingleIdAndMissingAcknowledgementsCannotCreateAnOrder() {
        assertRejected(new SubmissionCommands.Confirm(1, null, candidate));
        assertRejected(new SubmissionCommands.Confirm(1, null, null));
        verifyNoInteractions(orders);
        verify(store, never()).update(any(), any(), anyString(), any(), any());
    }
    private void assertRejected(SubmissionCommands.Confirm command) {
        assertEquals("DUPLICATE_REVIEW_REQUIRED", assertThrows(OrderFailure.class, () -> service.confirm(id, command)).code());
    }
}
