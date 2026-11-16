package org.xaspire.WuhouCake.order.application.service;

import java.util.UUID;
import org.slf4j.*;
import org.xaspire.WuhouCake.order.domain.port.*;

public final class OrderImageMaintenanceService {
    private static final Logger LOG = LoggerFactory.getLogger(OrderImageMaintenanceService.class);
    private final OrderImageMaintenance images;
    private final OrderImageValidator validator;
    public OrderImageMaintenanceService(OrderImageMaintenance images, OrderImageValidator validator) { this.images = images; this.validator = validator; }
    public Result recompress() {
        UUID after = null; int processed = 0, skipped = 0, failed = 0; long before = 0, stored = 0;
        while (true) {
            var batch = images.unprocessed(after, 20);
            if (batch.isEmpty()) break;
            for (var id : batch) {
                try {
                    var image = images.load(id);
                    if (image.isEmpty()) { skipped++; continue; }
                    var source = image.get();
                    var checked = validator.validate(source.content(), source.filename());
                    if (images.replace(id, checked)) {
                        processed++; before += source.content().length; stored += checked.content().length;
                    } else skipped++;
                } catch (RuntimeException failure) {
                    failed++; LOG.warn("image_recompression_failed imageId={} failureType={}", id, failure.getClass().getSimpleName());
                }
            }
            after = batch.getLast();
            LOG.info("image_recompression processed={} skipped={} failed={} originalBytes={} storedBytes={}", processed, skipped, failed, before, stored);
        }
        return new Result(processed, skipped, failed, before, stored);
    }
    public record Result(int processed, int skipped, int failed, long originalBytes, long storedBytes) { }
}
