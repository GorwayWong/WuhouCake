package org.xaspire.WuhouCake.order.domain.service;

import java.util.*;
import java.util.regex.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft.*;

/** Extracts recipient candidates from unlabelled text; ambiguous candidates require review. */
final class ContactRecognition {
    private static final Pattern PHONE = Pattern.compile("(?<![0-9])(?:(?:\\+?86[-\\s]*)?1[3-9](?:[-\\s]*[0-9]){9}|0[0-9]{2,3}[- ]?[0-9]{7,8})(?![0-9])");
    private static final Pattern BUSINESS = Pattern.compile("客服|门店|店铺|商家|门市|服务热线|售后|订购须知|温馨提示|发票|开票|账单|退货|寄件|发件|仓库");
    private static final Pattern BUSINESS_PREFIX = Pattern.compile("(?:" + BUSINESS.pattern() + ")(?:信息)?\\s*$");
    static boolean businessContact(String line) { return BUSINESS.matcher(line).find(); }
    static boolean businessPrefix(String prefix) { return BUSINESS_PREFIX.matcher(prefix).find(); }
    static Map<String, Field> extract(List<String> lines, String knownPhone, String knownAddress) {
        var phones = new LinkedHashSet<String>(); var addresses = new LinkedHashSet<String>(); var names = new LinkedHashSet<String>();
        if (knownPhone != null) phones.add(knownPhone);
        if (knownAddress != null) addresses.add(knownAddress);
        for (String line : lines) {
            if (businessContact(line)) continue;
            var matcher = PHONE.matcher(line);
            while (matcher.find()) {
                String phone = matcher.group().replaceAll("[-\\s]", "").replaceFirst("^\\+?86(?=1[3-9][0-9]{9}$)", "");
                phones.add(phone);
            }
            for (String part : matcher.replaceAll(" ").split("[，,；;\\n\\t]+| {2,}")) {
                String text = part.strip();
                if (text.isEmpty()) continue;
                if (text.matches(".*(?:蛋糕|奶油|夹层|抹面|付款|配送|制作|原味|芒果|草莓|香草|巧克力|备注|自提).*" ) && !address(text)) continue;
                // A short name can precede an address separated by a single space.
                String[] words = text.split("\\s+", 2);
                if (words.length == 2 && words[0].matches("[\\p{IsHan}·]{2,10}") && address(words[1])) {
                    names.add(words[0]); addresses.add(words[1]);
                } else if (address(text)) addresses.add(text);
                else if (text.matches("[\\p{IsHan}·]{2,10}")) names.add(text);
            }
        }
        var result = new LinkedHashMap<String, Field>();
        put(result, "phone", phones, false);
        boolean incomplete = addresses.size() != 1 || !addresses.iterator().next().matches(".*(?:省|自治区|市|自治州|地区).*(?:市|区|县|镇).*" )
                || !addresses.iterator().next().matches(".*(?:路|街|巷|小区|社区|镇|乡|村|街道).*[0-9号栋楼室].*");
        put(result, "address", addresses, incomplete || phones.size() != 1);
        put(result, "customerName", names, true);
        return result;
    }
    private static boolean address(String text) {
        return text.length() <= 500 && text.matches(".*(?:省|自治区|市|区|县|镇|街道|路|街|巷|小区|社区).*" )
                && (text.matches(".*[0-9号栋楼室].*") || text.matches(".*(?:省|市).*(?:市|区|县).*"));
    }
    private static void put(Map<String, Field> result, String key, Set<String> values, boolean review) {
        if (values.isEmpty()) return;
        boolean ambiguous = values.size() != 1;
        result.put(key, new Field(ambiguous ? null : values.iterator().next(), Source.RULE, List.copyOf(values), review || ambiguous,
                review || ambiguous ? List.of("收件信息存在歧义，请核对原文后确认") : List.of()));
    }
}
