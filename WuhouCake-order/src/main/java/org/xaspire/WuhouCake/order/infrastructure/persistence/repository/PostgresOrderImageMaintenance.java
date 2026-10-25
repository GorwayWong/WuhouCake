package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMaintenanceMapper;

public final class PostgresOrderImageMaintenance implements OrderImageMaintenance {
    private final OrderImageMaintenanceMapper mapper;
    public PostgresOrderImageMaintenance(OrderImageMaintenanceMapper mapper) { this.mapper = mapper; }
    @Override public List<UUID> unprocessed(UUID after, int limit) { return mapper.candidates(after == null ? null : after.toString(), limit).stream().map(UUID::fromString).toList(); }
    @Override public Optional<Image> load(UUID id) { return Optional.ofNullable(mapper.load(id.toString())).map(row -> new Image(id, row.filename(), row.content())); }
    @Override public boolean replace(UUID id, OrderImageValidator.Checked checked) {
        return mapper.replace(id.toString(), checked.content(), checked.contentType(), checked.filename(), checked.content().length, checked.width(), checked.height()) == 1;
    }
}
