package org.xaspire.WuhouCake.order.domain.model.valobj;

public final class OrderImageName {
    private OrderImageName() { }

    public static String normalized(String filename, String contentType) {
        String extension = contentType.equals("image/png") ? ".png" : ".jpg";
        String name = sourceName(filename).replaceFirst("(?i)\\.(jpe?g|png)$", "");
        if (name.length() > 251) name = name.substring(0, Character.isHighSurrogate(name.charAt(250)) ? 250 : 251);
        return name + extension;
    }
    public static String sourceName(String filename) {
        String name = filename == null ? "image" : filename.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").strip();
        if (name.isEmpty()) name = "image";
        return name.substring(0, Math.min(name.length(), 255));
    }
}
