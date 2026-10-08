package org.xaspire.WuhouCake.identity.api.facade;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.xaspire.WuhouCake.shared.response.Page;

public interface IdentityFacade {
    record AccountView(UUID accountId, String employeeNumber, String nickname, Set<String> jobRoles,
            String systemRole, String status, boolean passwordChangeRequired, long credentialVersion,
            Instant createdAt, Instant archivedAt) { }
    record Create(String employeeNumber, String nickname, Set<String> jobRoles, String systemRole) { }
    record Search(String employeeNumber, String nickname, String status, String jobRole, int page, int size) { }
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
    AccountView archive(UUID accountId);
}
