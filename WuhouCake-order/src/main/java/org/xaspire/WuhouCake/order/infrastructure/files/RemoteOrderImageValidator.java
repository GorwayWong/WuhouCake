package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.*;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;

/** 图片处理端负责解码，主应用只交换有界字节及结果。 */
public final class RemoteOrderImageValidator implements OrderImageValidator, AutoCloseable {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final URI endpoint;
    private final Duration deadline;
    public RemoteOrderImageValidator(URI endpoint) { this(endpoint, Duration.ofSeconds(12)); }
    public RemoteOrderImageValidator(URI endpoint, Duration deadline) {
        if (!"http".equals(endpoint.getScheme()) || endpoint.getHost() == null || endpoint.getUserInfo() != null)
            throw new IllegalArgumentException("Image worker must use an internal HTTP endpoint");
        this.endpoint = endpoint; this.deadline = deadline;
    }
    @Override public Checked validate(byte[] content, String filename) {
        CompletableFuture<HttpResponse<byte[]>> pending = null;
        try {
            var request = HttpRequest.newBuilder(endpoint).timeout(deadline).header("Content-Type", "application/octet-stream")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(ImageWorkerProtocol.request(content, filename))).build();
            pending = client.sendAsync(request, ignored -> ImageWorkerProtocol.boundedBody());
            var response = pending.get(deadline.toMillis(), TimeUnit.MILLISECONDS);
            if (response.statusCode() != 200 && response.statusCode() != 422 && response.statusCode() != 503)
                throw new IOException("Unexpected image worker status");
            return ImageWorkerProtocol.response(response.body());
        } catch (TimeoutException failure) { throw new OrderFailure("IMAGE_PROCESSING_TIMEOUT"); }
        catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new OrderFailure("IMAGE_PROCESSING_UNAVAILABLE"); }
        catch (ExecutionException failure) {
            System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING, "Image worker transport failed", failure.getCause());
            throw new OrderFailure(failure.getCause() instanceof HttpTimeoutException ? "IMAGE_PROCESSING_TIMEOUT" : "IMAGE_PROCESSING_UNAVAILABLE");
        } catch (IOException failure) {
            System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING, "Image worker response failed", failure);
            throw new OrderFailure("IMAGE_PROCESSING_UNAVAILABLE");
        }
        finally { if (pending != null && !pending.isDone()) pending.cancel(true); }
    }
    @Override public void close() { client.close(); }
}
