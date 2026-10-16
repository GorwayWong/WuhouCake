package org.xaspire.WuhouCake.order.api.command;

import jakarta.validation.constraints.*;

public final class RecognitionCommands {
    private RecognitionCommands() { }
    public record Parse(@NotBlank @Size(max = 12000) String text) {
        @Override public String toString() { return "RecognitionParse"; }
    }
    public record Assist(@NotBlank @Size(max = 12000) String text, boolean allowExternalProcessing) {
        @Override public String toString() { return "RecognitionAssist"; }
    }
}
