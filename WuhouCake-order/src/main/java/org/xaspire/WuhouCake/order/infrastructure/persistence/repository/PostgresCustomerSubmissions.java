package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.CustomerSubmissionMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresCustomerSubmissions implements CustomerSubmissions {
    private final CustomerSubmissionMapper mapper; private final JsonCodec json;
    public PostgresCustomerSubmissions(CustomerSubmissionMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }
    @Override public Entry entryForOwner(UUID ownerId) { return entry(mapper.entryForOwner(ownerId.toString())); }
    @Override public Entry entryByToken(String token) { return entry(mapper.entryByToken(token)); }
    @Override public Entry lockEntry(String token) { return entry(mapper.lockEntry(token)); }
    @Override public Entry saveEntry(UUID ownerId, String ownerName, String token, boolean enabled) {
        mapper.saveEntry(new CustomerSubmissionMapper.EntryRow(UUID.randomUUID().toString(), ownerId.toString(), ownerName, token, enabled));
        return entryForOwner(ownerId);
    }
    @Override public CustomerSubmission submit(Entry entry, UUID requestId, String fingerprint, CustomerSubmission.Content content, Instant now) {
        var id = UUID.randomUUID();
        boolean inserted = mapper.insert(id.toString(), entry.id().toString(), entry.ownerId().toString(), entry.ownerName(), requestId.toString(),
                fingerprint, json.write(content), content.phone(), content.requestedDate(), now) == 1;
        var claim = mapper.claim(entry.id().toString(), requestId.toString());
        if (!claim.fingerprint().equals(fingerprint)) throw new OrderFailure("IDEMPOTENCY_KEY_CONFLICT");
        if (inserted) append(id, "SUBMITTED", null, "客户（手机号未验证）", Map.of("source", "CUSTOMER_SUBMITTED", "after", CustomerSubmission.customerFields(content)), now);
        return find(UUID.fromString(claim.id()), false);
    }
    @Override public CustomerSubmission find(UUID id, boolean lock) { return submission(lock ? mapper.lock(id.toString()) : mapper.find(id.toString())); }
    @Override public CustomerSubmission findByOrder(UUID id) { return submission(mapper.byOrder(id.toString())); }
    @Override public List<CustomerSubmission> search(UUID owner, String status, int limit, long offset) {
        return mapper.search(string(owner), status, limit, offset).stream().map(this::submission).toList();
    }
    @Override public long count(UUID owner, String status) { return mapper.count(string(owner), status); }
    @Override public List<Duplicate> duplicates(CustomerSubmission submission) {
        var content = submission.reviewed() == null ? submission.original() : submission.reviewed().content();
        return mapper.duplicates(submission.id().toString(), content.phone().replaceAll("[ ()-]", ""), content.requestedDate()).stream()
                .map(row -> new Duplicate(row.kind(), uuid(row.id()), row.version(), row.status(), row.orderNo(), row.phone(),
                        row.requestedReceiveDate(), row.requestedReceiveAt(), List.of(json.read(row.items(), DuplicateItem[].class)),
                        row.totalAmountCents(), row.handledBy(), row.createdAt(), !"CANCELLED".equals(row.status()))).toList();
    }
    @Override public void update(CustomerSubmission submission, CustomerSubmission.Review review, String status, UUID orderId, Instant now) {
        if (mapper.update(submission.id().toString(), submission.version(), review == null ? null : json.write(review), status, string(orderId), now) != 1)
            throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    @Override public void append(UUID id, String type, UUID actorId, String actorName, Map<String, Object> details, Instant now) {
        mapper.append(id.toString(), type, actorId == null ? "CUSTOMER" : "EMPLOYEE", string(actorId), actorName, json.write(details), now);
    }
    @Override public List<Activity> activities(UUID id) {
        return mapper.activities(id.toString()).stream().map(row -> new Activity(row.id(), row.type(), row.actorType(), uuid(row.actorId()), row.actorName(),
                object(row.details()), row.createdAt())).toList();
    }
    @Override public void markOrder(UUID orderId, CustomerSubmission submission) { mapper.markOrder(orderId.toString(), submission.id().toString()); }
    @SuppressWarnings("unchecked") private Map<String, Object> object(String value) { return json.read(value, Map.class); }
    private CustomerSubmission submission(CustomerSubmissionMapper.Row row) {
        return row == null ? null : new CustomerSubmission(uuid(row.id()), uuid(row.entryId()), uuid(row.ownerId()), row.ownerName(), row.version(), row.status(),
                json.read(row.original(), CustomerSubmission.Content.class), row.reviewed() == null ? null : json.read(row.reviewed(), CustomerSubmission.Review.class),
                uuid(row.orderId()), row.createdAt(), row.updatedAt());
    }
    private static Entry entry(CustomerSubmissionMapper.EntryRow row) { return row == null ? null : new Entry(uuid(row.id()), uuid(row.ownerId()), row.ownerName(), row.token(), row.enabled()); }
    private static String string(UUID id) { return id == null ? null : id.toString(); }
    private static UUID uuid(String value) { return value == null ? null : UUID.fromString(value); }
}
