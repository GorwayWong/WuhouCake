package org.xaspire.WuhouCake.order.api.dto;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.SubmissionCommands;

public final class SubmissionViews {
    private SubmissionViews() { }
    public record Entry(UUID ownerId, String ownerName, String url, boolean enabled) { }
    public record PublicEntry(String ownerName) { }
    public record Receipt(UUID submissionId, String submissionNo) { }
    public record Submission(UUID id, UUID entryId, UUID ownerId, String ownerName, long version, String status,
            SubmissionCommands.Content original, SubmissionCommands.Review reviewed, UUID orderId, Instant createdAt, Instant updatedAt) { }
    public record Activity(long id, String type, String actorType, UUID actorId, String actorName, Map<String, Object> details, Instant createdAt) { }
    public record Detail(Submission submission, UUID newerSubmissionId, List<Activity> activities) { }
    public record Origin(UUID submissionId, String source, UUID entryOwnerId, String entryOwnerName, Instant submittedAt, Instant requestedReceiveAt) { }
}
