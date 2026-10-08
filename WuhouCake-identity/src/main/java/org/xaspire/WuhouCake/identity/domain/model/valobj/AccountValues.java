package org.xaspire.WuhouCake.identity.domain.model.valobj;

import java.util.Locale;
import java.util.UUID;

public final class AccountValues {
    private AccountValues() { }
    public enum JobRole { MANAGER, FRONT_DESK, PASTRY_CHEF }
    public enum SystemRole { STAFF, SUPER_ADMIN }
    public enum Status { ACTIVE, ARCHIVED }
    public record Actor(UUID accountId, long credentialVersion, String requestId) { }

    public static String employeeNumber(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,32}")) throw new IdentityFailure("VALIDATION_FAILED");
        return value.toUpperCase(Locale.ROOT);
    }
    public static String nickname(String value) {
        if (value == null) throw new IdentityFailure("VALIDATION_FAILED");
        String cleaned = value.strip();
        int length = cleaned.codePointCount(0, cleaned.length());
        if (length < 1 || length > 40 || !validUnicode(cleaned) || cleaned.codePoints().anyMatch(Character::isISOControl))
            throw new IdentityFailure("VALIDATION_FAILED");
        return cleaned;
    }
    public static void password(String value) {
        if (value == null) throw new IdentityFailure("VALIDATION_FAILED");
        int length = value.codePointCount(0, value.length());
        if (length < 15 || length > 128 || !validUnicode(value)) throw new IdentityFailure("VALIDATION_FAILED");
    }
    public static boolean validUnicode(String value) {
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (Character.isHighSurrogate(character)) {
                if (++i == value.length() || !Character.isLowSurrogate(value.charAt(i))) return false;
            } else if (Character.isLowSurrogate(character)) return false;
        }
        return true;
    }
    public static void pagination(int page, int size) {
        if (page < 1 || size < 1 || size > 100 || page > 1_000_000) throw new IdentityFailure("VALIDATION_FAILED");
    }
}
