package org.xaspire.WuhouCake.order.infrastructure.client;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

/** Validates the fixed, local object/array/string schema subset used for recognition. */
final class RecognitionSchema {
    private RecognitionSchema() { }
    static void check(JsonNode schema) {
        Set<String> allowed = switch (schema.path("type").asText()) {
            case "object" -> Set.of("type", "properties", "required", "additionalProperties");
            case "array" -> Set.of("type", "items", "maxItems");
            case "string" -> Set.of("type", "enum", "minLength", "maxLength");
            default -> throw new IllegalArgumentException("Unsupported recognition schema type");
        };
        schema.fieldNames().forEachRemaining(name -> { if (!allowed.contains(name)) throw new IllegalArgumentException("Unsupported recognition schema keyword"); });
        if (schema.has("properties")) schema.path("properties").elements().forEachRemaining(RecognitionSchema::check);
        if (schema.has("items")) check(schema.path("items"));
    }
    static boolean valid(JsonNode schema, JsonNode value) {
        if (value == null) return false;
        return switch (schema.path("type").asText()) {
            case "object" -> {
                if (!value.isObject()) yield false;
                var properties = schema.path("properties");
                boolean valid = true;
                for (var required : schema.path("required")) if (!value.has(required.asText())) valid = false;
                var names = value.fieldNames();
                while (names.hasNext()) {
                    String name = names.next();
                    if (!properties.has(name)) { if (!schema.path("additionalProperties").asBoolean(true)) valid = false; }
                    else if (!valid(properties.get(name), value.get(name))) valid = false;
                }
                yield valid;
            }
            case "array" -> {
                if (!value.isArray() || value.size() > schema.path("maxItems").asInt(Integer.MAX_VALUE)) yield false;
                boolean valid = true;
                for (var item : value) if (!valid(schema.path("items"), item)) valid = false;
                yield valid;
            }
            case "string" -> {
                if (!value.isTextual() || value.textValue().length() < schema.path("minLength").asInt(0)
                        || value.textValue().length() > schema.path("maxLength").asInt(Integer.MAX_VALUE)) yield false;
                boolean allowed = !schema.has("enum");
                for (var candidate : schema.path("enum")) if (candidate.equals(value)) allowed = true;
                yield allowed;
            }
            default -> throw new IllegalArgumentException("Unsupported local recognition schema");
        };
    }
}
