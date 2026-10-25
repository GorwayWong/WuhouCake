package org.xaspire.WuhouCake.order.domain.port;

import java.util.*;

public interface OrderImageMaintenance {
    record Image(UUID id, String filename, byte[] content) { }
    List<UUID> unprocessed(UUID after, int limit);
    Optional<Image> load(UUID id);
    /** 只替换尚未处理的图片；不修改移除标记、上传信息和订单版本。 */
    boolean replace(UUID id, OrderImageValidator.Checked checked);
}
