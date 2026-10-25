package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderPackages;
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
    public OrderPackageService(OrderPackages packages, IdGenerator ids, Clock clock, IdentityFacade identity, AuditFacade audit, JsonCodec json, ApplicationEventPublisher events) {
        this.packages = packages; this.ids = ids; this.clock = clock; this.identity = identity; this.audit = audit; this.json = json; this.events = events;
    }
    public Page<OrderPackageViews.Package> list(String keyword, int page, int size) {
        readAccess();
        String search = keyword == null ? "" : keyword.strip();
        int number = Math.max(1, page), limit = Math.max(1, Math.min(50, size));
        return new Page<>(packages.list(search, limit, (long) (number - 1) * limit).stream().map(OrderPackageService::view).toList(), packages.count(search), number, limit);
    }
    public OrderPackageViews.Package detail(UUID id) { readAccess(); return view(active(id)); }
    @Transactional
    public OrderPackageViews.Package create(String name, List<OrderPackageViews.Item> items, UUID key, String requestId) {
        var me = manager();
        if (key == null) throw invalid();
        var value = new OrderPackages.Package(ids.nextId(), requiredText(name == null ? null : name.strip(), 80), normalize(items), 0, clock.instant(), null);
        if (!packages.create(value, key)) {
            var previous = packages.findCreation(key).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
            if (previous.deletedAt() != null) throw new OrderFailure("PACKAGE_NOT_FOUND");
            if (!previous.name().equals(value.name()) || !previous.items().equals(value.items())) throw new OrderFailure("PACKAGE_CREATION_CONFLICT");
            return view(previous);
        }
        record("created", me, null, value, requestId);
        return view(value);
    }
    @Transactional
    public OrderPackageViews.Package update(UUID id, OrderPackageViews.Update command, String requestId) {
        var me = manager(); var before = active(id);
        if (command.expectedVersion() < 0) throw invalid();
        if (before.version() != command.expectedVersion()) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var after = new OrderPackages.Package(id, requiredText(command.name() == null ? null : command.name().strip(), 80), normalize(command.items()), before.version() + 1, clock.instant(), null);
        if (!packages.update(after, command.expectedVersion())) throw new OrderFailure("CONCURRENT_MODIFICATION");
        record("updated", me, before, after, requestId);
        return view(after);
    }
    @Transactional
    public void delete(UUID id, long expectedVersion, String requestId) {
        var me = manager();
        if (expectedVersion < 0) throw invalid();
        var before = packages.find(id).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
        if (before.deletedAt() != null) return;
        var now = clock.instant();
        if (!packages.delete(id, expectedVersion, now)) throw new OrderFailure("CONCURRENT_MODIFICATION");
        record("deleted", me, before, new OrderPackages.Package(id, before.name(), before.items(), before.version() + 1, now, now), requestId);
    }
    private OrderPackages.Package active(UUID id) {
        return packages.find(id).filter(value -> value.deletedAt() == null).orElseThrow(() -> new OrderFailure("PACKAGE_NOT_FOUND"));
    }
    private void readAccess() {
        var me = identity.me();
        if (!me.jobRoles().contains("MANAGER") && !me.jobRoles().contains("STORE_MANAGER") && !me.access().allows(Permission.ORDER_CREATE)) throw new OrderFailure("PACKAGE_FORBIDDEN");
    }
    private IdentityFacade.AccountView manager() {
        var me = identity.me();
        if (!me.jobRoles().contains("MANAGER") && !me.jobRoles().contains("STORE_MANAGER")) throw new OrderFailure("PACKAGE_FORBIDDEN");
        return me;
    }
    private List<OrderPackages.Item> normalize(List<OrderPackageViews.Item> items) {
        if (items == null || items.isEmpty()) throw invalid();
        return items.stream().map(item -> {
            if (item == null) throw invalid();
            String type = requiredText(item.productType(), 32).toUpperCase(Locale.ROOT);
            if (!Set.of("CAKE", "BREAD", "DONUT", "CUPCAKE", "DRINK", "OTHER").contains(type)) throw invalid();
            var attributes = new LinkedHashMap<String, Object>();
            Set<String> allowed = type.equals("CAKE") ? Set.of("size", "flavor", "filling", "base", "message", "requirements") : Set.of("specification", "requirements");
            if (item.attributes() != null) item.attributes().forEach((field, content) -> {
                if (!allowed.contains(field) || content != null && !(content instanceof String)) throw invalid();
                if (content instanceof String text && !text.isBlank()) attributes.put(field, text.strip());
            });
            if (type.equals("CAKE") && attributes.containsKey("size")) attributes.put("size", CakeSpecifications.size(attributes.get("size")));
            return new OrderPackages.Item(requiredText(item.name(), 128), type, quantity(item.quantity()), JsonSnapshot.object(attributes));
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
    private static OrderPackageViews.Package view(OrderPackages.Package value) {
        return new OrderPackageViews.Package(value.id(), value.name(), value.items().stream()
                .map(item -> new OrderPackageViews.Item(item.name(), item.productType(), item.quantity(), item.attributes())).toList(), value.version(), value.updatedAt());
    }
}
