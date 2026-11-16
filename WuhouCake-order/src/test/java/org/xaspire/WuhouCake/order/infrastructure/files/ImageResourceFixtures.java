package org.xaspire.WuhouCake.order.infrastructure.files;

import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.Random;
import javax.imageio.*;
import javax.imageio.stream.FileImageOutputStream;

/** 生成受限资源验收的合成图片；单独运行，避免样本生成占用被测进程的堆。 */
public final class ImageResourceFixtures {
    private ImageResourceFixtures() { }
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]); Files.createDirectories(directory);
        var source = new BufferedImage(6000, 4000, BufferedImage.TYPE_INT_RGB);
        var random = new Random(42);
        for (int y = 0; y < source.getHeight(); y++) {
            int[] row = new int[source.getWidth()];
            for (int x = 0; x < row.length; x++) {
                int noise = random.nextInt(32), red = (x / 24 + noise) & 255, green = (y / 16 + noise) & 255;
                row[x] = (red << 16) | (green << 8) | ((x / 32 + y / 32 + noise) & 255);
            }
            source.setRGB(0, y, row.length, 1, row, 0, row.length);
        }
        for (int i = 0; i < 7; i++) {
            var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
            var options = writer.getDefaultWriteParam();
            options.setCompressionMode(ImageWriteParam.MODE_EXPLICIT); options.setCompressionQuality(0.65f);
            if (i >= 5) options.setProgressiveMode(ImageWriteParam.MODE_DEFAULT);
            Path path = directory.resolve("phone-" + i + ".jpg");
            Files.deleteIfExists(path);
            try (var output = new FileImageOutputStream(path.toFile())) {
                writer.setOutput(output); writer.write(null, new IIOImage(source, null, null), options);
            } finally { writer.dispose(); }
            if (Files.size(path) > 5 * 1024 * 1024) throw new IllegalStateException("Fixture exceeds input limit");
            System.out.println(path.getFileName() + " 6000x4000 bytes=" + Files.size(path));
        }
        source.flush();
    }
}
