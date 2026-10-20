package org.xaspire.WuhouCake.order.application.service;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.api.command.*;
import org.xaspire.WuhouCake.order.api.dto.SubmissionViews;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import org.xaspire.WuhouCake.shared.response.Page;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public class CustomerSubmissionService {
    private final CustomerSubmissions submissions; private final IdentityFacade identity; private final OrderService orders;
    private final JsonCodec json; private final Clock clock; private final String publicOrigin;
    public CustomerSubmissionService(CustomerSubmissions submissions, IdentityFacade identity, OrderService orders, JsonCodec json, Clock clock, String publicOrigin) {
        this.submissions = submissions; this.identity = identity; this.orders = orders; this.json = json; this.clock = clock;
        this.publicOrigin = publicOrigin.replaceAll("/+$", "");
    }
    @Transactional(readOnly = true) public SubmissionViews.Entry entry(UUID ownerId) {
        var me = staff(); var owner = ownerId == null ? me.accountId() : ownerId; manage(me, owner);
        return entryView(submissions.entryForOwner(owner));
    }
    @Transactional public SubmissionViews.Entry changeEntry(UUID ownerId, String action) {
        var me = staff(); var owner = ownerId == null ? me.accountId() : ownerId; manage(me, owner);
        var employee = identity.selectEmployee(owner); var old = submissions.entryForOwner(owner);
        if (action == null || !Set.of("CREATE", "RESET", "ENABLE", "DISABLE").contains(action)) throw invalid();
        if (old == null && (!owner.equals(me.accountId()) || !"CREATE".equals(action))) throw invalid();
        if (old != null && "CREATE".equals(action)) return entryView(old);
        String token = old == null || "RESET".equals(action) ? randomToken() : old.token();
        return entryView(submissions.saveEntry(owner, employee.nickname(), token, !"DISABLE".equals(action)));
    }
    @Transactional public SubmissionViews.PublicEntry publicEntry(String token) {
        return new SubmissionViews.PublicEntry(validEntry(token).ownerName());
    }
    @Transactional public SubmissionViews.Receipt submit(String token, UUID requestId, SubmissionCommands.Content command) {
        if (requestId == null || command == null) throw invalid();
        var entry = validEntry(token); var content = convert(command, CustomerSubmission.Content.class);
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
        var me = staff(); var submission = require(id, true);
        long expected = nonNegativeInteger(command.expectedVersion());
        // A lost confirmation response can be retried without creating another order.
        if ("CONFIRMED".equals(submission.status())) return view(submission, true);
        submission.requirePending(expected);
        UUID newer = submissions.newer(submission);
        if (newer != null && !newer.equals(command.acknowledgedNewerSubmissionId())) throw new OrderFailure("NEWER_SUBMISSION_EXISTS");
        var review = submission.reviewed(); if (review == null) throw invalid(); review.requireConfirmation();
        var content = review.content();
        var items = new ArrayList<OrderCommands.Item>();
        for (int i = 0; i < content.items().size(); i++) {
            var item = content.items().get(i); var price = review.prices().get(i);
            items.add(new OrderCommands.Item(item.name(), item.productType(), item.quantity(), price.unitPriceCents(), price.memberPriceCents(), new LinkedHashMap<>(item.attributes())));
        }
        var create = new OrderCommands.Create(new OrderCommands.Customer(null, content.phone(), content.memberPhone(), null),
                new OrderCommands.Fulfillment(content.fulfillmentType(), content.address(), content.requestedDate(), review.plannedHandoffAt(), null),
                items, review.totalAmountCents(), review.creditedEmployeeId());
        var order = orders.createCustomer(create, new OrderCommands.Operator(me.accountId(), me.nickname()), id);
        submissions.update(submission, review, "CONFIRMED", order.orderId(), clock.instant());
        submissions.markOrder(order.orderId(), submission);
        submissions.append(id, "CONFIRMED", me.accountId(), me.nickname(), Map.of("orderId", order.orderId(), "source", "CUSTOMER_SUBMITTED",
                "creditedEmployeeId", review.creditedEmployeeId(), "creditedEmployeeName", order.creditedEmployee().nickname()), clock.instant());
        return view(require(id, false), true);
    }
    @Transactional public void delete(UUID id, Number expectedVersion) {
        var me = staff(); var submission = require(id, true); submission.requirePending(nonNegativeInteger(expectedVersion));
        submissions.update(submission, submission.reviewed(), "DELETED", null, clock.instant());
        submissions.append(id, "DELETED", me.accountId(), me.nickname(), Map.of("before", "PENDING", "after", "DELETED"), clock.instant());
    }
    @Transactional(readOnly = true) public SubmissionViews.Origin origin(UUID orderId) {
        var submission = submissions.findByOrder(orderId);
        return submission == null ? null : new SubmissionViews.Origin(submission.id(), "CUSTOMER_SUBMITTED", submission.ownerId(), submission.ownerName(),
                submission.createdAt(), submission.original().requestedReceiveAt());
    }
    private CustomerSubmissions.Entry validEntry(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new OrderFailure("ENTRY_UNAVAILABLE");
        var entry = submissions.entryByToken(token);
        if (entry == null || !entry.enabled()) throw new OrderFailure("ENTRY_UNAVAILABLE");
        if (identity.customerEntryOwner(entry.ownerId()) == null) throw new OrderFailure("ENTRY_UNAVAILABLE");
        entry = submissions.lockEntry(token);
        if (entry == null || !entry.enabled()) throw new OrderFailure("ENTRY_UNAVAILABLE");
        return entry;
    }
    private IdentityFacade.AccountView staff() {
        var me = identity.me();
        if (!"ACTIVE".equals(me.status()) || !(me.jobRoles().contains("FRONT_DESK") || me.jobRoles().contains("MANAGER"))) throw new OrderFailure("SUBMISSION_FORBIDDEN");
        return me;
    }
    private static void manage(IdentityFacade.AccountView me, UUID owner) {
        if (!me.accountId().equals(owner) && !me.jobRoles().contains("MANAGER")) throw new OrderFailure("SUBMISSION_FORBIDDEN");
    }
    private SubmissionViews.Entry entryView(CustomerSubmissions.Entry entry) {
        return entry == null ? null : new SubmissionViews.Entry(entry.ownerId(), entry.ownerName(), publicOrigin + "/#/fill/" + entry.token(), entry.enabled());
    }
    private CustomerSubmission require(UUID id, boolean lock) {
        var submission = submissions.find(id, lock); if (submission == null) throw new OrderFailure("SUBMISSION_NOT_FOUND"); return submission;
    }
    private SubmissionViews.Detail view(CustomerSubmission submission, boolean history) {
        return new SubmissionViews.Detail(convert(submission, SubmissionViews.Submission.class), "PENDING".equals(submission.status()) ? submissions.newer(submission) : null,
                history ? submissions.activities(submission.id()).stream().map(a -> convert(a, SubmissionViews.Activity.class)).toList() : List.of());
    }
    private <T> T convert(Object value, Class<T> type) { return json.read(json.write(value), type); }
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
