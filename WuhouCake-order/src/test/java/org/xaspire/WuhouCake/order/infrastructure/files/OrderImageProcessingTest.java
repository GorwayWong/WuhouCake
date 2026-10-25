package org.xaspire.WuhouCake.order.infrastructure.files;

import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Random;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class OrderImageProcessingTest {
    private final JavaOrderImageValidator processor = new JavaOrderImageValidator();

    @Test void largePhotoShrinksInBothResolutionAndBytesWithoutChangingAspectRatio() throws Exception {
        var image = new BufferedImage(3000, 2000, BufferedImage.TYPE_INT_RGB);
        var random = new Random(42);
        for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) image.setRGB(x, y, random.nextInt(0x1000000));
        byte[] original = encoded(image, "jpg"); image.flush();
        var result = processor.validate(original, "手机照片.jpg");
        assertEquals(1920, result.width()); assertEquals(1280, result.height());
        assertEquals("image/jpeg", result.contentType()); assertTrue(result.content().length < original.length * 0.65);
        var decoded = ImageIO.read(new ByteArrayInputStream(result.content()));
        assertEquals(1920, decoded.getWidth()); assertEquals(1280, decoded.getHeight()); decoded.flush();
    }
    @Test void transparentPngKeepsAlphaAndSmallImagesAreNotEnlarged() throws Exception {
        var image = new BufferedImage(48, 24, BufferedImage.TYPE_INT_ARGB);
        image.setRGB(20, 10, 0x80ff0000);
        byte[] original = encoded(image, "png"); image.flush();
        var result = processor.validate(original, "透明图.png");
        assertEquals("image/png", result.contentType()); assertEquals(48, result.width()); assertEquals(24, result.height());
        assertTrue(result.content().length <= original.length);
        var decoded = ImageIO.read(new ByteArrayInputStream(result.content()));
        assertEquals(0, decoded.getRGB(0, 0) >>> 24); assertEquals(128, decoded.getRGB(20, 10) >>> 24); decoded.flush();
    }
    @Test void phoneExifRotationIsAppliedBeforeMetadataIsDiscarded() throws Exception {
        var image = new BufferedImage(80, 40, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < 40; y++) for (int x = 0; x < 80; x++) image.setRGB(x, y, y < 20 ? 0xff0000 : 0x0000ff);
        byte[] jpeg = encoded(image, "jpg"); image.flush();
        byte[] exif = new byte[] {'E','x','i','f',0,0,'I','I',42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0};
        var source = new ByteArrayOutputStream(); source.write(jpeg, 0, 2); source.write(new byte[] {(byte) 255, (byte) 225, 0, 34});
        source.write(exif); source.write(jpeg, 2, jpeg.length - 2);
        var result = processor.validate(source.toByteArray(), "手机.jpg");
        assertEquals(40, result.width()); assertEquals(80, result.height());
        assertFalse(new String(result.content(), StandardCharsets.ISO_8859_1).contains("Exif"));
        var decoded = ImageIO.read(new ByteArrayInputStream(result.content()));
        int pixel = decoded.getRGB(5, 40); assertTrue((pixel & 255) > 150); assertTrue(((pixel >> 16) & 255) < 100); decoded.flush();
    }
    private static byte[] encoded(BufferedImage image, String format) throws IOException {
        var output = new ByteArrayOutputStream(); assertTrue(ImageIO.write(image, format, output)); return output.toByteArray();
    }
}
