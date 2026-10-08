package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.*;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import static org.junit.jupiter.api.Assertions.*;

class JwtCompositionTest {
    @Test void validatesSignatureAudienceIssuerAndRequiredClaims() throws Exception {
        Instant now = Instant.parse("2026-10-08T00:00:00Z");
        var properties = new IdentityProperties(JwtTestKeys.privateKey(), JwtTestKeys.publicKey(), null, null, null, null, false, null);
        var configuration = new JwtComposition(); var key = configuration.identityRsaKey(properties);
        var encoder = configuration.jwtEncoder(key); var decoder = configuration.jwtDecoder(key, properties, Clock.fixed(now, ZoneOffset.UTC));
        var valid = JwtClaimsSet.builder().issuer(properties.issuer()).audience(List.of(properties.audience()))
                .subject(UUID.randomUUID().toString()).claim("sid", UUID.randomUUID().toString()).claim("ver", 0L)
                .issuedAt(now).expiresAt(now.plusSeconds(900)).build();
        assertNotNull(decoder.decode(encode(encoder, valid)));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).issuer("wrong").build())));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).audience(List.of("wrong")).build())));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).claim("sid", "bad").build())));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).claim("ver", -1).build())));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).claims(claims -> claims.remove("exp")).build())));
        assertThrows(JwtException.class, () -> decoder.decode(encode(encoder, JwtClaimsSet.from(valid).issuedAt(now.minusSeconds(1000)).expiresAt(now.minusSeconds(100)).build())));
        String token = encode(encoder, valid);
        String[] segments = token.split("\\.");
        assertThrows(JwtException.class, () -> decoder.decode(segments[0] + "." + segments[1] + "." + "A".repeat(342)));
    }
    private static String encode(JwtEncoder encoder, JwtClaimsSet claims) {
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
    }
    @Test void enforcesConfiguredAbsoluteLifetime() {
        assertThrows(IllegalArgumentException.class, () -> new IdentityProperties(null, null, null, null, null, Duration.ofDays(8), null, null));
        assertThrows(IllegalArgumentException.class, () -> new IdentityProperties(null, null, null, null, Duration.ofMillis(500), null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new IdentityProperties(null, null, null, null, Duration.ofMillis(100), Duration.ofMillis(500), null, null));
    }
}
