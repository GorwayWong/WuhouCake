package org.xaspire.WuhouCake.order.infrastructure.files;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.LongAdder;
import java.util.*;
import java.util.concurrent.*;

/** 监督进程不解码图片；限制并发并在墙钟期限后终止解码子进程。 */
public final class ImageWorkerServer implements AutoCloseable {
    private final HttpServer server;
    private final Semaphore admission = new Semaphore(1);
    private final ScheduledThreadPoolExecutor timer = new ScheduledThreadPoolExecutor(1);
    private final ExecutorService requests = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(4), new ThreadPoolExecutor.AbortPolicy());
    private final List<String> command;
    private final Duration deadline;
    private volatile Process running;
    private final Path tempDirectory;
    private final Runnable restart;
    private final LongAdder requestsAdmitted = new LongAdder();
    private final LongAdder requestsRejected = new LongAdder();
    private final LongAdder decoderSuccesses = new LongAdder();
    private final LongAdder decoderTimeouts = new LongAdder();
    private final LongAdder decoderFailures = new LongAdder();
    private final LongAdder childAbnormalExits = new LongAdder();
    private final LongAdder cleanupFailures = new LongAdder();
    private final LongAdder elapsedNanos = new LongAdder();
    private volatile boolean failed;
    private boolean closed;

    public ImageWorkerServer(InetSocketAddress address, List<String> command, Duration deadline) throws IOException {
        this(address, command, deadline, Path.of(System.getProperty("java.io.tmpdir")),
                () -> Runtime.getRuntime().halt(70));
    }

    ImageWorkerServer(InetSocketAddress address, List<String> command, Duration deadline, Path tempDirectory,
            Runnable restart) throws IOException {
        this.command = List.copyOf(command);
        this.deadline = deadline;
        this.tempDirectory = tempDirectory;
        this.restart = restart;
        timer.setRemoveOnCancelPolicy(true);
        server = HttpServer.create(address, 8);
        server.createContext("/health", exchange -> { try (exchange) { exchange.sendResponseHeaders(failed ? 503 : 200, -1); } });
        server.createContext("/process", this::process);
        server.createContext("/metrics", this::metrics);
        server.setExecutor(requests);
    }
    public static List<String> decoderCommand() {
        return List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(), "-Xms16m", "-Xmx128m",
                "-XX:MaxDirectMemorySize=8m", "-XX:MaxMetaspaceSize=32m", "-XX:ReservedCodeCacheSize=16m",
                "-Xss512k", "-XX:+UseSerialGC", "-XX:CICompilerCount=2", "-XX:ActiveProcessorCount=1", "-XX:+ExitOnOutOfMemoryError", "-Djava.awt.headless=true",
                "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")), ImageWorkerMain.class.getName());
    }
    public void start() { server.start(); }
    public int port() { return server.getAddress().getPort(); }
    private void process(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("POST") || !exchange.getRequestURI().getPath().equals("/process")) {
            try (exchange) { exchange.sendResponseHeaders(404, -1); } return;
        }
        if (failed || !admission.tryAcquire()) {
            requestsRejected.increment();
            try (exchange) { respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_BUSY")); }
            System.getLogger(getClass().getName()).log(System.Logger.Level.INFO, "image_processing outcome=busy");
            return;
        }
        requestsAdmitted.increment();
        try (exchange) {
            try {
                var expiry = timer.schedule(exchange::close, deadline.toMillis() + 2000, TimeUnit.MILLISECONDS);
                try { decode(exchange); }
                finally { expiry.cancel(false); }
            } finally {
                admission.release();
            }
        }
    }

    private void decode(HttpExchange exchange) throws IOException {
        long started = System.nanoTime();
        String outcome = "unavailable";
        Path input = null;
        Path output = null;
        Process child = null;
        try {
            input = Files.createTempFile(tempDirectory, "image-input-", ".bin");
            output = Files.createTempFile(tempDirectory, "image-output-", ".bin");
            if (!stageRequest(exchange.getRequestBody(), input)) {
                outcome = "too_large";
                respond(exchange, 422, ImageWorkerProtocol.failure("IMAGE_TOO_LARGE"));
                return;
            }
            long remaining = deadline.toNanos() - (System.nanoTime() - started);
            if (remaining > 0) {
                child = launch(input, output);
                remaining = deadline.toNanos() - (System.nanoTime() - started);
            }
            if (remaining <= 0 || !child.waitFor(remaining, TimeUnit.NANOSECONDS)) {
                outcome = "timeout";
                decoderTimeouts.increment();
                if (child != null) stopDecoder(child);
                respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_TIMEOUT"));
                return;
            }
            long size = Files.size(output);
            if (child.exitValue() != 0 || size == 0 || size > ImageWorkerProtocol.MAX_MESSAGE) {
                outcome = "process_exit_" + child.exitValue();
                if (child.exitValue() != 0) childAbnormalExits.increment();
                respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_UNAVAILABLE"));
                return;
            }
            String code = ImageWorkerProtocol.failureCode(output);
            exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
            // Closing the chunked response signals completion after cleanup and permit release.
            exchange.sendResponseHeaders(200, 0);
            Files.copy(output, exchange.getResponseBody());
            if (code.isEmpty()) {
                decoderSuccesses.increment();
                outcome = "completed";
            } else {
                outcome = "rejected_image";
            }
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_UNAVAILABLE"));
        } catch (IOException failure) {
            if (exchange.getResponseCode() != -1) throw failure;
            System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING, "Image worker I/O failed", failure);
            respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_UNAVAILABLE"));
        } finally {
            try {
                if (child != null && !failed) stopDecoder(child);
            } finally {
                deleteTemporary(input);
                deleteTemporary(output);
                long elapsed = System.nanoTime() - started;
                elapsedNanos.add(elapsed);
                if (!outcome.equals("completed")) decoderFailures.increment();
                System.getLogger(getClass().getName()).log(System.Logger.Level.INFO,
                        "image_processing outcome=" + outcome + " elapsed_ms=" + TimeUnit.NANOSECONDS.toMillis(elapsed));
            }
        }
    }

    private static boolean stageRequest(InputStream source, Path input) throws IOException {
        try (var target = Files.newOutputStream(input)) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > ImageWorkerProtocol.MAX_MESSAGE) return false;
                target.write(buffer, 0, count);
            }
            return true;
        }
    }

    private synchronized Process launch(Path input, Path output) throws IOException {
        if (closed) throw new IOException("Image worker is shutting down");
        var builder = new ProcessBuilder(command).redirectInput(input.toFile()).redirectOutput(output.toFile())
                .redirectError(ProcessBuilder.Redirect.DISCARD);
        builder.environment().remove("JAVA_TOOL_OPTIONS");
        builder.environment().remove("JDK_JAVA_OPTIONS");
        builder.environment().remove("_JAVA_OPTIONS");
        running = builder.start();
        return running;
    }

    private void deleteTemporary(Path path) {
        if (path == null) return;
        try { Files.deleteIfExists(path); }
        catch (IOException failure) {
            cleanupFailures.increment();
            System.getLogger(getClass().getName()).log(System.Logger.Level.ERROR, "Image worker temporary cleanup failed", failure);
            restartWorker();
        }
    }

    private void stopDecoder(Process child) {
        terminateOrRestart(child, Duration.ofSeconds(2), this::restartWorker);
        synchronized (this) {
            if (running == child && !child.isAlive()) running = null;
        }
    }

    private synchronized void restartWorker() {
        if (failed) return;
        failed = true;
        restart.run();
    }

    private void metrics(HttpExchange exchange) throws IOException {
        try (exchange) {
            long usableBytes = -1;
            try { usableBytes = Files.getFileStore(tempDirectory).getUsableSpace(); }
            catch (IOException ignored) { /* The failed mount is reported using -1. */ }
            String samples = "wuhou_image_worker_active " + (1 - admission.availablePermits()) + "\n"
                    + "wuhou_image_worker_admitted_total " + requestsAdmitted.sum() + "\n"
                    + "wuhou_image_worker_rejected_total " + requestsRejected.sum() + "\n"
                    + "wuhou_image_worker_success_total " + decoderSuccesses.sum() + "\n"
                    + "wuhou_image_worker_timeout_total " + decoderTimeouts.sum() + "\n"
                    + "wuhou_image_worker_failed_total " + decoderFailures.sum() + "\n"
                    + "wuhou_image_worker_abnormal_exit_total " + childAbnormalExits.sum() + "\n"
                    + "wuhou_image_worker_cleanup_failed_total " + cleanupFailures.sum() + "\n"
                    + "wuhou_image_worker_processing_seconds_total " + elapsedNanos.sum() / 1_000_000_000.0 + "\n"
                    + "wuhou_image_worker_tmp_free_bytes " + usableBytes + "\n";
            byte[] bytes = samples.getBytes(StandardCharsets.US_ASCII);
            exchange.getResponseHeaders().set("Content-Type", "text/plain; version=0.0.4");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }

    private static void respond(HttpExchange exchange, int status, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
        exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes);
    }
    static void terminateOrRestart(Process process, Duration grace, Runnable restart) {
        if (!process.isAlive()) return;
        try { process.destroyForcibly(); }
        catch (RuntimeException failure) {
            System.getLogger(ImageWorkerServer.class.getName()).log(System.Logger.Level.ERROR, "Cannot kill image decoder", failure);
            restart.run();
            return;
        }
        boolean interrupted = false;
        long end = System.nanoTime() + grace.toNanos();
        try {
            while (process.isAlive()) {
                long remaining = end - System.nanoTime();
                if (remaining <= 0) {
                    System.getLogger(ImageWorkerServer.class.getName()).log(System.Logger.Level.ERROR, "Image decoder did not exit after force kill");
                    restart.run();
                    return;
                }
                try { process.waitFor(remaining, TimeUnit.NANOSECONDS); }
                catch (InterruptedException failure) { interrupted = true; }
            }
        } finally { if (interrupted) Thread.currentThread().interrupt(); }
    }
    @Override public void close() {
        synchronized (this) { closed = true; }
        server.stop(0);
        requests.shutdownNow();
        timer.shutdownNow();
        var child = running;
        if (child != null) stopDecoder(child);
    }
    public static void main(String[] args) throws IOException {
        var probe = Files.createTempFile("image-worker-startup-", ".probe");
        Files.delete(probe);
        var server = new ImageWorkerServer(new InetSocketAddress(8091), decoderCommand(), Duration.ofSeconds(10));
        Runtime.getRuntime().addShutdownHook(new Thread(server::close)); server.start();
    }
}
