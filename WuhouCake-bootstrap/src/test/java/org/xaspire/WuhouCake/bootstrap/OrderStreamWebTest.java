package org.xaspire.WuhouCake.bootstrap;

import java.time.*;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.xaspire.WuhouCake.bootstrap.configuration.*;
import org.xaspire.WuhouCake.bootstrap.security.*;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;
import org.xaspire.WuhouCake.order.adapter.web.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.order.application.service.OrderImageService;
import org.xaspire.WuhouCake.order.application.service.OrderExportService;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(OrderStreamController.class)
@Import({SecurityConfiguration.class, OrderWebComposition.class, OrderStreamWebTest.Beans.class})
class OrderStreamWebTest {
    @TestConfiguration(proxyBeanMethods = false) @EnableConfigurationProperties(IdentityProperties.class)
    static class Beans {
        @Bean Clock clock() { return Clock.systemUTC(); }
        @Bean SecurityErrors securityErrors(ObjectMapper json) { return new SecurityErrors(json); }
    }
    @Autowired MockMvc mvc;
    @Autowired OrderStreams streams;
    @Autowired ObjectMapper json;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean IdentityFacade identity;
    @MockitoBean OrderService orders;
    @MockitoBean org.xaspire.WuhouCake.order.application.service.OrderCreationService creations;
    @MockitoBean OrderQueryService queries;
    @MockitoBean org.xaspire.WuhouCake.order.application.service.OrderPackageService packages;
    @MockitoBean OrderImageService images;
    @MockitoBean OrderExportService exports;
    @MockitoBean org.xaspire.WuhouCake.order.application.service.OrderManagementService management;
    private final UUID accountId = UUID.randomUUID(), sessionId = UUID.randomUUID();

    @BeforeEach void token() {
        var now = Instant.now();
        when(decoder.decode("valid")).thenReturn(Jwt.withTokenValue("valid").header("alg", "RS256").subject(accountId.toString())
                .claim("sid", sessionId.toString()).claim("ver", 0L).issuedAt(now).expiresAt(now.plusSeconds(60)).build());
        when(identity.authenticate(accountId, sessionId, 0)).thenReturn(account(false));
    }
    private IdentityFacade.AccountView account(boolean passwordChangeRequired) {
        return new IdentityFacade.AccountView(accountId, "0002", "员工", Set.of("FRONT_DESK"), "STAFF", "ACTIVE", passwordChangeRequired, 0, Instant.now(), null, 0,
                passwordChangeRequired ? EmployeeAccess.none() : EmployeeAccess.of(Set.of(ORDER_READ, ORDER_FULFILLMENT_UPDATE, ORDER_CANCEL)));
    }
    @Test void anonymousAndInvalidBearerAreRejectedByExistingSecurityChain() throws Exception {
        mvc.perform(get("/api/orders/stream")).andExpect(status().isUnauthorized());
        when(decoder.decode("invalid")).thenThrow(new BadJwtException("invalid"));
        mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer invalid")).andExpect(status().isUnauthorized());
        when(identity.authenticate(accountId, sessionId, 0)).thenReturn(account(true));
        mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid")).andExpect(status().isForbidden());
    }
    @Test void authenticatedStreamUsesSseAndOnlyExposesChangeIdentity() throws Exception {
        var result = mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid").accept("text/event-stream"))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andExpect(content().contentTypeCompatibleWith("text/event-stream"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn();
        assertTrue(result.getResponse().getContentAsString().contains("event:ready\n"));
        var event = new OrderChanged(UUID.randomUUID(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 5, "0000001");
        String frame = "data:" + json.writeValueAsString(event) + "\n\n";
        streams.changed(event);
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (!result.getResponse().getContentAsString().contains(frame) && System.nanoTime() < deadline) Thread.sleep(10);
        String content = result.getResponse().getContentAsString();
        assertTrue(content.contains("event:order.changed\n") && content.contains(frame), content);
        var payload = json.readTree(content.substring(content.lastIndexOf("data:") + 5).strip());
        assertEquals(Set.of("orderId", "itemId", "changeType", "version", "orderNo"), json.convertValue(payload, Map.class).keySet());
        assertEquals("0000001", payload.path("orderNo").asText());
        assertEquals(event.orderId().toString(), payload.path("orderId").asText()); assertTrue(payload.path("itemId").isNull());
        assertEquals("ORDER_PRODUCTION_CHANGED", payload.path("changeType").asText()); assertEquals(5, payload.path("version").asLong());
        result.getRequest().getAsyncContext().complete();
    }
    @Test void jwtDeadlineCompletesTheStreamAndAsyncDispatchRemainsAuthorized() throws Exception {
        var now = Instant.now();
        when(decoder.decode("valid")).thenReturn(Jwt.withTokenValue("valid").header("alg", "RS256").subject(accountId.toString())
                .claim("sid", sessionId.toString()).claim("ver", 0L).issuedAt(now).expiresAt(now.plusMillis(300)).build());
        var result = mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid"))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();
        assertNull(result.getAsyncResult(2000));
        mvc.perform(asyncDispatch(result)).andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("text/event-stream"));
    }
    @Test void tokenExpiredAtSubscriptionCannotOpenAStream() throws Exception {
        var now = Instant.now();
        when(decoder.decode("valid")).thenReturn(Jwt.withTokenValue("valid").header("alg", "RS256").subject(accountId.toString())
                .claim("sid", sessionId.toString()).claim("ver", 0L).issuedAt(now.minusSeconds(60)).expiresAt(now.minusSeconds(1)).build());
        mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid")).andExpect(status().isUnauthorized()).andExpect(request().asyncNotStarted());
    }
    @Test void sessionRevokedAfterTheSecurityFilterCannotOpenAStream() throws Exception {
        when(identity.authenticate(accountId, sessionId, 0)).thenReturn(account(false)).thenThrow(new IllegalStateException("revoked session"));
        mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid"))
                .andExpect(status().isUnauthorized()).andExpect(request().asyncNotStarted());
    }
    @Test void statusEndpointsAuthenticateValidateAndUseServerOperator() throws Exception {
        var id = UUID.randomUUID(); String fulfillment = "/api/orders/" + id + "/fulfillment-actions", cancel = "/api/orders/" + id + "/cancel";
        mvc.perform(post(fulfillment).contentType("application/json").content("{\"expectedVersion\":5,\"action\":\"START_DELIVERY\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post(cancel).contentType("application/json").content("{\"expectedVersion\":5,\"reason\":\"取消\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post(fulfillment).header("Authorization", "Bearer valid").contentType("application/json")
                .content("{\"expectedVersion\":5,\"action\":\"START_DELIVERY\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        mvc.perform(post(cancel).header("Authorization", "Bearer valid").contentType("application/json")
                .content("{\"expectedVersion\":5,\"reason\":\"取消\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        var operator = new OrderCommands.Operator(accountId, "员工");
        verify(orders).fulfillmentAction(eq(id), eq(new OrderCommands.FulfillmentAction(5, "START_DELIVERY")), eq(operator));
        verify(orders).cancel(eq(id), eq(new OrderCommands.Cancel(5, "取消")), eq(operator));
        for (var body : List.of("{\"expectedVersion\":5}", "{\"expectedVersion\":5,\"reason\":\" \"}", "{\"reason\":\"取消\"}"))
            mvc.perform(post(cancel).header("Authorization", "Bearer valid").contentType("application/json").content(body)).andExpect(status().isBadRequest());
        mvc.perform(post(fulfillment).header("Authorization", "Bearer valid").contentType("application/json")
                .content("{\"expectedVersion\":5,\"action\":\" \"}")).andExpect(status().isBadRequest());
        verifyNoMoreInteractions(orders);
    }
    @Test void newBusinessFailuresUseExistingErrorEnvelopeAndHttpStatus() throws Exception {
        var id = UUID.randomUUID(); String fulfillment = "/api/orders/" + id + "/fulfillment-actions", cancel = "/api/orders/" + id + "/cancel";
        for (var code : List.of("INVALID_FULFILLMENT_TRANSITION", "CONCURRENT_MODIFICATION", "ORDER_NOT_FOUND", "VALIDATION_FAILED")) {
            doThrow(new OrderFailure(code)).when(orders).fulfillmentAction(eq(id), any(), any());
            int status = code.equals("ORDER_NOT_FOUND") ? 404 : code.equals("VALIDATION_FAILED") ? 400 : 409;
            mvc.perform(post(fulfillment).header("Authorization", "Bearer valid").contentType("application/json")
                    .content("{\"expectedVersion\":5,\"action\":\"START_DELIVERY\"}"))
                    .andExpect(status().is(status)).andExpect(jsonPath("$.code").value(code));
        }
        doThrow(new OrderFailure("ORDER_NOT_CANCELLABLE")).when(orders).cancel(eq(id), any(), any());
        mvc.perform(post(cancel).header("Authorization", "Bearer valid").contentType("application/json").content("{\"expectedVersion\":5,\"reason\":\"取消\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ORDER_NOT_CANCELLABLE"));
    }

    @Test void operationPermissionsRejectWritesExportsAndSensitiveReadsBeforeCallingServices() throws Exception {
        withPermissions(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE));
        String id = UUID.randomUUID().toString(), item = UUID.randomUUID().toString();
        for (var route : List.of(
                "POST /api/orders", "PATCH /api/orders/" + id, "PATCH /api/orders/" + id + "/information",
                "PATCH /api/orders/" + id + "/payment-status", "POST /api/orders/" + id + "/cancel",
                "POST /api/orders/" + id + "/fulfillment-actions", "POST /api/orders/" + id + "/notes",
                "POST /api/orders/" + id + "/items", "POST /api/orders/" + id + "/items/" + item + "/remove",
                "POST /api/orders/" + id + "/images", "DELETE /api/orders/" + id + "/images/" + item,
                "POST /api/orders/" + id + "/exports/xlsx", "POST /api/orders/exports/zip",
                "POST /api/orders/recognition/parse", "POST /api/orders/recognition/assist",
                "GET /api/orders/" + id + "/activities", "GET /api/orders/" + id + "/customer-origin",
                "GET /api/admin/orders", "GET /api/admin/orders/export", "GET /api/admin/employees",
                "GET /api/admin/audit-logs", "GET /api/customer-submissions", "GET /api/customer-submissions/entry",
                "POST /api/orders/" + id + "/future-operation")) {
            String[] parts = route.split(" ", 2);
            mvc.perform(request(org.springframework.http.HttpMethod.valueOf(parts[0]), parts[1])
                    .header("Authorization", "Bearer valid").contentType("application/json").content("{}"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        }
        verifyNoInteractions(orders, creations, images, exports, management, queries);
    }

    @Test void detailAndProductionResponsesRedactStructuredCustomerAndFinancialData() throws Exception {
        withPermissions(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE));
        var detail = sensitiveOrder();
        when(orders.detail(detail.orderId())).thenReturn(detail);
        when(orders.productionAction(eq(detail.orderId()), any(), any())).thenReturn(detail);
        for (var request : List.of(get("/api/orders/" + detail.orderId()),
                post("/api/orders/" + detail.orderId() + "/production-actions").contentType("application/json")
                        .content("{\"expectedVersion\":0,\"action\":\"CONFIRM_LAYER\"}"))) {
            mvc.perform(request.header("Authorization", "Bearer valid"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.orderNo").value("TEST001"))
                    .andExpect(jsonPath("$.data.customer").isEmpty()).andExpect(jsonPath("$.data.fulfillment.address").isEmpty())
                    .andExpect(jsonPath("$.data.totalAmountCents").isEmpty()).andExpect(jsonPath("$.data.paymentStatus").isEmpty())
                    .andExpect(jsonPath("$.data.items[0].unitPriceCents").isEmpty()).andExpect(jsonPath("$.data.items[0].memberPriceCents").isEmpty())
                    .andExpect(jsonPath("$.data.items[0].attributes.base").value("原味"));
        }
        withPermissions(Set.of(ORDER_READ, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ));
        mvc.perform(get("/api/orders/" + detail.orderId()).header("Authorization", "Bearer valid"))
                .andExpect(jsonPath("$.data.customer.phone").value("13900000000"))
                .andExpect(jsonPath("$.data.totalAmountCents").value(20000));
        assertNotNull(detail.customer());
        assertEquals(20000L, detail.totalAmountCents());
    }

    @Test void calendarAndWorkbenchUseTheSameDataPermissions() throws Exception {
        withPermissions(Set.of(ORDER_READ));
        var detail = sensitiveOrder(); var date = LocalDate.of(2026, 10, 22);
        when(queries.calendar(null, null)).thenReturn(List.of(new OrderQueryViews.CalendarOrder(detail.orderId(), "TEST001", date,
                "CREATED", "WAITING", "PAID", "DELIVERY", Instant.now(), List.of())));
        var item = new OrderQueryViews.Item(UUID.randomUUID(), "蛋糕", "CAKE", 1, 20000L, 18000L, Map.of("base", "原味"), List.of());
        when(queries.workbench(null, true)).thenReturn(new OrderQueryViews.Workbench(date, new OrderQueryViews.Metrics(1, 1, 1),
                List.of(new OrderQueryViews.PendingOrder(detail.orderId(), "TEST001", date, "CREATED", "WAITING", "PAID", "DELIVERY",
                        Instant.now(), detail.customer(), "客户地址", Instant.now(), List.of(item)))));
        mvc.perform(get("/api/orders/calendar").header("Authorization", "Bearer valid"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].paymentStatus").isEmpty());
        mvc.perform(get("/api/orders/workbench").header("Authorization", "Bearer valid"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.pendingOrders[0].customer").isEmpty())
                .andExpect(jsonPath("$.data.pendingOrders[0].address").isEmpty())
                .andExpect(jsonPath("$.data.pendingOrders[0].items[0].unitPriceCents").isEmpty())
                .andExpect(jsonPath("$.data.pendingOrders[0].items[0].memberPriceCents").isEmpty());
    }

    @Test void sensitiveEndpointsRequireDataGrantsEvenWhenTheOperationGrantExists() throws Exception {
        withPermissions(Set.of(ORDER_READ, ORDER_EXPORT, ORDER_MANAGEMENT_READ, ORDER_ACTIVITY_READ));
        for (var path : List.of("/api/admin/orders", "/api/admin/orders/export", "/api/orders/" + UUID.randomUUID() + "/activities")) {
            mvc.perform(get(path).header("Authorization", "Bearer valid")).andExpect(status().isForbidden());
        }
        mvc.perform(post("/api/orders/exports/zip").header("Authorization", "Bearer valid").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(orders, exports, management);
    }

    @Test void revokingReadPermissionClosesExistingStreamsAndRejectsFurtherRequests() throws Exception {
        var result = mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid"))
                .andExpect(request().asyncStarted()).andReturn();
        withPermissions(Set.of());
        streams.changed(new OrderChanged(UUID.randomUUID(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 1, "TEST001"));
        assertNull(result.getAsyncResult(3000));
        assertFalse(result.getResponse().getContentAsString().contains("event:order.changed"));
        mvc.perform(get("/api/orders/stream").header("Authorization", "Bearer valid")).andExpect(status().isForbidden());
    }

    private void withPermissions(Set<EmployeeAccess.Permission> permissions) {
        when(identity.authenticate(accountId, sessionId, 0)).thenReturn(new IdentityFacade.AccountView(accountId, "0002", "制作员工",
                Set.of("PASTRY_CHEF"), "STAFF", "ACTIVE", false, 0, Instant.now(), null, 0, EmployeeAccess.of(permissions)));
    }

    private OrderViews.Detail sensitiveOrder() {
        var now = Instant.now(); var id = UUID.randomUUID();
        var item = new OrderViews.Item(UUID.randomUUID(), "蛋糕", "CAKE", 1, 20000L, 18000L, Map.of("base", "原味"),
                "WAITING", "WAITING", now, now, List.of());
        return new OrderViews.Detail(id, "TEST001", 0, "CREATED", "PAID", "WAITING",
                new OrderCommands.Customer("客户", "13900000000", "13800000000", "购买人"),
                new OrderCommands.Fulfillment("DELIVERY", "客户地址", LocalDate.of(2026, 10, 22), now, now),
                20000L, accountId, now, now, now, List.of(item), null);
    }
}
