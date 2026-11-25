package org.xaspire.WuhouCake.order.application.service;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;
import org.springframework.transaction.annotation.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.domain.port.OrderCreations;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public class OrderCreationService {
    private final OrderService orders;
    private final OrderCreations creations;
    private final JsonCodec json;
    private final CustomerSubmissions submissions;
    private final IdentityFacade identity;
    private final SecretKeySpec reviewKey;

    public OrderCreationService(OrderService orders, OrderCreations creations, JsonCodec json,
            CustomerSubmissions submissions, IdentityFacade identity) {
        this.orders = orders;
        this.creations = creations;
        this.json = json;
        this.submissions = submissions;
        this.identity = identity;
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        this.reviewKey = new SecretKeySpec(key, "HmacSHA256");
    }

    public record DuplicateReview(int count, List<String> orderNos, String token) { }

    public static final class DuplicateReviewRequired extends RuntimeException {
        private final DuplicateReview review;

        private DuplicateReviewRequired(DuplicateReview review) { this.review = review; }
        public DuplicateReview review() { return review; }
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UUID create(OrderCommands.Create command, OrderCommands.Operator operator, UUID requestId, String reviewToken) {
        String requestFingerprint = fingerprint(command, json);
        if (requestId != null) {
            var existing = creations.claim(operator.accountId(), requestId, requestFingerprint);
            if (existing.isPresent()) return existing.get();
        }
        var created = orders.createManual(command, operator, group -> {
            var access = identity.lockCurrentEmployee().access();
            if (access.allows(ORDER_READ) && (access.allows(ORDER_PHONE_READ) || access.allows(ORDER_CUSTOMER_READ)))
                return requireDuplicateReview(group, operator.accountId(), requestId, requestFingerprint, reviewToken);
            return List.of();
        });
        if (requestId != null) creations.complete(operator.accountId(), requestId, created.orderId());
        return created.orderId();
    }

    private List<String> requireDuplicateReview(DuplicateGroup group, UUID actor, UUID requestId, String fingerprint, String token) {
        var candidates = submissions.activeOrders(group);
        if (candidates.isEmpty()) return List.of();
        var ids = candidates.stream().map(OrderCandidate::id).sorted().toList();
        String context = actor + ":" + requestId + ":" + fingerprint + ":";
        // The token proves which candidates were reviewed without exposing their IDs.
        var evidence = ids.size() <= 64 ? ids.stream().map(id -> sign("candidate:" + context, id).substring(0, 32)).toList() : List.<String>of();
        String current = evidence.isEmpty() ? "#" + fingerprint(Map.of("ids", ids), json) : String.join(",", evidence);
        if (token != null && token.length() <= 2500) {
            int separator = token.indexOf('.');
            if (separator > 0) {
                String reviewed = token.substring(0, separator);
                String signature = token.substring(separator + 1);
                if (MessageDigest.isEqual(sign(context, reviewed).getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII))
                        && (reviewed.equals(current) || !reviewed.startsWith("#")
                                && !evidence.isEmpty() && Set.of(reviewed.split(",")).containsAll(evidence))) return ids;
            }
        }
        throw new DuplicateReviewRequired(new DuplicateReview(ids.size(), candidates.stream().limit(3).map(OrderCandidate::orderNo).toList(),
                current + "." + sign(context, current)));
    }

    private String sign(String context, String candidates) {
        try {
            var mac = Mac.getInstance(reviewKey.getAlgorithm());
            mac.init(reviewKey);
            return HexFormat.of().formatHex(mac.doFinal((context + candidates).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) { throw new IllegalStateException(failure); }
    }

    static String fingerprint(Object command, JsonCodec json) {
        String canonical = json.write(canonical(json.read(json.write(command), Map.class)));
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
    }
    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?> map) {
            var sorted = new TreeMap<String, Object>();
            map.forEach((key, entry) -> sorted.put((String) key, canonical(entry))); return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(OrderCreationService::canonical).toList();
        if (value instanceof Number number) return new BigDecimal(number.toString()).stripTrailingZeros();
        return value;
    }
}
