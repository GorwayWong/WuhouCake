package org.xaspire.WuhouCake.shared.response;

import java.util.List;

public record Page<T>(List<T> items, long total, int page, int size) {
    public Page { items = List.copyOf(items); }
}
