package org.xaspire.WuhouCake.order.adapter.web;

import java.util.concurrent.RejectedExecutionException;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/orders")
public final class OrderStreamController {
    private final OrderStreams streams;
    public OrderStreamController(OrderStreams streams) { this.streams = streams; }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Accel-Buffering", "no")
                    .body(streams.subscribe(jwt.getExpiresAt()));
        } catch (IllegalArgumentException failure) { return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build(); }
        catch (RejectedExecutionException failure) { return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build(); }
    }
}
