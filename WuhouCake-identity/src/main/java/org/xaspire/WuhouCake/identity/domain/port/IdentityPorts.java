package org.xaspire.WuhouCake.identity.domain.port;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.xaspire.WuhouCake.identity.domain.model.entity.LoginSession;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.Actor;

public final class IdentityPorts {
    private IdentityPorts() { }
    public interface ActorSource { Actor current(); }
    public interface Credentials {
        String encode(String password);
        boolean matches(String password, String encoded);
        String temporaryPassword();
        String secret();
        String digest(String secret);
        boolean matchesDigest(String secret, String digest);
    }
    public interface Sessions {
        void save(LoginSession session);
        Optional<LoginSession> find(UUID id);
        void remove(UUID id);
    }
    public interface Attempts {
        void check(String employeeNumber);
        void failed(String employeeNumber);
        void clear(String employeeNumber);
    }
    public interface AccessTokens { String issue(UUID accountId, UUID sessionId, long version, Instant issuedAt, Instant expiresAt); }
}
