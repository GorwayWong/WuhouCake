package org.xaspire.WuhouCake.order.application.service;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import org.xaspire.WuhouCake.order.api.command.*;
import org.xaspire.WuhouCake.order.api.dto.SubmissionViews;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import org.xaspire.WuhouCake.shared.response.Page;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;

public class CustomerSubmissionService {
    private final CustomerSubmissions submissions; private final IdentityFacade identity; private final OrderService orders;
    private final JsonCodec json; private final Clock clock; private final String publicOrigin;
    private final AuditFacade audit;
    public CustomerSubmissionService(CustomerSubmissions submissions, IdentityFacade identity, OrderService orders, JsonCodec json, Clock clock, String publicOrigin, AuditFacade audit) {
        this.submissions = submissions; this.identity = identity; this.orders = orders; this.json = json; this.clock = clock;
        this.audit = audit;
        this.publicOrigin = publicOrigin.replaceAll("/+$", "");
    }
    @Transactional(readOnly = true) public SubmissionViews.Entry entry(UUID ownerId) {
        var me = staff(CUSTOMER_ENTRY_MANAGE); var owner = ownerId == null ? me.accountId() : ownerId; manage(me, owner);
        return entryView(submissions.entryForOwner(owner));
    }
    @Transactional public SubmissionViews.Entry changeEntry(UUID ownerId, String action, String requestId) {
        var me = staff(CUSTOMER_ENTRY_MANAGE); var owner = ownerId == null ? me.accountId() : ownerId; manage(me, owner);
        var employee = identity.selectEmployee(owner); var old = submissions.entryForOwner(owner);
        if (action == null || !Set.of("CREATE", "RESET", "ENABLE", "DISABLE").contains(action)) throw invalid();
        if (old == null && (!owner.equals(me.accountId()) || !"CREATE".equals(action))) throw invalid();
        if (old != null && "CREATE".equals(action)) return entryView(old);
        String token = old == null || "RESET".equals(action) ? randomToken() : old.token();
        boolean enabled = switch (action) {
            case "CREATE", "ENABLE" -> true;
            case "DISABLE" -> false;
            default -> old.enabled();
        };
        if (old != null && old.enabled() == enabled && old.token().equals(token) && old.ownerName().equals(employee.nickname())) return entryView(old);
        var saved = submissions.saveEntry(owner, employee.nickname(), token, enabled);
        var details = new LinkedHashMap<String, String>();
        details.put("ownerId", owner.toString()); details.put("ownerEmployeeNumber", employee.employeeNumber()); details.put("ownerName", employee.nickname());
        details.put("before.exists", Boolean.toString(old != null)); details.put("before.enabled", old == null ? "" : Boolean.toString(old.enabled()));
        details.put("after.enabled", Boolean.toString(enabled)); details.put("tokenRotated", Boolean.toString(old != null && !old.token().equals(token)));
        String event = switch (action) { case "CREATE" -> "created"; case "ENABLE" -> "enabled"; case "DISABLE" -> "disabled"; default -> "reset"; };
        audit.appendChange(new AuditFacade.Command(clock.instant(), "order.entry_" + event, "SUCCESS", me.accountId(), me.employeeNumber(), me.nickname(), saved.id().toString(), requestId, details));
        return entryView(saved);
    }
    @Transactional(readOnly = true) public SubmissionViews.PublicEntry publicEntry(String token) {
        return new SubmissionViews.PublicEntry(validEntry(token, false).ownerName());
    }
    @Transactional public SubmissionViews.Receipt submit(String token, UUID requestId, SubmissionCommands.Content command) {
        if (requestId == null || command == null) throw invalid();
        var entry = validEntry(token, true); var content = convert(command, CustomerSubmission.Content.class);
        var submission = submissions.submit(entry, requestId, fingerprint(content), content, clock.instant());
        return new SubmissionViews.Receipt(submission.id(), "F" + submission.id());
    }
    @Transactional(readOnly = true) public Page<SubmissionViews.Detail> search(boolean mine, String status, int page, int size) {
        var me = staff();
        if (page < 1 || size < 1 || size > 50 || !Set.of("PENDING", "CONFIRMED").contains(status)) throw invalid();
        UUID owner = mine ? me.accountId() : null;
        return new Page<>(submissions.search(owner, status, size, ((long) page - 1) * size).stream().map(s -> view(s, false)).toList(),
                submissions.count(owner, status), page, size);
    }
    @Transactional(readOnly = true) public long pendingCount() {
        staff(CUSTOMER_SUBMISSION_PROCESS);
        return submissions.count(null, "PENDING");
    }
    @Transactional(readOnly = true) public SubmissionViews.Detail detail(UUID id) { staff(); return view(require(id, false), true); }
    @Transactional public SubmissionViews.Detail save(UUID id, SubmissionCommands.Save command) {
        var me = staff(); var submission = require(id, true); submission.requirePending(nonNegativeInteger(command.expectedVersion()));
        if (command.review() == null) throw invalid();
        money(command.review().totalAmountCents());
        if (command.review().prices() != null) command.review().prices().forEach(price -> {
            if (price == null) throw invalid(); money(price.unitPriceCents()); money(price.memberPriceCents());
        });
        var review = convert(command.review(), CustomerSubmission.Review.class);
        if (review.creditedEmployeeId() != null) identity.selectEmployee(review.creditedEmployeeId());
        if (Objects.equals(submission.reviewed(), review)) return view(submission, true);
        var before = submission.reviewed() == null ? submission.original() : submission.reviewed().content();
        var details = new LinkedHashMap<String, Object>(); details.put("before", submission.reviewed() == null ? Map.of("content", CustomerSubmission.customerFields(before)) : reviewSnapshot(submission.reviewed()));
        details.put("after", reviewSnapshot(review)); details.put("customerFieldChanges", CustomerSubmission.differences(before, review.content()));
        submissions.update(submission, review, "PENDING", null, clock.instant());
        submissions.append(id, "REVIEWED", me.accountId(), me.nickname(), details, clock.instant());
        return view(require(id, false), true);
    }
    @Transactional public SubmissionViews.Detail confirm(UUID id, SubmissionCommands.Confirm command) {
        var me = staff(CUSTOMER_SUBMISSION_PROCESS, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_CREATE); var submission = require(id, true);
        long expected = nonNegativeInteger(command.expectedVersion());
        // A lost confirmation response can be retried without creating another order.
        if ("CONFIRMED".equals(submission.status())) {
            orders.detail(submission.orderId());
            return view(submission, true);
        }
        submission.requirePending(expected);
        var review = submission.reviewed(); if (review == null) throw new OrderFailure("SUBMISSION_REVIEW_REQUIRED"); review.requireConfirmation();
        var duplicates = submissions.duplicates(submission);
        boolean requiresAcknowledgement = duplicates.stream().anyMatch(CustomerSubmissions.Duplicate::requiresAcknowledgement);
        if ((requiresAcknowledgement || command.duplicateCheckToken() != null)
                && !duplicateCheckToken(submission, duplicates).equals(command.duplicateCheckToken()))
            throw new OrderFailure("DUPLICATE_REVIEW_REQUIRED");
        var content = review.content();
        var items = new ArrayList<OrderCommands.Item>();
        for (int i = 0; i < content.items().size(); i++) {
            var item = content.items().get(i); var price = review.prices().get(i);
            items.add(new OrderCommands.Item(item.name(), item.productType(), item.quantity(), price.unitPriceCents(), price.memberPriceCents(), new LinkedHashMap<>(item.attributes())));
        }
        var create = new OrderCommands.Create(new OrderCommands.Customer(null, content.phone(), content.memberPhone(), null),
                new OrderCommands.Fulfillment(content.fulfillmentType(), content.address(), content.requestedDate(), review.plannedHandoffAt(), review.plannedFinishAt(), content.requestedReceiveAt()),
                items, review.totalAmountCents(), review.creditedEmployeeId());
        var order = orders.createCustomer(create, new OrderCommands.Operator(me.accountId(), me.nickname()), id);
        submissions.update(submission, review, "CONFIRMED", order.orderId(), clock.instant());
        submissions.markOrder(order.orderId(), submission);
        var confirmation = new LinkedHashMap<String, Object>();
        confirmation.put("orderId", order.orderId()); confirmation.put("source", "CUSTOMER_SUBMITTED");
        confirmation.put("creditedEmployeeId", review.creditedEmployeeId()); confirmation.put("creditedEmployeeName", order.creditedEmployee().nickname());
        if (requiresAcknowledgement) {
            confirmation.put("duplicateReview", Map.of("decision", "CONFIRMED_INDEPENDENT_ORDER", "records", duplicates));
        }
        submissions.append(id, "CONFIRMED", me.accountId(), me.nickname(), confirmation, clock.instant());
        return view(require(id, false), true);
    }
    @Transactional public void delete(UUID id, Number expectedVersion) {
        var me = staff(CUSTOMER_SUBMISSION_PROCESS); var submission = require(id, true); submission.requirePending(nonNegativeInteger(expectedVersion));
        submissions.update(submission, submission.reviewed(), "DELETED", null, clock.instant());
        submissions.append(id, "DELETED", me.accountId(), me.nickname(), Map.of("before", "PENDING", "after", "DELETED"), clock.instant());
    }
    @Transactional(readOnly = true) public SubmissionViews.Origin origin(UUID orderId) {
        var submission = submissions.findByOrder(orderId);
        return submission == null ? null : new SubmissionViews.Origin(submission.id(), "CUSTOMER_SUBMITTED", submission.ownerId(), submission.ownerName(),
                submission.createdAt(), submission.original().requestedReceiveAt());
    }
    private CustomerSubmissions.Entry validEntry(String token, boolean forSubmission) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new OrderFailure("ENTRY_UNAVAILABLE");
        var entry = submissions.entryByToken(token);
        if (entry == null || !entry.enabled()) throw new OrderFailure("ENTRY_UNAVAILABLE");
        var owner = forSubmission ? identity.lockCustomerEntryOwner(entry.ownerId()) : identity.customerEntryOwner(entry.ownerId());
        if (owner == null) throw new OrderFailure("ENTRY_UNAVAILABLE");
        if (forSubmission) entry = submissions.lockEntry(token);
        if (entry == null || !entry.enabled()) throw new OrderFailure("ENTRY_UNAVAILABLE");
        return entry;
    }
    private IdentityFacade.AccountView staff() {
        return staff(CUSTOMER_SUBMISSION_PROCESS, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ);
    }
    private IdentityFacade.AccountView staff(Permission... required) {
        var me = identity.me();
        if (!"ACTIVE".equals(me.status()) || me.passwordChangeRequired()
                || !Arrays.stream(required).allMatch(me.access()::allows)) throw new OrderFailure("SUBMISSION_FORBIDDEN");
        return me;
    }
    private static void manage(IdentityFacade.AccountView me, UUID owner) {
        if (!me.accountId().equals(owner) && !me.access().allows(CUSTOMER_ENTRY_MANAGE_ALL)) throw new OrderFailure("SUBMISSION_FORBIDDEN");
    }
    private SubmissionViews.Entry entryView(CustomerSubmissions.Entry entry) {
        return entry == null ? null : new SubmissionViews.Entry(entry.ownerId(), entry.ownerName(), publicOrigin + "/#/fill/" + entry.token(), entry.enabled());
    }
    private CustomerSubmission require(UUID id, boolean lock) {
        var submission = submissions.find(id, lock); if (submission == null) throw new OrderFailure("SUBMISSION_NOT_FOUND"); return submission;
    }
    private SubmissionViews.Detail view(CustomerSubmission submission, boolean history) {
        var duplicates = "PENDING".equals(submission.status()) ? submissions.duplicates(submission) : List.<CustomerSubmissions.Duplicate>of();
        return new SubmissionViews.Detail(convert(submission, SubmissionViews.Submission.class),
                duplicates.stream().map(record -> convert(record, SubmissionViews.Duplicate.class)).toList(),
                "PENDING".equals(submission.status()) ? duplicateCheckToken(submission, duplicates) : null,
                history ? submissions.activities(submission.id()).stream().map(a -> convert(a, SubmissionViews.Activity.class)).toList() : List.of());
    }
    private String duplicateCheckToken(CustomerSubmission submission, List<CustomerSubmissions.Duplicate> duplicates) {
        return fingerprint(List.of(submission.id(), submission.version(), duplicates));
    }
    private <T> T convert(Object value, Class<T> type) {
        try { return json.read(json.write(value), type); }
        catch (IllegalArgumentException failure) {
            for (Throwable cause = failure; cause != null; cause = cause.getCause()) if (cause instanceof OrderFailure domain) throw domain;
            throw failure;
        }
    }
    @SuppressWarnings("unchecked") private Map<String, Object> snapshot(Object value) { return convert(value, Map.class); }
    private Map<String, Object> reviewSnapshot(CustomerSubmission.Review review) {
        var result = new LinkedHashMap<>(snapshot(review));
        if (review.creditedEmployeeId() != null) identity.employeeOptions(true).stream().filter(employee -> employee.accountId().equals(review.creditedEmployeeId())).findFirst()
                .ifPresent(employee -> result.put("creditedEmployeeName", employee.nickname() + " · " + employee.employeeNumber()));
        return result;
    }
    private String fingerprint(Object content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.write(content).getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
    }
    private static String randomToken() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static OrderFailure invalid() { return new OrderFailure("VALIDATION_FAILED"); }
}
