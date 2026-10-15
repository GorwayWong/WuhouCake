package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;

public interface OrderExportFiles {
    File generate(List<Snapshot> snapshots, String filename, boolean zip);
    void delete(File file);

    /** 仅用于同一次导出，不得修改已读取的 Order。图片内容按固定 ID 延迟读取。 */
    record Snapshot(Order order, List<OrderActivity> notes, List<OrderImage> images) {
        public Snapshot { notes = List.copyOf(notes); images = List.copyOf(images); }
    }
    /** path 为服务端内部临时文件位置，不得通过 JSON 返回给客户端。 */
    record File(String path, String filename, String contentType, long size) { }
}
