package org.xaspire.WuhouCake.bootstrap.configuration;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.infrastructure.files.RemoteOrderImageValidator;
import static org.junit.jupiter.api.Assertions.*;

class ImageWorkerConfigurationTest {
    @Test void productionRequiresIsolationButAdministratorCommandDoesNotRequireAnImageServer() throws Exception {
        var environment = new MockEnvironment(); environment.setActiveProfiles("prod");
        var composition = new OrderComposition();
        assertThrows(IllegalStateException.class, () -> composition.orderImageValidator(environment));
        environment.setProperty("spring.main.web-application-type", "none");
        environment.setProperty("wuhoucake.identity.command", "init-admin");
        assertEquals("IMAGE_PROCESSING_UNAVAILABLE", assertThrows(OrderFailure.class,
                () -> composition.orderImageValidator(environment).validate(new byte[]{1}, "test.jpg")).code());
        environment.setProperty("wuhoucake.images.worker-url", "http://image-worker:8091/process");
        try (var validator = (RemoteOrderImageValidator) composition.orderImageValidator(environment)) { assertNotNull(validator); }
    }
}
