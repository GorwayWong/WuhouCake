package org.xaspire.WuhouCake.identity.domain.model.entity;

import java.time.Instant;
import java.util.UUID;

public record LoginSession(UUID id, UUID accountId, long credentialVersion, String refreshHash, Instant expiresAt) {
    public boolean expired(Instant now) { return !expiresAt.isAfter(now); }
    @Override public String toString() { return "LoginSession[id=" + id + "]"; }
}
