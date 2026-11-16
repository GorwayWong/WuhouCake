package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;

public interface OrderExportFiles {
    default File generate(List<Snapshot> snapshots, String filename, boolean zip) {
        return generate(snapshots, filename, zip, () -> { });
    }
    File generate(List<Snapshot> snapshots, String filename, boolean zip, Runnable checkDeadline);
    void delete(File file);
    /** 导出元数据快照。图片字节在生成各工作簿时逐张读取。 */
    record Snapshot(Order order, List<OrderActivity> notes, List<OrderImage> images) {
        public Snapshot { notes = List.copyOf(notes); images = List.copyOf(images); }
    }
    /** path 为服务端内部临时文件位置，不得通过 JSON 返回给客户端。 */
    record File(String path, String filename, String contentType, long size) { }
}
