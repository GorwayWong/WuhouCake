package org.xaspire.WuhouCake.order.domain.service;

import java.math.*;
import java.time.*;
import java.util.*;
import java.util.regex.*;

public final class RecognitionValues {
    private RecognitionValues() { }
    private static final Pattern DATE = Pattern.compile("(?:(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})(?!\\d)|(?:(\\d{4})年\\h*)?(\\d{1,2})月\\h*(\\d{1,2})(?:[日号]|(?=$|\\h))|今天|明天|后天)");
    private static final String CLOCK_NUMBER = "[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3}";
    private static final String PERIOD = "凌晨|早上|上午|中午|下午|晚上";
    private static final Pattern TIME = Pattern.compile("(" + PERIOD + ")?\\h*(" + CLOCK_NUMBER
            + ")\\h*(?::\\h*([0-9]{1,2})|[点时](?:\\h*(半|" + CLOCK_NUMBER + ")分?)?)");

    record DatedValue(String date, String remainder) { }

    static String normalizeTimeText(String text) {
        var normalized = new StringBuilder(text.length());
        for (char c : text.toCharArray()) {
            if (c >= '０' && c <= '９') c = (char) ('0' + c - '０');
            normalized.append(c == '：' ? ':' : c == '　' ? ' ' : c);
        }
        return normalized.toString();
    }

    static DatedValue datePrefix(String text, LocalDate today) {
        var match = DATE.matcher(text);
        if (!match.lookingAt()) return new DatedValue(null, text);
        String date;
        if (match.group(1) != null) {
            date = explicitDate(match.group(1), match.group(3), match.group(4));
        } else if (match.group(6) != null) {
            date = match.group(5) == null ? MonthDay.of(Integer.parseInt(match.group(6)), Integer.parseInt(match.group(7))).toString()
                    : explicitDate(match.group(5), match.group(6), match.group(7));
        } else {
            date = today.plusDays(switch (match.group()) { case "明天" -> 1; case "后天" -> 2; default -> 0; }).toString();
        }
        String remainder = text.substring(match.end()).stripLeading();
        if (remainder.startsWith("T") && remainder.length() > 1) remainder = remainder.substring(1);
        if (DATE.matcher(remainder).find()) throw new IllegalArgumentException("存在多个日期，请核对");
        if (!remainder.isEmpty() && !remainder.equals("待定") && !remainder.matches(PERIOD) && !TIME.matcher(remainder).lookingAt()) {
            throw new IllegalArgumentException("日期含范围或无法识别的内容，请手工填写");
        }
        return new DatedValue(date, remainder);
    }

    private static String explicitDate(String year, String month, String day) {
        int y = Integer.parseInt(year);
        if (y == 0) throw new DateTimeException("year");
        return LocalDate.of(y, Integer.parseInt(month), Integer.parseInt(day)).toString();
    }

    static LocalDate nextDate(MonthDay monthDay, LocalDate today) {
        for (int year = today.getYear(); year <= Math.min(today.getYear() + 8, 9999); year++) {
            if (monthDay.isValidYear(year) && !monthDay.atYear(year).isBefore(today)) return monthDay.atYear(year);
        }
        throw new DateTimeException("没有可用日期");
    }

    static String time(String text) {
        var match = TIME.matcher(text);
        if (!match.matches()) throw new IllegalArgumentException("时刻格式不明确，请填写具体时刻");
        int hour = clockNumber(match.group(2));
        String period = match.group(1);
        int minute = match.group(3) != null ? Integer.parseInt(match.group(3))
                : match.group(4) == null ? 0 : match.group(4).equals("半") ? 30 : clockNumber(match.group(4));
        if (hour > 23 || minute > 59) throw new IllegalArgumentException("时刻无效，请核对小时和分钟");
        if (period == null && match.group(3) == null && hour >= 1 && hour <= 12) {
            throw new IllegalArgumentException("时刻缺少上午或下午，请核对");
        }
        if ("中午".equals(period)) {
            if (hour == 1) hour = 13;
            if (hour < 11 || hour > 13) throw new IllegalArgumentException("时段与时刻冲突，请核对");
        } else if ("下午".equals(period) || "晚上".equals(period)) {
            if (hour == 0) throw new IllegalArgumentException("时段与时刻冲突，请核对");
            if (hour == 12 && "晚上".equals(period)) throw new IllegalArgumentException("晚上12点的日期不明确，请核对");
            if (hour < 12) hour += 12;
        } else if (period != null && hour >= 12) {
            throw new IllegalArgumentException("时段与时刻冲突，请核对");
        }
        return LocalTime.of(hour, minute).toString();
    }

    private static int clockNumber(String text) {
        if (text.charAt(0) <= '9') return Integer.parseInt(text);
        int tens = text.indexOf('十');
        if (tens < 0 && text.length() == 1) return chineseDigit(text.charAt(0));
        if (tens >= 0 && tens <= 1 && text.length() - tens <= 2) {
            return (tens == 0 ? 1 : chineseDigit(text.charAt(0))) * 10
                    + (tens == text.length() - 1 ? 0 : chineseDigit(text.charAt(tens + 1)));
        }
        throw new IllegalArgumentException("中文时刻格式不明确，请手工填写");
    }

    private static int chineseDigit(char digit) {
        return digit == '〇' ? 0 : digit == '两' ? 2 : "零一二三四五六七八九".indexOf(digit);
    }

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
