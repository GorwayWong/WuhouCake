package org.xaspire.WuhouCake.order.application.event;

import java.util.UUID;

public record OrderPackageChanged(UUID packageId, long version, boolean deleted) { }
