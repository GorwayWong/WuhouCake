package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderPackages;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.xaspire.WuhouCake.order.api.dto.OrderPackageViews;
import org.xaspire.WuhouCake.order.application.event.OrderPackageChanged;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import org.xaspire.WuhouCake.shared.response.Page;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public class OrderPackageService {
    private final OrderPackages packages;
    private final IdGenerator ids;
    private final Clock clock;
    private final IdentityFacade identity;
    private final AuditFacade audit;
    private final JsonCodec json;
    private final ApplicationEventPublisher events;
    private final OrderImageValidator validator;
    public record Upload(String filename, byte[] content) { }
    public OrderPackageService(OrderPackages packages, IdGenerator ids, Clock clock, IdentityFacade identity, AuditFacade audit, JsonCodec json, ApplicationEventPublisher events, OrderImageValidator validator) {
        this.packages = packages; this.ids = ids; this.clock = clock; this.identity = identity; this.audit = audit; this.json = json; this.events = events; this.validator = validator;
    }
    public Page<OrderPackageViews.Package> list(String keyword, int page, int size) {
        boolean amounts = readAccess();
        String search = keyword == null ? "" : keyword.strip();
        int number = Math.max(1, page), limit = Math.max(1, Math.min(50, size));
        return new Page<>(packages.list(search, limit, (long) (number - 1) * limit).stream().map(value -> view(value, amounts)).toList(), packages.count(search), number, limit);
    }
    public OrderPackageViews.Package detail(UUID id) { boolean amounts = readAccess(); return view(active(id), amounts); }
    public OrderPackageViews.Image image(UUID id, UUID itemId, UUID imageId) {
        readAccess();
        var image = packages.image(id, itemId, imageId).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"));
        return new OrderPackageViews.Image(image.filename(), image.contentType(), image.content());
    }
    @Transactional
    public OrderPackageViews.Package create(OrderPackageViews.Save command, Map<UUID, Upload> uploads, UUID key, String requestId) {
        var me = manager();
        if (key == null) throw invalid();
        var value = new OrderPackages.Package(ids.nextId(), name(command.name()), normalize(command.items()), original(command.originalAmountCents()), money(command.memberAmountCents()), 0, clock.instant(), null);
        if (!packages.create(value, key)) {
            var previous = packages.findCreation(key).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
            if (previous.deletedAt() != null) throw new OrderFailure("PACKAGE_NOT_FOUND");
            if (!previous.name().equals(value.name()) || !previous.items().equals(value.items()) ||
                    !Objects.equals(previous.originalAmountCents(), value.originalAmountCents()) ||
                    !Objects.equals(previous.memberAmountCents(), value.memberAmountCents())) throw new OrderFailure("PACKAGE_CREATION_CONFLICT");
            writeImages(previous, uploads, true);
            return view(previous, true);
        }
        writeImages(value, uploads, false);
        record("created", me, null, value, requestId);
        return view(value, true);
    }
    @Transactional
    public OrderPackageViews.Package update(UUID id, OrderPackageViews.Update command, Map<UUID, Upload> uploads, String requestId) {
        var me = manager(); var before = active(id);
        if (command.expectedVersion() < 0) throw invalid();
        if (before.version() != command.expectedVersion()) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var after = new OrderPackages.Package(id, name(command.name()), normalize(command.items()), original(command.originalAmountCents()), money(command.memberAmountCents()), before.version() + 1, clock.instant(), null);
        if (!packages.update(after, command.expectedVersion())) throw new OrderFailure("CONCURRENT_MODIFICATION");
        writeImages(after, uploads, false);
        packages.cleanImages(id);
        record("updated", me, before, after, requestId);
        return view(after, true);
    }
    private String name(String value) { return requiredText(value == null ? null : value.strip(), 80); }
    private Long original(Number value) { if (value == null) throw invalid(); return money(value); }
    private void writeImages(OrderPackages.Package value, Map<UUID, Upload> uploads, boolean replay) {
        var remaining = new HashMap<>(uploads);
        for (var item : value.items()) {
            if (item.imageId() == null) continue;
            var upload = remaining.remove(item.imageId());
            var stored = packages.image(value.id(), item.itemId(), item.imageId());
            if (upload == null && stored.isPresent()) continue;
            if (upload == null) throw invalid();
            var checked = validator.validate(upload.content(), upload.filename());
            String fingerprint = fingerprint(checked.filename(), upload.content());
            if (stored.isPresent()) {
                if (!stored.get().fingerprint().equals(fingerprint)) throw new OrderFailure(replay ? "PACKAGE_CREATION_CONFLICT" : "VALIDATION_FAILED");
            } else {
                if (replay) throw new OrderFailure("PACKAGE_CREATION_CONFLICT");
                packages.insertImage(value.id(), item.itemId(), item.imageId(), new OrderPackages.Image(
                        checked.filename(), checked.contentType(), checked.content() == null ? upload.content() : checked.content(), fingerprint));
            }
        }
        if (!remaining.isEmpty()) throw invalid();
    }
    private static String fingerprint(String filename, byte[] content) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            digest.update((filename + "\0").getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest.digest(content));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    @Transactional
    public void delete(UUID id, long expectedVersion, String requestId) {
        var me = manager();
        if (expectedVersion < 0) throw invalid();
        var before = packages.find(id).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
        if (before.deletedAt() != null) return;
        var now = clock.instant();
        if (!packages.delete(id, expectedVersion, now)) throw new OrderFailure("CONCURRENT_MODIFICATION");
        packages.cleanImages(id);
        record("deleted", me, before, new OrderPackages.Package(id, before.name(), before.items(), before.originalAmountCents(), before.memberAmountCents(), before.version() + 1, now, now), requestId);
    }
    private OrderPackages.Package active(UUID id) {
        return packages.find(id).filter(value -> value.deletedAt() == null).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
    }
    private boolean readAccess() {
        var me = identity.me();
        boolean manager = me.jobRoles().contains("MANAGER") || me.jobRoles().contains("STORE_MANAGER");
        if (!manager && !me.access().allows(Permission.ORDER_CREATE)) throw new OrderFailure("PACKAGE_FORBIDDEN");
        return manager || me.access().allows(Permission.ORDER_AMOUNT_READ);
    }
    private IdentityFacade.AccountView manager() {
        var me = identity.me();
        if (!me.jobRoles().contains("MANAGER") && !me.jobRoles().contains("STORE_MANAGER")) throw new OrderFailure("PACKAGE_FORBIDDEN");
        return me;
    }
    private List<OrderPackages.Item> normalize(List<OrderPackageViews.Item> items) {
        if (items == null || items.isEmpty()) throw invalid();
        var itemIds = new HashSet<UUID>();
        var imageIds = new HashSet<UUID>();
        return items.stream().map(item -> {
            if (item == null || item.itemId() == null || !itemIds.add(item.itemId()) || !"OTHER".equals(item.productType()) ||
                    item.imageId() != null && !imageIds.add(item.imageId())) throw invalid();
            var attributes = item.attributes() == null ? Map.<String, Object>of() : item.attributes();
            if (attributes.keySet().stream().anyMatch(key -> !"specification".equals(key)) ||
                    attributes.get("specification") != null && !(attributes.get("specification") instanceof String)) throw invalid();
            return new OrderPackages.Item(item.itemId(), item.imageId(), requiredText(item.name(), 128), "OTHER", quantity(item.quantity()), CakeSpecifications.other(attributes), money(item.unitPriceCents()), money(item.memberPriceCents()));
        }).toList();
    }
    private void record(String action, IdentityFacade.AccountView me, OrderPackages.Package before, OrderPackages.Package after, String requestId) {
        var changeId = ids.nextId();
        packages.recordChange(changeId, me.accountId(), before, after);
        var details = new LinkedHashMap<String, String>();
        details.put("changeId", changeId.toString());
        if (before != null) details.put("before", json.write(Map.of("name", before.name(), "version", before.version(), "itemCount", before.items().size())));
        details.put("after", json.write(Map.of("name", after.name(), "version", after.version(), "itemCount", after.items().size(), "deleted", after.deletedAt() != null)));
        audit.appendChange(new AuditFacade.Command(clock.instant(), "order.package_" + action, "SUCCESS", me.accountId(), me.employeeNumber(), me.nickname(), after.id().toString(), requestId, details));
        events.publishEvent(new OrderPackageChanged(after.id(), after.version(), after.deletedAt() != null));
    }
    private static OrderPackageViews.Package view(OrderPackages.Package value, boolean amounts) {
        return new OrderPackageViews.Package(value.id(), value.name(), value.items().stream()
                .map(item -> new OrderPackageViews.Item(item.itemId(), item.imageId(), item.name(), item.productType(), item.quantity(), item.attributes(), amounts ? item.unitPriceCents() : null, amounts ? item.memberPriceCents() : null)).toList(), amounts ? value.originalAmountCents() : null, amounts ? value.memberAmountCents() : null, value.version(), value.updatedAt());
    }
}
