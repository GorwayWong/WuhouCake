package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.IOException;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;

/** 单张图片的独立解码进程；标准输入/输出仅使用内部二进制协议。 */
public final class ImageWorkerMain {
    private ImageWorkerMain() { }
    public static void main(String[] args) throws IOException {
        try { ImageWorkerProtocol.success(System.out, ImageWorkerProtocol.process(System.in)); }
        catch (OrderFailure failure) { System.out.write(ImageWorkerProtocol.failure(failure.code())); }
        catch (IOException | RuntimeException failure) { System.out.write(ImageWorkerProtocol.failure("IMAGE_PROCESSING_UNAVAILABLE")); }
    }
}
