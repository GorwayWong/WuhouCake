package org.xaspire.WuhouCake.order.domain.port;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface SubmissionImages {
    record Image(UUID id, UUID itemId, String filename, String contentType, int width, int height, byte[] content) { }
    record Reference(UUID itemId, UUID imageId) { }
    List<UUID> missingPublicImages(UUID entryId, List<Reference> images, Instant now);
    boolean stage(Image image, UUID entryId, UUID submissionId, Instant expires, String fingerprint);
    boolean matchesUpload(UUID id, UUID itemId, UUID entryId, UUID submissionId, Instant now, String fingerprint);
    boolean renewPublicUpload(UUID id, UUID itemId, UUID entryId, Instant now, Instant expires, String fingerprint, boolean expired);
    int stagedCount(UUID entryId, UUID submissionId, UUID itemId, Instant now);
    void lockEntryUploads(UUID entryId);
    int stagedEntryCount(UUID entryId, Instant now);
    void expireSupplement(UUID submissionId, UUID imageId, Instant expires);
    long retain(UUID imageId, UUID itemId, UUID entryId, UUID submissionId, Instant now);
    Image staged(UUID entryId, UUID itemId, UUID imageId, Instant now);
    Image submitted(UUID submissionId, UUID itemId, UUID imageId, Instant now);
    record StagingStats(long count, long bytes, long expiredCount) { }
    int purgeExpired(Instant now);
    StagingStats stagingStats(Instant now);
}
