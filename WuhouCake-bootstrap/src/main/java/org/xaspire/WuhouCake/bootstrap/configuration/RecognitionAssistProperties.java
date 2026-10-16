package org.xaspire.WuhouCake.bootstrap.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("wuhoucake.order-recognition.assist")
public record RecognitionAssistProperties(boolean enabled, String apiKey, String baseUrl, String modelId, long timeoutMillis, int maxConcurrent) {
    @Override public String toString() { return "RecognitionAssistProperties"; }
}
