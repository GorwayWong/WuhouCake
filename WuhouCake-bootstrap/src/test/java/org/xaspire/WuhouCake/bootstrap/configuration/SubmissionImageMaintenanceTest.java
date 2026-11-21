package org.xaspire.WuhouCake.bootstrap.configuration;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.application.service.SubmissionImageService;
import org.xaspire.WuhouCake.order.domain.port.SubmissionImages.StagingStats;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SubmissionImageMaintenanceTest {
    @Test void databaseFailureIsCountedAndNextCleanupCanRecover() {
        var images = mock(SubmissionImageService.class);
        when(images.purgeExpired()).thenThrow(new IllegalStateException("database unavailable")).thenReturn(2);
        when(images.stagingStats()).thenReturn(new StagingStats(1, 128, 0));
        var meters = new SimpleMeterRegistry();
        var task = new SubmissionImageMaintenance(images, meters);
        assertThrows(IllegalStateException.class, task::clean);
        assertTrue(Double.isNaN(meters.get("wuhou.submission.images.staged").gauge().value()));
        assertEquals(1.0, meters.get("wuhou.submission.images.cleanup.failed").counter().count());
        task.clean();
        assertEquals(2.0, meters.get("wuhou.submission.images.cleanup.deleted").counter().count());
        assertEquals(128.0, meters.get("wuhou.submission.images.staged.bytes").gauge().value());
    }
}
