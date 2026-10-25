package org.xaspire.WuhouCake.order.domain.service;

import java.math.*;
import java.time.*;
import java.time.format.*;
import java.util.*;
import java.util.regex.*;

public final class RecognitionValues {
    private RecognitionValues() { }
    private static final Pattern DATE = Pattern.compile("(?<![\\d+-])(\\d{4})[年.\\-/](\\d{1,2})[月.\\-/](\\d{1,2})日?(?!\\d)");
    private static final Pattern TIME = Pattern.compile("(?<!\\d)(\\d{1,2})(?::|：|点|时)(\\d{1,2})(?:分)?(?!\\d)");
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("uuuu-M-d").withResolverStyle(ResolverStyle.STRICT);
    public static String date(String text) {
        var matcher = DATE.matcher(text);
        if (!matcher.find()) throw new IllegalArgumentException("需要带年份的明确日期");
        String date;
        try {
            if (Integer.parseInt(matcher.group(1)) < 1) throw new DateTimeException("year");
            date = LocalDate.parse(matcher.group(1) + "-" + matcher.group(2) + "-" + matcher.group(3), DATE_FORMAT).toString();
        } catch (DateTimeException invalid) { throw new IllegalArgumentException("日期无效，请核对完整年月日", invalid); }
        if (matcher.find()) throw new IllegalArgumentException("存在多个日期，需要核对");
        return date;
    }
    public static boolean containsDate(String text) { return DATE.matcher(text).find(); }
    public static String time(String text) {
        var matcher = TIME.matcher(text);
        if (!matcher.find()) throw new IllegalArgumentException("请填写完整的24小时制时刻（HH:mm）");
        var time = LocalTime.of(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)));
        if (matcher.find() || text.contains("下午") || text.contains("上午") || text.contains("晚上"))
            throw new IllegalArgumentException("请核对并填写24小时制时刻");
        return time.toString().length() == 5 ? time.toString() : time.format(DateTimeFormatter.ofPattern("HH:mm"));
    }
    public static boolean containsTime(String text) { return TIME.matcher(text).find(); }
    public static String phone(String text) {
        String value = text.replaceAll("[\\s-]", "");
        if (!value.matches("(?:\\+?86)?1[3-9]\\d{9}|0\\d{9,11}")) throw new IllegalArgumentException("电话号码无效或存在多个号码");
        return value.startsWith("+86") ? value.substring(3) : value.startsWith("86") && value.length() == 13 ? value.substring(2) : value;
    }
    public static String size(String text) {
        String value = text.strip().replaceFirst("(?:英寸|寸)$", "").strip();
        if (!value.matches("[0-9]{1,9}(?:\\.[0-9]{1,2})?")) throw new IllegalArgumentException("尺寸需要单个正数，最多两位小数、九位整数");
        var number = new BigDecimal(value);
        if (number.signum() <= 0 || value.length() > 32) throw new IllegalArgumentException("尺寸需要人工核对");
        return number.stripTrailingZeros().toPlainString();
    }
    public static String quantity(String text) {
        String value = text.strip().replaceFirst("(?:个|只|份|盒)$", "").strip();
        var chinese = Map.of("一", "1", "二", "2", "两", "2", "三", "3", "四", "4", "五", "5", "六", "6", "七", "7", "八", "8", "九", "9");
        value = chinese.getOrDefault(value, value);
        if (!value.matches("\\d+")) throw new IllegalArgumentException("数量需要明确的正整数");
        var number = new BigInteger(value);
        if (number.signum() <= 0 || number.compareTo(BigInteger.valueOf(Integer.MAX_VALUE)) > 0) throw new IllegalArgumentException("数量超出有效范围");
        return number.toString();
    }
    public static String money(String text) {
        String value = text.strip().replaceFirst("^(?:人民币|RMB|￥|¥)\\s*", "").replaceFirst("\\s*元$", "").strip();
        if (!value.matches("\\d+(?:\\.\\d{1,2})?")) throw new IllegalArgumentException("金额需要明确的非负数，最多两位小数");
        var cents = new BigDecimal(value).movePointRight(2).toBigIntegerExact();
        if (cents.compareTo(BigInteger.valueOf(org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.MAX_MONEY_CENTS)) > 0) throw new IllegalArgumentException("金额超出表单安全范围");
        return cents.toString();
    }
    public static String text(String value, int limit) {
        if (value.length() > limit || value.chars().anyMatch(c -> c < 32 && c != '\t')) throw new IllegalArgumentException("字段过长或含控制字符");
        return value.strip();
    }
}
