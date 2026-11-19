package org.xaspire.WuhouCake.order.infrastructure.files;

import com.sun.net.httpserver.HttpServer;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.junit.jupiter.api.Assertions.*;

class ImageWorkerTest {
    private static byte[] picture() throws IOException {
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(24, 12, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return bytes.toByteArray();
    }
    private static URI endpoint(ImageWorkerServer server) { return URI.create("http://127.0.0.1:" + server.port() + "/process"); }
    @Test void batchKeepsAdmissionBetweenImagesAndReleasesItOnFailure() throws Exception {
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), ImageWorkerServer.decoderCommand(), Duration.ofSeconds(5));
                var validator = new RemoteOrderImageValidator(endpoint(server));
                var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            server.start();
            byte[] image = picture();
            var betweenImages = new CountDownLatch(1);
            var resume = new CountDownLatch(1);
            var batch = executor.submit(() -> validator.inBatch(() -> {
                assertEquals(24, validator.validate(image, "first.png").width());
                betweenImages.countDown();
                try { assertTrue(resume.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new AssertionError(failure); }
                return validator.validate(image, "second.png");
            }));
            try {
                assertTrue(betweenImages.await(5, TimeUnit.SECONDS));
                assertEquals("IMAGE_PROCESSING_BUSY",
                        assertThrows(OrderFailure.class, () -> validator.validate(image, "ordinary.png")).code());
                assertEquals("IMAGE_PROCESSING_BUSY",
                        assertThrows(OrderFailure.class, () -> validator.inBatch(() -> fail("busy batch started"))).code());
            } finally { resume.countDown(); }
            assertEquals(24, batch.get(5, TimeUnit.SECONDS).width());
            assertEquals("IMAGE_PROCESSING_TIMEOUT", assertThrows(OrderFailure.class,
                    () -> validator.inBatch(() -> validator.validate(image, "expired.png", Duration.ZERO))).code());
            assertEquals("UNSUPPORTED_IMAGE_FORMAT", assertThrows(OrderFailure.class,
                    () -> validator.inBatch(() -> validator.validate(new byte[]{1}, "broken.png"))).code());
            assertEquals(24, validator.validate(image, "after-batch.png").width());
        }
    }

    @Test void isolatedDecoderPreservesImagesAndRejectsDamagedContent() throws Exception {
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), ImageWorkerServer.decoderCommand(), Duration.ofSeconds(5))) {
            server.start();
            try (var validator = new RemoteOrderImageValidator(endpoint(server))) {
                var result = validator.validate(picture(), "cake.png");
                assertEquals(24, result.width()); assertEquals(12, result.height());
                assertNotNull(ImageIO.read(new ByteArrayInputStream(result.content())));
                assertEquals("UNSUPPORTED_IMAGE_FORMAT", assertThrows(OrderFailure.class, () -> validator.validate(new byte[]{1,2,3}, "bad.jpg")).code());
                try (var client = HttpClient.newHttpClient()) {
                    var oversized = HttpRequest.newBuilder(endpoint(server)).POST(HttpRequest.BodyPublishers.ofByteArray(
                            new byte[ImageWorkerProtocol.MAX_MESSAGE + 1])).build();
                    assertEquals(422, client.send(oversized, HttpResponse.BodyHandlers.discarding()).statusCode());
                }
                assertCounters(server, 1, 2, 0, 0, 0);
            }
        }
    }
    @Test void maximumPixelTransparentPngFitsTheDecoderHeapAndKeepsAlpha() throws Exception {
        var source = new BufferedImage(6000, 4000, BufferedImage.TYPE_INT_ARGB);
        var graphics = source.createGraphics();
        graphics.setColor(new java.awt.Color(20, 60, 120, 127)); graphics.fillRect(0, 0, 6000, 4000); graphics.dispose();
        var encoded = new ByteArrayOutputStream(); ImageIO.write(source, "png", encoded); source.flush();
        assertTrue(encoded.size() < 5 * 1024 * 1024);
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), ImageWorkerServer.decoderCommand(), Duration.ofSeconds(10))) {
            server.start();
            try (var validator = new RemoteOrderImageValidator(endpoint(server))) {
                var result = validator.validate(encoded.toByteArray(), "large-transparent.png");
                assertEquals("image/png", result.contentType()); assertEquals(1920, result.width()); assertEquals(1280, result.height());
                var decoded = ImageIO.read(new ByteArrayInputStream(result.content()));
                assertEquals(127, decoded.getRGB(100, 100) >>> 24); decoded.flush();
            }
        }
    }
    @Test void sixteenBitTransparentPngDoesNotExhaustTheDecoderHeap() throws Exception {
        var png = new ByteArrayOutputStream();
        try (var output = new DataOutputStream(png)) {
            output.writeLong(0x89504e470d0a1a0aL);
            var header = java.nio.ByteBuffer.allocate(13);
            header.putInt(3838).putInt(3838).put((byte) 16).put((byte) 6);
            chunk(output, "IHDR", header.array());
            var compressed = new ByteArrayOutputStream();
            try (var deflate = new java.util.zip.DeflaterOutputStream(compressed)) {
                byte[] row = new byte[1 + 3838 * 8];
                for (int pixel = 0; pixel < 3838; pixel++) row[1 + pixel * 8 + 6] = 127;
                for (int y = 0; y < 3838; y++) deflate.write(row);
            }
            chunk(output, "IDAT", compressed.toByteArray());
            chunk(output, "IEND", new byte[0]);
        }
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), ImageWorkerServer.decoderCommand(), Duration.ofSeconds(10));
                var validator = new RemoteOrderImageValidator(endpoint(server))) {
            server.start();
            var result = validator.validate(png.toByteArray(), "sixteen-bit.png");
            assertEquals("image/png", result.contentType());
            assertEquals(1920, result.width());
            assertEquals(1920, result.height());
            var decoded = ImageIO.read(new ByteArrayInputStream(result.content()));
            assertEquals(127, decoded.getRGB(100, 100) >>> 24);
        }
    }

    private static void chunk(DataOutputStream output, String name, byte[] content) throws IOException {
        byte[] type = name.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        var crc = new java.util.zip.CRC32();
        crc.update(type);
        crc.update(content);
        output.writeInt(content.length);
        output.write(type);
        output.write(content);
        output.writeInt((int) crc.getValue());
    }
    @Test void hungDecoderIsKilledAndCapacityIsAvailableForNextImage() throws Exception {
        var command = new ArrayList<>(ImageWorkerServer.decoderCommand());
        command.set(command.size() - 1, DecoderFixture.class.getName());
        var pidFile = Files.createTempFile("image-worker-test-", ".pid");
        command.add(pidFile.toString());
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), command, Duration.ofSeconds(2))) {
            server.start();
            try (var validator = new RemoteOrderImageValidator(endpoint(server), Duration.ofSeconds(4))) {
                byte[] image = picture();
                try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                    var hung = executor.submit(() -> validator.validate(image, "hang.png"));
                    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                    while (Files.size(pidFile) == 0 && System.nanoTime() < end) Thread.sleep(10);
                    assertTrue(Files.size(pidFile) > 0, "decoder must start before checking admission");
                    long pid = Long.parseLong(Files.readString(pidFile));
                    assertEquals("IMAGE_PROCESSING_BUSY", assertThrows(OrderFailure.class, () -> validator.validate(image, "busy.png")).code());
                    var failure = assertThrows(ExecutionException.class, () -> hung.get(4, TimeUnit.SECONDS));
                    assertEquals("IMAGE_PROCESSING_TIMEOUT", ((OrderFailure) failure.getCause()).code());
                    assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
                    assertEquals(24, validator.validate(image, "next.png").width());
                    assertEquals("IMAGE_PROCESSING_UNAVAILABLE", assertThrows(OrderFailure.class, () -> validator.validate(image, "crash.png")).code());
                    assertEquals(24, validator.validate(image, "after-crash.png").width());
                    assertEquals("IMAGE_PROCESSING_UNAVAILABLE", assertThrows(OrderFailure.class, () -> validator.validate(image, "oom.png")).code());
                    assertEquals(24, validator.validate(image, "after-oom.png").width());
                    assertEquals("IMAGE_PROCESSING_UNAVAILABLE", assertThrows(OrderFailure.class,
                            () -> validator.validate(image, "malformed.png")).code());
                    assertCounters(server, 3, 0, 1, 3, 0);
                }
            }
        } finally { Files.deleteIfExists(pidFile); }
    }
    private static void assertCounters(ImageWorkerServer server, long success, long invalid, long timeout,
                                       long failure, long busy) throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(endpoint(server).resolve("/metrics")).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            var expected = Map.of("admitted", success + invalid + timeout + failure, "success", success,
                    "invalid_input", invalid, "timeout", timeout, "failed", failure, "rejected", busy);
            expected.forEach((counter, value) -> assertTrue(response.body().lines().anyMatch(line ->
                    line.equals("wuhou_image_worker_" + counter + "_total " + value)), response.body()));
        }
    }

    @Test void clientDeadlineIncludesResponseBodyAndDoesNotDecodeOnFailure() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var release = new CountDownLatch(1);
        server.createContext("/process", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(200, 100);
                exchange.getResponseBody().write(1); exchange.getResponseBody().flush();
                try { release.await(3, TimeUnit.SECONDS); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
            }
        });
        server.start();
        try (var validator = new RemoteOrderImageValidator(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/process"), Duration.ofSeconds(5))) {
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> assertEquals("IMAGE_PROCESSING_TIMEOUT",
                    assertThrows(OrderFailure.class, () -> validator.validate(picture(), "cake.png", Duration.ofMillis(200))).code()));
        } finally { release.countDown(); server.stop(0); }
    }
    @Test void supervisorRequestsRestartWhenForceKillCannotReapTheDecoder() throws Exception {
        var child = org.mockito.Mockito.mock(Process.class);
        org.mockito.Mockito.when(child.isAlive()).thenReturn(true);
        var restarts = new java.util.concurrent.atomic.AtomicInteger();
        ImageWorkerServer.terminateOrRestart(child, Duration.ofMillis(20), restarts::incrementAndGet);
        org.mockito.Mockito.verify(child).destroyForcibly();
        assertEquals(1, restarts.get());
    }

    @Test void temporaryStorageFailureReturnsUnavailableAndReleasesCapacity() throws Exception {
        var dir = Files.createTempDirectory("image-worker-test-");
        Files.delete(dir);
        try (var server = new ImageWorkerServer(new InetSocketAddress("127.0.0.1", 0), ImageWorkerServer.decoderCommand(),
                Duration.ofSeconds(5), dir, () -> fail("a storage failure must not restart the worker"))) {
            server.start();
            try (var validator = new RemoteOrderImageValidator(endpoint(server))) {
                assertEquals("IMAGE_PROCESSING_UNAVAILABLE", assertThrows(OrderFailure.class,
                        () -> validator.validate(picture(), "cake.png")).code());
                Files.createDirectory(dir);
                assertEquals(24, validator.validate(picture(), "cake.png").width());
                try (var files = Files.list(dir)) { assertEquals(0, files.count()); }
            }
        } finally { Files.deleteIfExists(dir); }
    }
    public static class DecoderFixture {
        public static void main(String[] args) throws Exception {
            byte[] input = System.in.readNBytes(ImageWorkerProtocol.MAX_MESSAGE);
            var data = new DataInputStream(new ByteArrayInputStream(input)); data.readInt(); String filename = data.readUTF();
            if (filename.equals("hang.png")) {
                Files.writeString(Path.of(args[0]), Long.toString(ProcessHandle.current().pid()));
                while (true) { try { Thread.sleep(1000); } catch (InterruptedException ignored) { } }
            }
            if (filename.equals("malformed.png")) {
                System.out.write(ImageWorkerProtocol.failure(""));
                return;
            }
            if (filename.equals("crash.png")) System.exit(23);
            if (filename.equals("oom.png")) {
                var retained = new ArrayList<byte[]>();
                while (true) retained.add(new byte[8 * 1024 * 1024]);
            }
            ImageWorkerProtocol.success(System.out, ImageWorkerProtocol.process(new ByteArrayInputStream(input)));
        }
    }
}
