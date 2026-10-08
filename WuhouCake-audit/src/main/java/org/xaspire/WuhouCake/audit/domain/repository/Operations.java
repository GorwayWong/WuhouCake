package org.xaspire.WuhouCake.audit.domain.repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.xaspire.WuhouCake.audit.domain.model.aggregate.Operation;

public interface Operations {
    record Search(UUID actorId, String action, String result, Instant from, Instant to, int page, int size) {
        public Search {
            if (page < 1 || page > 1_000_000 || size < 1 || size > 100 || (from != null && to != null && !from.isBefore(to)))
                throw new IllegalArgumentException("Invalid audit query");
        }
    }
    void append(Operation operation);
    List<Operation> search(Search search);
    long count(Search search);
}
