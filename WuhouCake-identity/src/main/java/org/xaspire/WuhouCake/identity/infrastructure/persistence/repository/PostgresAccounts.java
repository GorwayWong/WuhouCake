package org.xaspire.WuhouCake.identity.infrastructure.persistence.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.repository.Accounts;
import org.xaspire.WuhouCake.identity.infrastructure.persistence.mapper.AccountMapper;

public final class PostgresAccounts implements Accounts {
    private final AccountMapper mapper;
    public PostgresAccounts(AccountMapper mapper) { this.mapper = mapper; }
    @Override public Optional<EmployeeAccount> find(UUID id) { return Optional.ofNullable(mapper.find(id.toString())).map(this::account); }
    @Override public Optional<EmployeeAccount> findByNumber(String number) { return Optional.ofNullable(mapper.byNumber(number)).map(this::account); }
    @Override public Optional<EmployeeAccount> lock(UUID id) { return Optional.ofNullable(mapper.lock(id.toString())).map(this::account); }
    @Override public void lockAdministratorLifecycle() { mapper.lockAdministrators(); }
    @Override public long activeAdministrators() { return mapper.activeAdministrators(); }
    @Override public long administrators() { return mapper.administrators(); }
    @Override public void insert(EmployeeAccount account) {
        try {
            mapper.insert(row(account));
            account.jobRoles().forEach(role -> mapper.insertRole(account.id().toString(), role.name()));
        } catch (DuplicateKeyException failure) { throw new IdentityFailure("EMPLOYEE_NUMBER_CONFLICT"); }
    }
    @Override public void update(EmployeeAccount account) {
        if (mapper.update(row(account), account.version() - 1) != 1) throw new IdentityFailure("CONCURRENT_MODIFICATION");
    }
    @Override public List<EmployeeAccount> search(Search q) {
        return mapper.search(q.employeeNumber(), q.nickname(), name(q.status()), name(q.jobRole()), q.size(), (q.page() - 1) * q.size()).stream().map(this::account).toList();
    }
    @Override public long count(Search q) { return mapper.count(q.employeeNumber(), q.nickname(), name(q.status()), name(q.jobRole())); }
    private static String name(Enum<?> value) { return value == null ? null : value.name(); }
    private EmployeeAccount account(AccountMapper.Row row) {
        return new EmployeeAccount(UUID.fromString(row.id()), row.employeeNumber(), row.nickname(),
                mapper.roles(row.id()).stream().map(JobRole::valueOf).collect(Collectors.toSet()), SystemRole.valueOf(row.systemRole()), Status.valueOf(row.status()),
                row.passwordHash(), row.passwordChangeRequired(), row.credentialVersion(), row.version(), row.createdAt(), row.updatedAt(), row.archivedAt(),
                row.archivedBy() == null ? null : UUID.fromString(row.archivedBy()));
    }
    private static AccountMapper.Row row(EmployeeAccount account) {
        return new AccountMapper.Row(account.id().toString(), account.employeeNumber(), account.nickname(), account.systemRole().name(), account.status().name(),
                account.passwordHash(), account.passwordChangeRequired(), account.credentialVersion(), account.version(), account.createdAt(), account.updatedAt(),
                account.archivedAt(), account.archivedBy() == null ? null : account.archivedBy().toString());
    }
}
