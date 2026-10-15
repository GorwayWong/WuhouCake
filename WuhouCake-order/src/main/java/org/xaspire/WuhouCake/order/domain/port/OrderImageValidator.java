package org.xaspire.WuhouCake.order.domain.port;

public interface OrderImageValidator {
    Checked validate(byte[] content, String filename);
    record Checked(String contentType, String filename, int width, int height) { }
}
