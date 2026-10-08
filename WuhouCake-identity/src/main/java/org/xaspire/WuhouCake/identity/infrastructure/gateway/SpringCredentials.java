package org.xaspire.WuhouCake.identity.infrastructure.gateway;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.Credentials;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues;

public final class SpringCredentials implements Credentials {
    private final PasswordEncoder encoder;
    private final SecureRandom random = new SecureRandom();
    public SpringCredentials(PasswordEncoder encoder) { this.encoder = encoder; }
    @Override public String encode(String password) { return encoder.encode(password); }
    @Override public boolean matches(String password, String encoded) { return AccountValues.validUnicode(password) && encoder.matches(password, encoded); }
    @Override public String temporaryPassword() { return random(15); }
    @Override public String secret() { return random(32); }
    private String random(int length) {
        byte[] bytes = new byte[length]; random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    @Override public String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException failure) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
    @Override public boolean matchesDigest(String value, String expected) {
        return MessageDigest.isEqual(digest(value).getBytes(StandardCharsets.US_ASCII), expected.getBytes(StandardCharsets.US_ASCII));
    }
}
