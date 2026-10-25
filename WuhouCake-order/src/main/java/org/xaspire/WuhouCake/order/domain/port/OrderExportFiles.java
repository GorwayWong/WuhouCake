package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;

public interface OrderExportFiles {
    File generate(List<Snapshot> snapshots, String filename, boolean zip);
    void delete(File file);
    default Snapshot captureImages(Snapshot snapshot) { return snapshot; }
    default void releaseImages(List<Snapshot> snapshots) { }

    /** 在同一可重复读事务内固定图片至临时文件；生成结束后必须释放 imageFiles。 */
    record Snapshot(Order order, List<OrderActivity> notes, List<OrderImage> images, java.util.Map<java.util.UUID, String> imageFiles) {
        public Snapshot(Order order, List<OrderActivity> notes, List<OrderImage> images) { this(order, notes, images, java.util.Map.of()); }
        public Snapshot { notes = List.copyOf(notes); images = List.copyOf(images); imageFiles = java.util.Map.copyOf(imageFiles); }
    }
    /** path 为服务端内部临时文件位置，不得通过 JSON 返回给客户端。 */
    record File(String path, String filename, String contentType, long size) { }
}
