package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public final class JavaOrderImageValidator implements OrderImageValidator {
    @Override public Checked validate(byte[] content, String filename) {
        if (content == null || content.length == 0) throw new OrderFailure("INVALID_IMAGE");
        if (content.length > IMAGE_BYTES) throw new OrderFailure("IMAGE_TOO_LARGE");
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(content))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw new OrderFailure("UNSUPPORTED_IMAGE_FORMAT");
            var reader = readers.next();
            try {
                var format = reader.getFormatName().toLowerCase(Locale.ROOT);
                String mime = switch (format) {
                    case "jpeg", "jpg" -> "image/jpeg";
                    case "png" -> "image/png";
                    default -> throw new OrderFailure("UNSUPPORTED_IMAGE_FORMAT");
                };
                reader.setInput(input, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > IMAGE_DIMENSION || height > IMAGE_DIMENSION
                        || (long) width * height > IMAGE_PIXELS) throw new OrderFailure("IMAGE_DIMENSIONS_EXCEEDED");
                // JPEG 解码器会尝试恢复截断数据；任何解码警告均拒绝，避免保存不完整图片。
                reader.addIIOReadWarningListener((source, warning) -> { throw new OrderFailure("INVALID_IMAGE"); });
                var decoded = reader.read(0);
                if (decoded == null) throw new OrderFailure("INVALID_IMAGE");
                decoded.flush();
                return new Checked(mime, displayName(filename, mime), width, height);
            } finally { reader.dispose(); }
        } catch (IOException | IllegalArgumentException failure) { throw new OrderFailure("INVALID_IMAGE"); }
    }
    private static String displayName(String filename, String mime) {
        if (filename == null) return mime.equals("image/png") ? "image.png" : "image.jpg";
        String name = filename.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").strip();
        if (name.isEmpty()) return mime.equals("image/png") ? "image.png" : "image.jpg";
        return name.substring(0, Math.min(name.length(), 255));
    }
}
