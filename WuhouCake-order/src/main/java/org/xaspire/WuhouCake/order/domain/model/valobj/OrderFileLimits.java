package org.xaspire.WuhouCake.order.domain.model.valobj;

public final class OrderFileLimits {
    private OrderFileLimits() { }
    public static final int IMAGE_BYTES = 5 * 1024 * 1024;
    public static final int IMAGE_DIMENSION = 8192;
    public static final long IMAGE_PIXELS = 24_000_000;
    public static final int IMAGES_PER_ORDER = 8;
    public static final int EXPORT_DAYS = 42;
    public static final int EXPORT_ORDERS = 100;
    public static final int EXPORT_IMAGES = EXPORT_ORDERS * IMAGES_PER_ORDER;
    public static final long EXPORT_TEXT_BYTES = 8L * 1024 * 1024;
    public static final long EXPORT_DATA_ROWS = 10_000;
    public static final long XLSX_BYTES = 64L * 1024 * 1024;
    public static final long ZIP_BYTES = 256L * 1024 * 1024;
}
