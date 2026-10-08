package org.xaspire.WuhouCake.shared.json;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class JsonCodec {
    private final ObjectMapper mapper;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String write(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot encode JSON", exception);
        }
    }

    public <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot decode JSON", exception);
        }
    }
}
