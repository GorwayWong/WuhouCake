package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.util.Locale;
import java.util.Arrays;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import net.coobird.thumbnailator.Thumbnails;
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
                boolean transparent = transparent(decoded);
                decoded.flush();
                double scale = Math.min(1.0, 1920.0 / Math.max(width, height));
                String output = transparent ? "png" : "jpg";
                byte[] normalized = encode(content, scale, output);
                if (mime.equals("image/png") && !transparent) {
                    byte[] png = encode(content, scale, "png");
                    if (png.length < normalized.length) { normalized = png; output = "png"; }
                }
                // 对已足够小且不需 EXIF 旋转的图片，优先保留去元数据后的无损内容。
                if (scale == 1.0 && !hasExif(content)) {
                    byte[] stripped = mime.equals("image/jpeg") ? stripJpegMetadata(content) : stripPngMetadata(content);
                    if (stripped.length <= normalized.length) { normalized = stripped; output = mime.equals("image/png") ? "png" : "jpg"; }
                }
                if (normalized.length > IMAGE_BYTES) throw new OrderFailure("IMAGE_TOO_LARGE");
                var result = ImageIO.read(new ByteArrayInputStream(normalized));
                if (result == null) throw new OrderFailure("INVALID_IMAGE");
                try {
                    String type = output.equals("png") ? "image/png" : "image/jpeg";
                    String name = displayName(filename, type).replaceFirst("(?i)\\.(jpe?g|png)$", "");
                    if (name.length() > 251) name = name.substring(0, Character.isHighSurrogate(name.charAt(250)) ? 250 : 251);
                    return new Checked(type, name + "." + output, result.getWidth(), result.getHeight(), normalized);
                } finally { result.flush(); }
            } finally { reader.dispose(); }
        } catch (IOException | IllegalArgumentException failure) { throw new OrderFailure("INVALID_IMAGE"); }
    }
    private static byte[] encode(byte[] source, double scale, String format) throws IOException {
        var output = new ByteArrayOutputStream();
        var builder = Thumbnails.of(new ByteArrayInputStream(source)).scale(scale).useExifOrientation(true).outputFormat(format);
        if (format.equals("jpg")) builder.imageType(BufferedImage.TYPE_INT_RGB).outputQuality(0.80);
        builder.toOutputStream(output);
        return output.toByteArray();
    }
    private static boolean transparent(BufferedImage image) {
        if (!image.getColorModel().hasAlpha()) return false;
        int[] pixels = new int[image.getWidth()];
        for (int y = 0; y < image.getHeight(); y++) {
            image.getRGB(0, y, image.getWidth(), 1, pixels, 0, image.getWidth());
            for (int pixel : pixels) if ((pixel >>> 24) != 255) return true;
        }
        return false;
    }
    private static boolean hasExif(byte[] bytes) {
        for (int i = 0; i + 4 < bytes.length; i++) {
            if (bytes[i] == 'E' && bytes[i + 1] == 'x' && bytes[i + 2] == 'i' && bytes[i + 3] == 'f') return true;
            if (bytes[i] == 'e' && bytes[i + 1] == 'X' && bytes[i + 2] == 'I' && bytes[i + 3] == 'f') return true;
        }
        return false;
    }
    private static byte[] stripJpegMetadata(byte[] bytes) throws IOException {
        var output = new ByteArrayOutputStream(); output.write(bytes, 0, 2);
        int offset = 2;
        while (offset + 4 <= bytes.length && (bytes[offset] & 255) == 255) {
            int marker = bytes[offset + 1] & 255;
            if (marker == 0xda || marker == 0xd9) { output.write(bytes, offset, bytes.length - offset); return output.toByteArray(); }
            int length = ((bytes[offset + 2] & 255) << 8) | (bytes[offset + 3] & 255);
            if (length < 2 || offset + 2 + length > bytes.length) throw new IOException("invalid JPEG segment");
            if (marker != 0xe1 && marker != 0xfe) output.write(bytes, offset, length + 2);
            offset += length + 2;
        }
        throw new IOException("invalid JPEG structure");
    }
    private static byte[] stripPngMetadata(byte[] bytes) throws IOException {
        var output = new ByteArrayOutputStream(); output.write(bytes, 0, 8);
        int offset = 8;
        while (offset + 12 <= bytes.length) {
            int length = java.nio.ByteBuffer.wrap(bytes, offset, 4).getInt();
            if (length < 0 || (long) offset + length + 12 > bytes.length) throw new IOException("invalid PNG chunk");
            String type = new String(bytes, offset + 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
            if (!Arrays.asList("eXIf", "tEXt", "zTXt", "iTXt").contains(type)) output.write(bytes, offset, length + 12);
            offset += length + 12;
            if (type.equals("IEND")) return output.toByteArray();
        }
        throw new IOException("invalid PNG structure");
    }
    private static String displayName(String filename, String mime) {
        if (filename == null) return mime.equals("image/png") ? "image.png" : "image.jpg";
        String name = filename.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").strip();
        if (name.isEmpty()) return mime.equals("image/png") ? "image.png" : "image.jpg";
        return name.substring(0, Math.min(name.length(), 255));
    }
}
