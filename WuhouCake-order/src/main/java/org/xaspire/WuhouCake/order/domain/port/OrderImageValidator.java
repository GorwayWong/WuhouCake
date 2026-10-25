package org.xaspire.WuhouCake.order.domain.port;

public interface OrderImageValidator {
    Checked validate(byte[] content, String filename);
    /** content 是校验、方向纠正及压缩后的实际存储内容。 */
    record Checked(String contentType, String filename, int width, int height, byte[] content) {
        public Checked(String contentType, String filename, int width, int height) { this(contentType, filename, width, height, null); }
    }
}
