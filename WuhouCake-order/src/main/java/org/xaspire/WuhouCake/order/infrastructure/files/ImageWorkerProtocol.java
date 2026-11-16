package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import java.net.http.HttpRequest.BodyPublisher;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator.Checked;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImageName;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.IMAGE_BYTES;

final class ImageWorkerProtocol {
    static final int MAX_MESSAGE = IMAGE_BYTES + 2048;
    private static final int VERSION = 1;
    private ImageWorkerProtocol() { }

    static BodyPublisher request(byte[] content, String filename) throws IOException {
        if (content == null || content.length == 0) throw new OrderFailure("INVALID_IMAGE");
        if (content.length > IMAGE_BYTES) throw new OrderFailure("IMAGE_TOO_LARGE");
        var bytes = new ByteArrayOutputStream();
        var out = new DataOutputStream(bytes);
        out.writeInt(VERSION);
        out.writeUTF(OrderImageName.sourceName(filename));
        out.writeInt(content.length);
        return BodyPublishers.concat(BodyPublishers.ofByteArray(bytes.toByteArray()), BodyPublishers.ofByteArray(content));
    }
    static Checked process(InputStream source) throws IOException {
        var input = new DataInputStream(source);
        if (input.readInt() != VERSION) throw new IOException("Invalid image protocol");
        String filename = input.readUTF();
        if (filename.length() > 255) throw new IOException("Invalid image filename");
        byte[] bytes = content(input);
        if (input.read() != -1) throw new IOException("Trailing image data");
        return new JavaOrderImageValidator().validate(bytes, filename.isEmpty() ? null : filename);
    }
    static void success(OutputStream target, Checked result) throws IOException {
        var out = new DataOutputStream(target);
        out.writeInt(VERSION); out.writeUTF("");
        out.writeUTF(result.contentType()); out.writeUTF(result.filename());
        out.writeInt(result.width()); out.writeInt(result.height());
        out.writeInt(result.content().length); out.write(result.content()); out.flush();
    }
    static byte[] failure(String code) throws IOException {
        var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
        out.writeInt(VERSION); out.writeUTF(code);
        return bytes.toByteArray();
    }
    static String failureCode(Path output) throws IOException {
        try (var input = new DataInputStream(Files.newInputStream(output))) {
            if (input.readInt() != VERSION) throw new IOException("Invalid image protocol");
            return input.readUTF();
        }
    }

    static Checked response(byte[] bytes) throws IOException {
        var input = new DataInputStream(new ByteArrayInputStream(bytes));
        if (input.readInt() != VERSION) throw new IOException("Invalid image protocol");
        String failure = input.readUTF();
        if (!failure.isEmpty()) {
            if (!List.of("INVALID_IMAGE", "UNSUPPORTED_IMAGE_FORMAT", "IMAGE_TOO_LARGE", "IMAGE_DIMENSIONS_EXCEEDED",
                    "IMAGE_PROCESSING_BUSY", "IMAGE_PROCESSING_TIMEOUT", "IMAGE_PROCESSING_UNAVAILABLE").contains(failure))
                throw new IOException("Invalid image failure");
            throw new OrderFailure(failure);
        }
        String type = input.readUTF(), name = input.readUTF();
        int width = input.readInt(), height = input.readInt();
        if ((!type.equals("image/jpeg") && !type.equals("image/png")) || name.length() > 255 || width < 1 || height < 1
                || width > 1920 || height > 1920) throw new IOException("Invalid image result");
        var result = new Checked(type, name, width, height, content(input));
        if (input.read() != -1) throw new IOException("Trailing image result");
        return result;
    }
    private static byte[] content(DataInputStream input) throws IOException {
        int length = input.readInt();
        if (length < 1 || length > IMAGE_BYTES) throw new IOException("Invalid image length");
        byte[] bytes = new byte[length];
        input.readFully(bytes);
        return bytes;
    }

    static HttpResponse.BodySubscriber<byte[]> boundedBody() {
        var delegate = HttpResponse.BodySubscribers.ofByteArray();
        return new HttpResponse.BodySubscriber<>() {
            private Flow.Subscription subscription;
            private long received;
            private boolean finished;
            public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
            public void onSubscribe(Flow.Subscription value) { subscription = value; delegate.onSubscribe(value); }
            public void onNext(List<ByteBuffer> buffers) {
                if (finished) return;
                for (var buffer : buffers) received += buffer.remaining();
                if (received > MAX_MESSAGE) {
                    finished = true; subscription.cancel(); delegate.onError(new IOException("Image response too large"));
                } else delegate.onNext(buffers);
            }
            public void onError(Throwable failure) { if (!finished) { finished = true; delegate.onError(failure); } }
            public void onComplete() { if (!finished) { finished = true; delegate.onComplete(); } }
        };
    }
}
