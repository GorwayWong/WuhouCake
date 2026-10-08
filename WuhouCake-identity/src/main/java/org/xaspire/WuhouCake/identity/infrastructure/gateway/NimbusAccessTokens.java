package org.xaspire.WuhouCake.identity.infrastructure.gateway;

import java.time.Instant;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.AccessTokens;

public final class NimbusAccessTokens implements AccessTokens {
    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;
    public NimbusAccessTokens(JwtEncoder encoder, String issuer, String audience) { this.encoder = encoder; this.issuer = issuer; this.audience = audience; }
    @Override public String issue(UUID account, UUID session, long version, Instant issued, Instant expires) {
        var claims = JwtClaimsSet.builder().issuer(issuer).audience(java.util.List.of(audience)).subject(account.toString())
                .id(UUID.randomUUID().toString()).issuedAt(issued).notBefore(issued).expiresAt(expires)
                .claim("sid", session.toString()).claim("ver", version).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).type("JWT").build(), claims)).getTokenValue();
    }
}
