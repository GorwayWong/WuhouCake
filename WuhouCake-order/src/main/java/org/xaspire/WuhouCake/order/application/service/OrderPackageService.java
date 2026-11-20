package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionOperations;
import java.util.function.Supplier;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImageName;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;
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
    public static final int MAX_IMAGE_BYTES = IMAGE_BYTES;
    public static void requireUploadSize(long imageBytes, int count, long totalBytes) {
        OrderImageService.requireUploadSize(imageBytes);
        if (count > PACKAGE_IMAGES || totalBytes > PACKAGE_IMAGE_BYTES) throw new OrderFailure("IMAGE_BATCH_TOO_LARGE");
    }
    private final OrderPackages packages;
    private final IdGenerator ids;
    private final Clock clock;
    private final IdentityFacade identity;
    private final AuditFacade audit;
    private final JsonCodec json;
    private final ApplicationEventPublisher events;
    private final OrderImageValidator validator;
    private final TransactionOperations writes;
    public record Upload(String filename, Supplier<byte[]> source) {
        public Upload(String filename, byte[] content) { this(filename, () -> content); }
    }
    private record Prepared(OrderImageValidator.Checked checked, String fingerprint) { }
    public OrderPackageService(OrderPackages packages, IdGenerator ids, Clock clock, IdentityFacade identity, AuditFacade audit, JsonCodec json, ApplicationEventPublisher events, OrderImageValidator validator, TransactionOperations writes) {
        this.packages = packages; this.ids = ids; this.clock = clock; this.identity = identity; this.audit = audit; this.json = json; this.events = events; this.validator = validator;
        this.writes = writes;
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
    public OrderPackageViews.Package create(OrderPackageViews.Save command, Map<UUID, Upload> uploads, UUID key, String requestId) {
        manager();
        if (key == null) throw invalid();
        var items = normalize(command.items());
        Long original = money(command.originalAmountCents()), member = money(command.memberAmountCents());
        UUID id = ids.nextId();
        String name = name(command.name());
        var prepared = prepareImages(packages.findCreation(key).orElse(null), items, uploads);
        return writes.execute(transaction -> {
            var me = manager();
            var value = new OrderPackages.Package(id, name, items, original, member, 0, clock.instant().truncatedTo(ChronoUnit.MICROS), null);
            if (!packages.create(value, key)) {
                var previous = packages.findCreation(key).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
                if (previous.deletedAt() != null) throw new OrderFailure("PACKAGE_NOT_FOUND");
                if (!previous.name().equals(value.name()) || !previous.items().equals(value.items()) ||
                        !Objects.equals(previous.originalAmountCents(), value.originalAmountCents()) ||
                        !Objects.equals(previous.memberAmountCents(), value.memberAmountCents())) throw new OrderFailure("PACKAGE_CREATION_CONFLICT");
                writeImages(previous, prepared, true);
                return view(previous, true);
            }
            writeImages(value, prepared, false);
            record("created", me, null, value, requestId);
            return view(value, true);
        });
    }
    public OrderPackageViews.Package update(UUID id, OrderPackageViews.Update command, Map<UUID, Upload> uploads, String requestId) {
        manager(); var initial = active(id);
        if (command.expectedVersion() < 0) throw invalid();
        if (initial.version() != command.expectedVersion()) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var items = normalize(command.items());
        Long original = money(command.originalAmountCents()), member = money(command.memberAmountCents());
        String name = name(command.name());
        var prepared = prepareImages(initial, items, uploads);
        return writes.execute(transaction -> {
            var me = manager(); var before = active(id);
            if (before.version() != command.expectedVersion()) throw new OrderFailure("CONCURRENT_MODIFICATION");
            var after = new OrderPackages.Package(id, name, items, original, member, before.version() + 1, clock.instant().truncatedTo(ChronoUnit.MICROS), null);
            if (!packages.update(after, command.expectedVersion())) throw new OrderFailure("CONCURRENT_MODIFICATION");
            writeImages(after, prepared, false);
            packages.cleanImages(id);
            record("updated", me, before, after, requestId);
            return view(after, true);
        });
    }
    private String name(String value) { return requiredText(value == null ? null : value.strip(), 80); }
    private Map<UUID, Prepared> prepareImages(OrderPackages.Package before, List<OrderPackages.Item> items, Map<UUID, Upload> uploads) {
        if (uploads.size() > PACKAGE_IMAGES) throw new OrderFailure("IMAGE_BATCH_TOO_LARGE");
        var itemByImage = new HashMap<UUID, OrderPackages.Item>();
        for (var item : items) if (item.imageId() != null) itemByImage.put(item.imageId(), item);
        if (!itemByImage.keySet().containsAll(uploads.keySet())) throw invalid();
        if (uploads.isEmpty()) return Map.of();
        long expires = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        var existing = new HashMap<UUID, OrderPackages.ImageMetadata>();
        if (before != null) {
            for (UUID imageId : uploads.keySet()) {
                var item = itemByImage.get(imageId);
                packages.imageMetadata(before.id(), item.itemId(), imageId).ifPresent(metadata -> existing.put(imageId, metadata));
                remainingImageTime(expires);
            }
        }
        // Replays of saved files only compare fingerprints and never contend for the decoder.
        if (existing.size() == uploads.size()) return prepareBatch(uploads, existing, expires);
        return validator.inBatch(() -> prepareBatch(uploads, existing, expires));
    }

    private Map<UUID, Prepared> prepareBatch(Map<UUID, Upload> uploads, Map<UUID, OrderPackages.ImageMetadata> existing,
            long expires) {
        long received = 0, storedBytes = 0;
        var prepared = new HashMap<UUID, Prepared>();
        for (var entry : uploads.entrySet()) {
            remainingImageTime(expires);
            byte[] raw = entry.getValue().source().get();
            if (raw == null || raw.length == 0) throw new OrderFailure("INVALID_IMAGE");
            if (raw.length > IMAGE_BYTES) throw new OrderFailure("IMAGE_TOO_LARGE");
            received += raw.length;
            if (received > PACKAGE_IMAGE_BYTES) throw new OrderFailure("IMAGE_BATCH_TOO_LARGE");
            var stored = existing.get(entry.getKey());
            if (stored != null) {
                prepared.put(entry.getKey(), new Prepared(null, fingerprint(OrderImageName.normalized(entry.getValue().filename(), stored.contentType()), raw)));
            } else {
                var checked = validator.validate(raw, entry.getValue().filename(), remainingImageTime(expires));
                byte[] content = checked.content() == null ? raw : checked.content();
                storedBytes += content.length;
                if (storedBytes > PACKAGE_STORED_IMAGE_BYTES) throw new OrderFailure("IMAGE_BATCH_TOO_LARGE");
                prepared.put(entry.getKey(), new Prepared(new OrderImageValidator.Checked(checked.contentType(), checked.filename(), checked.width(), checked.height(), content), fingerprint(checked.filename(), raw)));
            }
            remainingImageTime(expires);
        }
        return prepared;
    }

    private static Duration remainingImageTime(long expires) {
        long remaining = expires - System.nanoTime();
        if (remaining <= 0) throw new OrderFailure("IMAGE_PROCESSING_TIMEOUT");
        return Duration.ofNanos(remaining);
    }

    private void writeImages(OrderPackages.Package value, Map<UUID, Prepared> prepared, boolean replay) {
        var remaining = new HashMap<>(prepared);
        for (var item : value.items()) {
            if (item.imageId() == null) continue;
            var upload = remaining.remove(item.imageId());
            var stored = packages.imageMetadata(value.id(), item.itemId(), item.imageId());
            if (upload == null && stored.isPresent()) continue;
            if (upload == null) throw invalid();
            if (stored.isPresent()) {
                if (!stored.get().fingerprint().equals(upload.fingerprint())) throw new OrderFailure(replay ? "PACKAGE_CREATION_CONFLICT" : "VALIDATION_FAILED");
            } else {
                if (replay || upload.checked() == null) throw new OrderFailure("PACKAGE_CREATION_CONFLICT");
                var checked = upload.checked();
                packages.insertImage(value.id(), item.itemId(), item.imageId(), new OrderPackages.Image(
                        checked.filename(), checked.contentType(), checked.content(), upload.fingerprint()));
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
