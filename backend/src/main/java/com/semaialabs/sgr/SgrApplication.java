package com.semaialabs.sgr;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SgrApplication {
    public static void main(String[] args) {
        SpringApplication.run(SgrApplication.class, args);
    }
}
