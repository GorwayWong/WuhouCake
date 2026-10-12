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
import org.xaspire.WuhouCake.order.adapter.web.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.application.service.OrderService;

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
    private final UUID accountId = UUID.randomUUID(), sessionId = UUID.randomUUID();

    @BeforeEach void token() {
        var now = Instant.now();
        when(decoder.decode("valid")).thenReturn(Jwt.withTokenValue("valid").header("alg", "RS256").subject(accountId.toString())
                .claim("sid", sessionId.toString()).claim("ver", 0L).issuedAt(now).expiresAt(now.plusSeconds(60)).build());
        when(identity.authenticate(accountId, sessionId, 0)).thenReturn(account(false));
    }
    private IdentityFacade.AccountView account(boolean passwordChangeRequired) {
        return new IdentityFacade.AccountView(accountId, "0002", "员工", Set.of("FRONT_DESK"), "STAFF", "ACTIVE", passwordChangeRequired, 0, Instant.now(), null);
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
        var event = new OrderChanged(UUID.randomUUID(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 5);
        String frame = "data:" + json.writeValueAsString(event) + "\n\n";
        streams.changed(event);
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (!result.getResponse().getContentAsString().contains(frame) && System.nanoTime() < deadline) Thread.sleep(10);
        String content = result.getResponse().getContentAsString();
        assertTrue(content.contains("event:order.changed\n") && content.contains(frame), content);
        var payload = json.readTree(content.substring(content.lastIndexOf("data:") + 5).strip());
        assertEquals(Set.of("orderId", "itemId", "changeType", "version"), json.convertValue(payload, Map.class).keySet());
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
}
