package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.xaspire.WuhouCake.order.domain.port.SubmissionImages;

public final class PostgresSubmissionImages implements SubmissionImages {
    private final JdbcTemplate jdbc;
    public PostgresSubmissionImages(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override public boolean stage(Image image, UUID entryId, UUID submissionId, Instant expires, String fingerprint) {
        return jdbc.update("""
                INSERT INTO customer_submission_image
                    (id, item_id, entry_id, submission_id, expires_at, filename, content_type, width, height, content, fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING
                """, image.id(), image.itemId(), entryId, submissionId, Timestamp.from(expires), image.filename(),
                image.contentType(), image.width(), image.height(), image.content(), fingerprint) == 1;
    }

    @Override public boolean matchesUpload(UUID id, UUID itemId, UUID entryId, UUID submissionId, Instant now, String fingerprint) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM customer_submission_image WHERE id=? AND item_id=?
                    AND entry_id IS NOT DISTINCT FROM CAST(? AS uuid) AND submission_id IS NOT DISTINCT FROM CAST(? AS uuid)
                    AND (expires_at IS NULL OR expires_at>?) AND fingerprint=?)
                """, Boolean.class, id, itemId, entryId, submissionId, Timestamp.from(now), fingerprint));
    }

    @Override public int stagedCount(UUID entryId, UUID submissionId, UUID itemId, Instant now) {
        if (entryId != null) return jdbc.queryForObject("""
                SELECT count(*) FROM customer_submission_image WHERE entry_id=? AND item_id=? AND submission_id IS NULL AND expires_at>?
                """, Integer.class, entryId, itemId, Timestamp.from(now));
        return jdbc.queryForObject("""
                SELECT count(*) FROM customer_submission_image WHERE submission_id=? AND entry_id IS NULL AND expires_at>?
                """, Integer.class, submissionId, Timestamp.from(now));
    }

    @Override public void lockEntryUploads(UUID entryId) {
        jdbc.queryForObject("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('submission-image-upload:' || CAST(? AS text), 0))",
                Integer.class, entryId);
    }

    @Override public int stagedEntryCount(UUID entryId, Instant now) {
        return jdbc.queryForObject("""
                SELECT count(*) FROM customer_submission_image WHERE entry_id=? AND submission_id IS NULL AND expires_at>?
                """, Integer.class, entryId, Timestamp.from(now));
    }

    @Override public void expireSupplement(UUID submissionId, UUID imageId, Instant expires) {
        jdbc.update("""
                UPDATE customer_submission_image SET expires_at=? WHERE submission_id=? AND id=? AND entry_id IS NULL AND expires_at IS NULL
                """, Timestamp.from(expires), submissionId, imageId);
    }

    @Override public long retain(UUID imageId, UUID itemId, UUID entryId, UUID submissionId, Instant now) {
        var sizes = entryId == null ? jdbc.queryForList("""
                UPDATE customer_submission_image SET expires_at=NULL
                WHERE id=? AND item_id=? AND submission_id=? AND (expires_at IS NULL OR expires_at>?)
                RETURNING octet_length(content)
                """, Long.class, imageId, itemId, submissionId, Timestamp.from(now)) : jdbc.queryForList("""
                UPDATE customer_submission_image SET submission_id=?, expires_at=NULL WHERE id=? AND item_id=? AND entry_id=?
                    AND (submission_id=? OR (submission_id IS NULL AND expires_at>?))
                RETURNING octet_length(content)
                """, Long.class, submissionId, imageId, itemId, entryId, submissionId, Timestamp.from(now));
        return sizes.isEmpty() ? 0 : sizes.getFirst();
    }

    @Override public Image staged(UUID entryId, UUID itemId, UUID imageId, Instant now) {
        return find("entry_id=? AND submission_id IS NULL AND expires_at>?", imageId, itemId, entryId, now);
    }

    @Override public Image submitted(UUID submissionId, UUID itemId, UUID imageId, Instant now) {
        return find("submission_id=? AND (expires_at IS NULL OR expires_at>?)", imageId, itemId, submissionId, now);
    }

    private Image find(String scope, UUID id, UUID itemId, UUID owner, Instant now) {
        return jdbc.query("SELECT filename, content_type, width, height, content FROM customer_submission_image WHERE id=? AND item_id=? AND " + scope,
                (rs, row) -> new Image(id, itemId, rs.getString(1), rs.getString(2), rs.getInt(3), rs.getInt(4), rs.getBytes(5)),
                id, itemId, owner, Timestamp.from(now)).stream().findFirst().orElse(null);
    }

    @Override public int purgeExpired(Instant now) {
        return jdbc.update("""
                DELETE FROM customer_submission_image WHERE expires_at<=? AND id IN (
                    SELECT id FROM customer_submission_image WHERE expires_at<=? ORDER BY expires_at,id
                    LIMIT 500 FOR UPDATE SKIP LOCKED)
                """, Timestamp.from(now), Timestamp.from(now));
    }

    @Override public StagingStats stagingStats(Instant now) {
        return jdbc.queryForObject("""
                SELECT count(*), COALESCE(sum(octet_length(content)), 0),
                    count(*) FILTER (WHERE expires_at <= ?)
                FROM customer_submission_image WHERE expires_at IS NOT NULL
                """, (rs, row) -> new StagingStats(rs.getLong(1), rs.getLong(2), rs.getLong(3)), Timestamp.from(now));
    }
}
