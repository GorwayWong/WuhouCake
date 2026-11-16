package org.xaspire.WuhouCake.identity.api.facade;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.List;
import org.xaspire.WuhouCake.shared.response.Page;

public interface IdentityFacade {
    record AccountView(UUID accountId, String employeeNumber, String nickname, Set<String> jobRoles,
            String systemRole, String status, boolean passwordChangeRequired, long credentialVersion,
            Instant createdAt, Instant archivedAt, long version, EmployeeAccess access) {
        public AccountView {
            jobRoles = Set.copyOf(jobRoles);
            access = java.util.Objects.requireNonNull(access);
        }
        public AccountView(UUID accountId, String employeeNumber, String nickname, Set<String> jobRoles, String systemRole,
                String status, boolean passwordChangeRequired, long credentialVersion, Instant createdAt, Instant archivedAt) {
            this(accountId, employeeNumber, nickname, jobRoles, systemRole, status, passwordChangeRequired, credentialVersion, createdAt, archivedAt, 0, EmployeeAccess.none());
        }
    }
    record EmployeeOption(UUID accountId, String employeeNumber, String nickname, String status) { }
    record Profile(long expectedVersion, String nickname, Set<String> jobRoles) { }
    record Create(String employeeNumber, String nickname, Set<String> jobRoles, String systemRole) { }
    record Search(String employeeNumber, String nickname, String status, String jobRole, int page, int size) { }
    /** Invalidates older credential versions only after the publishing transaction commits. */
    record CredentialsRevoked(UUID accountId, long credentialVersion) { }
    record Provisioned(AccountView account, String temporaryPassword) {
        @Override public String toString() { return "Provisioned[accountId=" + account.accountId() + "]"; }
    }
    record Login(String accessToken, String tokenType, long expiresIn, boolean passwordChangeRequired,
            String refreshCredential, long refreshExpiresIn) {
        @Override public String toString() { return "Login[expiresIn=" + expiresIn + "]"; }
    }
    Login login(String employeeNumber, String password, String requestId);
    Login refresh(String refreshCredential);
    void logout(String refreshCredential, String requestId);
    AccountView authenticate(UUID accountId, UUID sessionId, long credentialVersion);
    AccountView me();
    AccountView rename(String nickname);
    void changePassword(String currentPassword, String newPassword);
    Provisioned create(Create command);
    Page<AccountView> employees(Search query);
    Provisioned resetPassword(UUID accountId);
    AccountView setEmployeePassword(UUID accountId, long expectedVersion, String newPassword);
    AccountView archive(UUID accountId);
    AccountView reviseEmployee(UUID accountId, Profile command);
    List<EmployeeOption> employeeOptions(boolean includeArchived);
    EmployeeOption selectEmployee(UUID accountId);
    /** Returns an active front-desk/manager entry owner, or null; does not require a customer login. */
    EmployeeOption customerEntryOwner(UUID accountId);
    /** Holds a shared owner lock until the caller's transaction completes; requires an existing transaction. */
    EmployeeOption lockCustomerEntryOwner(UUID accountId);
}
