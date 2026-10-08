package org.xaspire.WuhouCake.bootstrap.integration;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.test.context.TestConfiguration;

@TestConfiguration(proxyBeanMethods = false)
@MapperScan(basePackageClasses = ProbeMapper.class)
public class TestPersistenceConfiguration {
}
