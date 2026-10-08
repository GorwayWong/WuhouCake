package org.xaspire.WuhouCake.identity.domain.model.valobj;

public final class IdentityFailure extends RuntimeException {
    private final String code;
    public IdentityFailure(String code) { super(code); this.code = code; }
    public String code() { return code; }
}
