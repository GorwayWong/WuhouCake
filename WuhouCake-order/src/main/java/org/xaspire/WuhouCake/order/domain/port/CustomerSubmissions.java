package org.xaspire.WuhouCake.order.domain.port;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;

public interface CustomerSubmissions {
    record Entry(UUID id, UUID ownerId, String ownerName, String token, boolean enabled) { }
    record Activity(long id, String type, String actorType, UUID actorId, String actorName, Map<String, Object> details, Instant createdAt) { }
    record DuplicateItem(String name, int quantity) { }
    record Duplicate(String kind, UUID id, long version, String status, String orderNo, String phone,
            LocalDate requestedReceiveDate, Instant requestedReceiveAt, List<DuplicateItem> items, Long totalAmountCents,
            String handledBy, Instant createdAt, boolean requiresAcknowledgement) { }
    Entry entryForOwner(UUID ownerId);
    Entry entryByToken(String token);
    Entry lockEntry(String token);
    Entry saveEntry(UUID ownerId, String ownerName, String token, boolean enabled);
    CustomerSubmission submit(Entry entry, UUID requestId, String fingerprint, CustomerSubmission.Content content, Instant now);
    CustomerSubmission find(UUID id, boolean lock);
    CustomerSubmission findByOrder(UUID orderId);
    List<CustomerSubmission> search(UUID ownerId, String status, int limit, long offset);
    long count(UUID ownerId, String status);
    List<Duplicate> duplicates(CustomerSubmission submission);
    void update(CustomerSubmission submission, CustomerSubmission.Review review, String status, UUID orderId, Instant now);
    void append(UUID submissionId, String type, UUID actorId, String actorName, Map<String, Object> details, Instant now);
    List<Activity> activities(UUID submissionId);
    void markOrder(UUID orderId, CustomerSubmission submission);
}
