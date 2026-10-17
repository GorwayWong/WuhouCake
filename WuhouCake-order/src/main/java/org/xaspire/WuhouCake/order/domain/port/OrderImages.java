package org.xaspire.WuhouCake.order.domain.port;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;

public interface OrderImages {
    /** 在当前写事务中锁定订单行；订单不存在时返回 false。 */
    boolean lockOrder(UUID orderId);
    boolean activeItem(UUID orderId, UUID itemId);
    int count(UUID orderId);
    void insert(OrderImage image, byte[] content);
    List<OrderImage> list(UUID orderId);
    Optional<OrderImage> find(UUID orderId, UUID imageId);
    boolean contains(UUID orderId, UUID imageId);
    /** 按稳定 ID 读取原始内容，供已取得的导出快照使用；公开读取须先检查有效元数据。 */
    Optional<byte[]> content(UUID orderId, UUID imageId);
    void remove(UUID orderId, UUID imageId);
}
