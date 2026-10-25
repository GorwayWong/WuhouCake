package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.Optional;
import java.time.Instant;
import org.springframework.dao.DuplicateKeyException;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderPackages;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderPackageMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresOrderPackages implements OrderPackages {
    private final OrderPackageMapper mapper;
    private final JsonCodec json;
    public PostgresOrderPackages(OrderPackageMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }
    @Override public List<Package> list(String keyword, int limit, long offset) {
        return mapper.list(keyword, limit, offset).stream().map(this::value).toList();
    }
    @Override public long count(String keyword) { return mapper.count(keyword); }
    @Override public Optional<Package> find(UUID id) { return Optional.ofNullable(mapper.find(id.toString())).map(this::value); }
    @Override public Optional<Package> findCreation(UUID key) { return Optional.ofNullable(mapper.findCreation(key.toString())).map(this::value); }
    @Override public boolean create(Package value, UUID key) {
        // 同标识串行核实，避免并发插入先命中名称索引而误报重名。
        mapper.lockCreation(key.toString());
        if (mapper.findCreation(key.toString()) != null) return false;
        try { return mapper.create(value.id().toString(), value.name(), json.write(value.items()), key.toString(), value.updatedAt()) == 1; }
        catch (DuplicateKeyException failure) { throw nameConflict(failure); }
    }
    @Override public boolean update(Package value, long expectedVersion) {
        try { return mapper.update(value.id().toString(), value.name(), json.write(value.items()), expectedVersion, value.updatedAt()) == 1; }
        catch (DuplicateKeyException failure) { throw nameConflict(failure); }
    }
    @Override public boolean delete(UUID id, long expectedVersion, Instant now) { return mapper.delete(id.toString(), expectedVersion, now) == 1; }
    @Override public void recordChange(UUID changeId, UUID actorId, Package before, Package after) {
        mapper.recordChange(changeId.toString(), after.id().toString(), actorId.toString(), after.updatedAt(), before == null ? null : json.write(before), json.write(after));
    }
    private RuntimeException nameConflict(DuplicateKeyException failure) {
        return failure.getMostSpecificCause().getMessage().contains("cake_order_package_active_name") ? new OrderFailure("PACKAGE_NAME_CONFLICT") : failure;
    }
    private Package value(OrderPackageMapper.Row row) {
        return new Package(UUID.fromString(row.id()), row.name(), Arrays.asList(json.read(row.items(), Item[].class)), row.version(), row.updatedAt(), row.deletedAt());
    }
}
