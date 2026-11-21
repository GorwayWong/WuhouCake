package org.xaspire.WuhouCake.bootstrap.configuration;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.scheduling.annotation.Scheduled;
import org.xaspire.WuhouCake.order.application.service.SubmissionImageService;
import org.xaspire.WuhouCake.order.domain.port.SubmissionImages.StagingStats;

public class SubmissionImageMaintenance {
    private final SubmissionImageService images;
    private final Counter purged;
    private final Counter failures;
    private volatile StagingStats stats;

    SubmissionImageMaintenance(SubmissionImageService images, MeterRegistry metrics) {
        this.images = images;
        purged = metrics.counter("wuhou.submission.images.cleanup.deleted");
        failures = metrics.counter("wuhou.submission.images.cleanup.failed");
        metrics.gauge("wuhou.submission.images.staged", this, task -> task.stats == null ? Double.NaN : task.stats.count());
        metrics.gauge("wuhou.submission.images.staged.bytes", this, task -> task.stats == null ? Double.NaN : task.stats.bytes());
        metrics.gauge("wuhou.submission.images.staged.expired", this, task -> task.stats == null ? Double.NaN : task.stats.expiredCount());
    }

    @Scheduled(fixedDelay = 600_000)
    public void clean() {
        try {
            purged.increment(images.purgeExpired());
            stats = images.stagingStats();
        } catch (RuntimeException failure) {
            failures.increment();
            throw failure;
        }
    }
}
