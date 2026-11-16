package org.xaspire.WuhouCake.order.domain.port;

public interface OrderImageValidator {
    Checked validate(byte[] content, String filename);
    /** 使用调用方剩余期限处理图片。支持远程处理的实现必须限制整个 HTTP 交换。 */
    default Checked validate(byte[] content, String filename, java.time.Duration remaining) {
        if (remaining.isZero() || remaining.isNegative()) throw new org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure("IMAGE_PROCESSING_TIMEOUT");
        return validate(content, filename);
    }

    /** content 是校验、方向纠正及压缩后的实际存储内容。 */
    record Checked(String contentType, String filename, int width, int height, byte[] content) {
        public Checked(String contentType, String filename, int width, int height) { this(contentType, filename, width, height, null); }
    }
}
