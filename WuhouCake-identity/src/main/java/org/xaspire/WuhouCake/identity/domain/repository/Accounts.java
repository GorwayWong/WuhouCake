package org.xaspire.WuhouCake.identity.domain.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;

public interface Accounts {
    record Search(String employeeNumber, String nickname, Status status, JobRole jobRole, int page, int size) { }
    record DirectoryEntry(UUID accountId, String employeeNumber, String nickname, Status status) { }
    List<DirectoryEntry> directory(boolean includeArchived);
    Optional<EmployeeAccount> find(UUID id);
    Optional<EmployeeAccount> findByNumber(String number);
    Optional<EmployeeAccount> lock(UUID id);
    void lockAdministratorLifecycle();
    long activeAdministrators();
    long administrators();
    void insert(EmployeeAccount account);
    void update(EmployeeAccount account);
    List<EmployeeAccount> search(Search search);
    long count(Search search);
}
