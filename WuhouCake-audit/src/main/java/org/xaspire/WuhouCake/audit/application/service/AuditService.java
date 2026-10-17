package org.xaspire.WuhouCake.audit.application.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.audit.domain.model.aggregate.Operation;
import org.xaspire.WuhouCake.audit.domain.port.AuditAccess;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.response.Page;

@Service
public class AuditService implements AuditFacade {
    private final Operations operations;
    private final AuditAccess access;
    private final IdGenerator ids;
    public AuditService(Operations operations, AuditAccess access, IdGenerator ids) {
        this.operations = operations; this.access = access; this.ids = ids;
    }
    @Override @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void append(Command command) {
        write(command);
    }
    @Override @Transactional(propagation = Propagation.MANDATORY)
    public void appendChange(Command command) { write(command); }
    private void write(Command command) {
        operations.append(new Operation(ids.nextId(), command.occurredAt(), command.action(), command.result(), command.actorId(),
                command.actorEmployeeNumber(), command.actorNickname(), command.targetId(), command.requestId(), command.details()));
    }
    @Override @Transactional(readOnly = true)
    public Page<Entry> query(Query query) {
        access.requireAdministrator();
        var search = new Operations.Search(query.actorId(), query.action(), query.result(), query.from(), query.to(), query.page(), query.size());
        var entries = operations.search(search).stream().map(op -> new Entry(op.id(), op.occurredAt(), op.action(), op.result(),
                op.actorId(), op.actorEmployeeNumber(), op.actorNickname(), op.targetId(), op.requestId(), op.details())).toList();
        return new Page<>(entries, operations.count(search), query.page(), query.size());
    }
}
