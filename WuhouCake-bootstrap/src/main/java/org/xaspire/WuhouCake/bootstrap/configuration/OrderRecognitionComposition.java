package org.xaspire.WuhouCake.bootstrap.configuration;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Map;
import org.springframework.context.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.xaspire.WuhouCake.order.adapter.web.OrderRecognitionController;
import org.xaspire.WuhouCake.order.application.service.OrderRecognitionService;
import org.xaspire.WuhouCake.order.domain.service.OrderRecognition;
import org.xaspire.WuhouCake.order.domain.port.RecognitionAssistant;
import org.xaspire.WuhouCake.order.infrastructure.client.BailianRecognitionAssistant;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(RecognitionAssistProperties.class)
public class OrderRecognitionComposition {
    @Bean @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    OrderRecognitionController orderRecognitionController(OrderRecognitionService recognition) { return new OrderRecognitionController(recognition); }
    @Bean OrderRecognition orderRecognition(ObjectMapper json) throws IOException {
        try (var input = OrderRecognition.class.getResourceAsStream("/order/cake-defaults.json")) {
            if (input == null) throw new IllegalStateException("Cake defaults resource missing");
            return new OrderRecognition(json.readValue(input, new TypeReference<Map<String, String>>() { }));
        }
    }
    @Bean(destroyMethod = "close") BailianRecognitionAssistant recognitionAssistant(RecognitionAssistProperties properties, ObjectMapper json) throws IOException {
        try (var input = OrderRecognition.class.getResourceAsStream("/order/recognition-assist-schema.json")) {
            if (input == null) throw new IllegalStateException("Recognition schema resource missing");
            return new BailianRecognitionAssistant(new BailianRecognitionAssistant.Settings(properties.enabled(), properties.apiKey(),
                    properties.baseUrl(), properties.modelId(), properties.timeoutMillis(), properties.maxConcurrent()), json, json.readTree(input));
        }
    }
    @Bean OrderRecognitionService orderRecognitionService(OrderRecognition recognition, RecognitionAssistant assistant) { return new OrderRecognitionService(recognition, assistant); }
}
