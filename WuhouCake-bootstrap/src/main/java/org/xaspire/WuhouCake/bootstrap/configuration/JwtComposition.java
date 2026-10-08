package org.xaspire.WuhouCake.bootstrap.configuration;

import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.nio.file.*;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.*;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.AccessTokens;
import org.xaspire.WuhouCake.identity.infrastructure.gateway.NimbusAccessTokens;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class JwtComposition {
    @Bean RSAKey identityRsaKey(IdentityProperties properties) throws Exception {
        if (properties.privateKey() == null || properties.privateKey().isBlank() || properties.publicKey() == null || properties.publicKey().isBlank())
            throw new IllegalArgumentException("Configure wuhoucake.identity.private-key and public-key");
        var factory = KeyFactory.getInstance("RSA");
        var privateKey = (RSAPrivateKey) factory.generatePrivate(new PKCS8EncodedKeySpec(pem(SecureFiles.readPrivate(Path.of(properties.privateKey())))));
        var publicKey = (RSAPublicKey) factory.generatePublic(new X509EncodedKeySpec(pem(Files.readString(Path.of(properties.publicKey())))));
        if (!privateKey.getModulus().equals(publicKey.getModulus()) || publicKey.getModulus().bitLength() < 2048)
            throw new IllegalArgumentException("Matching RSA keys of at least 2048 bits required");
        return new RSAKey.Builder(publicKey).privateKey(privateKey).keyID("wuhoucake").build();
    }
    private static byte[] pem(String value) { return Base64.getDecoder().decode(value.replaceAll("-----[^-]+-----", "").replaceAll("\\s", "")); }
    @Bean JwtEncoder jwtEncoder(RSAKey key) { return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key))); }
    @Bean AccessTokens accessTokens(JwtEncoder encoder, IdentityProperties properties) { return new NimbusAccessTokens(encoder, properties.issuer(), properties.audience()); }
    @Bean JwtDecoder jwtDecoder(RSAKey key, IdentityProperties properties, Clock clock) throws Exception {
        var decoder = NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).signatureAlgorithm(SignatureAlgorithm.RS256).build();
        var timestamps = new JwtTimestampValidator(Duration.ofSeconds(60)); timestamps.setClock(clock);
        OAuth2TokenValidator<Jwt> required = jwt -> {
            try {
                UUID.fromString(jwt.getSubject()); UUID.fromString(jwt.getClaimAsString("sid"));
                Object version = jwt.getClaim("ver");
                if (!(version instanceof Number number) || number.longValue() < 0 || number.doubleValue() != number.longValue()
                        || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                        || jwt.getAudience() == null || !jwt.getAudience().contains(properties.audience())) throw new IllegalArgumentException();
                return OAuth2TokenValidatorResult.success();
            } catch (RuntimeException failure) { return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token")); }
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamps, new JwtIssuerValidator(properties.issuer()), required));
        return decoder;
    }
}
