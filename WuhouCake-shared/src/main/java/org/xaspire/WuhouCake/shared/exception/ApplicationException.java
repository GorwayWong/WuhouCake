package org.xaspire.WuhouCake.shared.exception;

import java.util.Objects;

public class ApplicationException extends RuntimeException {
    private final String code;

    public ApplicationException(String code, String message) {
        super(message);
        this.code = Objects.requireNonNull(code);
    }

    public String getCode() {
        return code;
    }
}
