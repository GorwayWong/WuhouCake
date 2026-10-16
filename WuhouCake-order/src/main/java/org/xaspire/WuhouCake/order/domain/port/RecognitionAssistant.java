package org.xaspire.WuhouCake.order.domain.port;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft.Fragment;

public interface RecognitionAssistant {
    boolean available();
    Result suggest(List<Fragment> fragments);
    record Suggestion(String itemId, String field, String value, String evidence) { }
    record Result(String status, List<Suggestion> suggestions, List<String> issues) {
        public Result { suggestions = List.copyOf(suggestions); issues = List.copyOf(issues); }
    }
}
