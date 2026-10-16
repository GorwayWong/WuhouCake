package org.xaspire.WuhouCake.order.adapter.web;

import java.util.concurrent.RejectedExecutionException;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;

@RestController
@RequestMapping("/api/orders")
public final class OrderStreamController {
    private final OrderStreams streams;
    private final IdentityFacade identity;
    public OrderStreamController(OrderStreams streams, IdentityFacade identity) { this.streams = streams; this.identity = identity; }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        try {
            if (jwt.getSubject() == null || jwt.getClaimAsString("sid") == null || !(jwt.getClaim("ver") instanceof Number version))
                throw new IllegalArgumentException("Missing session claims");
            var accountId = UUID.fromString(jwt.getSubject()); var sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Accel-Buffering", "no")
                    .body(streams.subscribe(accountId, version.longValue(), jwt.getExpiresAt(),
                            () -> !identity.authenticate(accountId, sessionId, version.longValue()).passwordChangeRequired()));
        } catch (IllegalArgumentException failure) { return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build(); }
        catch (RejectedExecutionException failure) { return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build(); }
    }
}
