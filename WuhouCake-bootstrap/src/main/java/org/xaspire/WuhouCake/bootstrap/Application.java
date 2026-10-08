package org.xaspire.WuhouCake.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        var application = new SpringApplication(Application.class);
        boolean command = java.util.Arrays.stream(args).anyMatch(arg -> arg.startsWith("--wuhoucake.identity.command="));
        if (command) {
            if (java.util.Arrays.stream(args).anyMatch(arg -> arg.startsWith("--spring.main.web-application-type=") && !arg.endsWith("=none")))
                throw new IllegalArgumentException("Identity command mode cannot start HTTP");
            application.setWebApplicationType(WebApplicationType.NONE);
            if (java.util.Arrays.stream(args).noneMatch(arg -> arg.equals("--spring.main.web-application-type=none")))
                args = java.util.stream.Stream.concat(java.util.Arrays.stream(args), java.util.stream.Stream.of("--spring.main.web-application-type=none")).toArray(String[]::new);
        }
        var context = application.run(args);
        if (command) context.close();
    }
}
