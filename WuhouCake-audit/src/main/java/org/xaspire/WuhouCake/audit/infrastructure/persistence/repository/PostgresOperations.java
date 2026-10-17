package org.xaspire.WuhouCake.audit.infrastructure.persistence.repository;

import java.util.List;
import java.util.UUID;
import org.xaspire.WuhouCake.audit.domain.model.aggregate.Operation;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
import org.xaspire.WuhouCake.audit.infrastructure.persistence.mapper.OperationMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresOperations implements Operations {
    private final OperationMapper mapper;
    private final JsonCodec json;
    public PostgresOperations(OperationMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }
    private static String string(UUID id) { return id == null ? null : id.toString(); }
    @Override public void append(Operation op) {
        mapper.insert(new OperationMapper.Row(string(op.id()), op.occurredAt(), op.action(), op.result(), string(op.actorId()),
                op.actorEmployeeNumber(), op.actorNickname(), op.targetId(), op.requestId(), json.write(op.details())));
    }
    @Override public List<Operation> search(Search query) {
        return mapper.search(string(query.actorId()), query.action(), query.result(), query.from(), query.to(), query.size(), (query.page() - 1) * query.size())
                .stream().map(row -> new Operation(UUID.fromString(row.id()), row.occurredAt(), row.action(), row.result(),
                        row.actorId() == null ? null : UUID.fromString(row.actorId()), row.actorEmployeeNumber(), row.actorNickname(), row.targetId(), row.requestId(), json.read(row.details(), java.util.Map.class))).toList();
    }
    @Override public long count(Search query) { return mapper.count(string(query.actorId()), query.action(), query.result(), query.from(), query.to()); }
}
