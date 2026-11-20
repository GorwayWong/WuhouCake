package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.Duration;
import java.util.HashSet;
import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;
import org.xaspire.WuhouCake.order.domain.port.OrderImages;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator;
import org.xaspire.WuhouCake.order.domain.port.SubmissionImages;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public class SubmissionImageService {
    private final SubmissionImages staged;
    private final OrderImages orders;
    private final OrderImageValidator validator;
    private final Clock clock;

    public SubmissionImageService(SubmissionImages staged, OrderImages orders, OrderImageValidator validator, Clock clock) {
        this.staged = staged; this.orders = orders; this.validator = validator; this.clock = clock;
    }

    public UUID stage(UUID entry, UUID submission, UUID item, UUID id, byte[] bytes, String filename) {
        var now = clock.instant();
        var fingerprint = OrderImageService.fingerprint(item, filename, bytes);
        if (staged.matchesUpload(id, item, entry, submission, now, fingerprint)) return id;
        if (staged.stagedCount(entry, submission, item, now) >= (entry == null ? 80 : 15))
            throw new OrderFailure(entry == null ? "ORDER_IMAGE_COUNT_EXCEEDED" : "ORDER_IMAGE_LIMIT_EXCEEDED");
        if (entry != null && staged.stagedEntryCount(entry, now) >= 200) throw new OrderFailure("IMAGE_PROCESSING_BUSY");
        var checked = validator.validate(bytes, filename);
        var image = new SubmissionImages.Image(id, item, checked.filename(), checked.contentType(),
                checked.width(), checked.height(), checked.content() == null ? bytes : checked.content());
        if (!staged.stage(image, entry, submission, now.plus(Duration.ofHours(48)), fingerprint)
                && !staged.matchesUpload(id, item, entry, submission, now, fingerprint))
            throw new OrderFailure("IDEMPOTENCY_KEY_CONFLICT");
        return id;
    }

    public SubmissionImages.Image staged(UUID entry, UUID item, UUID image) {
        return requireImage(staged.staged(entry, item, image, clock.instant()));
    }

    public SubmissionImages.Image submitted(UUID submission, UUID item, UUID image) {
        return requireImage(staged.submitted(submission, item, image, clock.instant()));
    }

    private static SubmissionImages.Image requireImage(SubmissionImages.Image image) {
        if (image == null) throw new OrderFailure("IMAGE_NOT_FOUND");
        return image;
    }

    // The caller holds the entry or submission lock and persists the associated data in the same transaction.
    public void retain(UUID entry, UUID submission, CustomerSubmission.Content content) {
        int count = 0;
        long bytes = 0;
        var now = clock.instant();
        for (var item : content.items()) {
            if (item.imageIds() == null) continue;
            for (var image : item.imageIds()) {
                if (++count > IMAGES_PER_ORDER) throw new OrderFailure("ORDER_IMAGE_COUNT_EXCEEDED");
                long size = staged.retain(image, item.itemId(), entry, submission, now);
                if (size == 0) throw new OrderFailure("IMAGE_NOT_FOUND");
                bytes += size;
                if (bytes > STORED_IMAGE_BYTES_PER_ORDER) throw new OrderFailure("ORDER_IMAGE_STORAGE_EXCEEDED");
            }
        }
    }

    public void releaseRemovedSupplements(UUID submission, CustomerSubmission.Content previous, CustomerSubmission.Content current) {
        var kept = new HashSet<UUID>();
        for (var item : current.items()) if (item.imageIds() != null) kept.addAll(item.imageIds());
        var expires = clock.instant().plus(Duration.ofHours(48));
        for (var item : previous.items()) if (item.imageIds() != null) {
            for (var id : item.imageIds()) if (!kept.contains(id)) staged.expireSupplement(submission, id, expires);
        }
    }

    public void copyToOrder(UUID submission, CustomerSubmission.Product item, UUID order, UUID orderItem, UUID employee, String employeeName) {
        if (item.imageIds() == null) return;
        for (var image : item.imageIds()) {
            var source = submitted(submission, item.itemId(), image);
            orders.insert(new OrderImage(UUID.randomUUID(), order, orderItem, source.contentType(), source.filename(),
                    source.content().length, source.width(), source.height(), employee, employeeName, clock.instant()), source.content());
        }
    }

    @Scheduled(fixedDelay = 600_000)
    public void purgeExpired() { staged.purgeExpired(clock.instant()); }
}
