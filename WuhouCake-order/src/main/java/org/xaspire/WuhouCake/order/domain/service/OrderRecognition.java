package org.xaspire.WuhouCake.order.domain.service;

import java.time.DateTimeException;
import java.util.*;
import java.util.regex.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft.*;

/** Bounded label extraction. Unlabelled semantics remain suggestions for human review. */
public final class OrderRecognition {
    public static final int MAX_TEXT = 12000;
    public static final List<String> ORDER_FIELDS = List.of("customerName", "phone", "memberPhone", "buyerName", "fulfillmentType",
            "address", "requestedReceiveDate", "plannedHandoffAt", "plannedFinishAt", "totalAmountCents");
    public static final List<String> ITEM_FIELDS = List.of("name", "productType", "quantity", "size", "flavor", "base", "filling", "message", "requirements", "unitPriceCents", "memberPriceCents");
    private static final Map<String, String> LABELS = labels();
    private static final Pattern LABEL = Pattern.compile("(" + String.join("|", LABELS.keySet().stream().sorted(Comparator.comparingInt(String::length).reversed()).map(Pattern::quote).toList())
            + ")([（(][^）)\\n]{0,80}[）)])?\\s*[:：]\\s*");
    private static final Pattern ITEM_HEADING = Pattern.compile("^(?:[【\\[])?(蛋糕|商品|小产品)\\s*[一二三四五六七八九十\\dA-Z]+[】\\]]?\\s*[:：、.]?\\s*(.*)$");
    private static final Pattern NOTICE = Pattern.compile("^[【\\[（(\\s]*[一二三四五六七八九十\\d、.\\s]*(?:订购须知|订购需知|预订须知|温馨提示|配送规则|配送说明|配套餐具|餐具说明|可选口味|注意事项).*");
    private static final Pattern NOTICE_SECTION = Pattern.compile("[【\\[]\\s*(?:订购须知|订购需知|预订须知|温馨提示|配送规则|配套餐具[^】\\]]*|餐具说明)\\s*[】\\]]|(?:^|\\s)(?:订购须知|订购需知|预订须知|温馨提示|配送规则)\\s*[:：]");
    private static final Pattern TITLE = Pattern.compile("^[【\\[](?:蛋糕预定单|蛋糕预订单|蛋糕订购单)[】\\]]\\s*");
    private static final Pattern SIZE = Pattern.compile("\\d+(?:\\.\\d+)?\\s*(?:英寸|寸)");
    private static final Pattern QUANTITY = Pattern.compile("(?<!\\d)([一二两三四五六七八九\\d]+)\\s*(?:个|只|份|盒)");
    private final Map<String, String> cakeDefaults;
    public OrderRecognition(Map<String, String> cakeDefaults) { this.cakeDefaults = Map.copyOf(cakeDefaults); }
    public RecognitionDraft parse(String text) {
        if (text == null || text.isBlank() || text.length() > MAX_TEXT) throw new IllegalArgumentException("识别文本需为1–12000个字符");
        var fields = empty(ORDER_FIELDS); var items = new ArrayList<MutableItem>(); var issues = new ArrayList<String>();
        var fragments = new ArrayList<Fragment>(); var unmapped = new ArrayList<String>(); MutableItem current = null;
        var times = new LinkedHashMap<String, List<String>>();
        boolean notice = false, itemOverflow = false;
        String body = text.replace("\r\n", "\n").replace('\r', '\n');
        var section = NOTICE_SECTION.matcher(body);
        if (section.find()) body = body.substring(0, section.start());
        for (String original : body.split("[\\n；;]")) {
            String line = original.strip(); if (line.isEmpty()) continue;
            if (NOTICE.matcher(line).matches()) { notice = true; continue; }
            if (notice) continue;
            var title = TITLE.matcher(line);
            boolean hasTitle = title.find();
            if (hasTitle || line.matches("蛋糕预定单|蛋糕预订单|蛋糕订购单")) {
                if (items.size() >= 20) { itemOverflow = true; current = null; issues.add("商品区块超过20个，请手工补充，原文已保留"); unmapped.add(line); continue; }
                current = addItem(items); itemOverflow = false;
                put(current.fields, "productType", field("CAKE", hasTitle ? line.substring(0, title.end()).strip() : line));
                line = hasTitle ? line.substring(title.end()).strip() : "";
                if (line.isEmpty()) continue;
            }
            var heading = ITEM_HEADING.matcher(line);
            if (heading.matches()) {
                if (items.size() == 1 && current != null && current.fields.entrySet().stream()
                        .noneMatch(e -> !e.getKey().equals("productType") && e.getValue().source() != null)) items.clear();
                if (items.size() >= 20) { itemOverflow = true; current = null; issues.add("商品区块超过20个，请手工补充，原文已保留"); unmapped.add(line); continue; }
                current = addItem(items); itemOverflow = false;
                if (heading.group(1).equals("蛋糕")) put(current.fields, "productType", field("CAKE", line));
                if (!heading.group(2).isBlank()) product(current, heading.group(2), line);
                continue;
            }
            var matches = new ArrayList<Match>(); var matcher = LABEL.matcher(line);
            while (matcher.find()) matches.add(new Match(matcher.start(), matcher.end(), matcher.group(1), matcher.group(2)));
            if (matches.isEmpty()) {
                if (current != null) inline(current, line);
                fragments.add(new Fragment(current == null ? null : current.id, line)); unmapped.add(line); continue;
            }
            for (int i = 0; i < matches.size(); i++) {
                var match = matches.get(i);
                String value = line.substring(match.end, i + 1 < matches.size() ? matches.get(i + 1).start : line.length()).strip().replaceFirst("[，,\\s]+$", "");
                String key = LABELS.get(match.label), evidence = line.substring(match.start, i + 1 < matches.size() ? matches.get(i + 1).start : line.length()).strip();
                if (key.equals("unmapped")) { unmapped.add(evidence); continue; }
                if (key.equals("receiveTime")) {
                    assign(fields, "requestedReceiveDate", value, evidence);
                    if (RecognitionValues.containsTime(value)) times.computeIfAbsent("plannedHandoffAt", k -> new ArrayList<>()).add(value);
                    continue;
                }
                if (key.equals("plannedHandoffAt") || key.equals("plannedFinishAt")) { if (!value.isBlank()) times.computeIfAbsent(key, k -> new ArrayList<>()).add(value); continue; }
                if (ORDER_FIELDS.contains(key)) { assign(fields, key, value, evidence); continue; }
                if (itemOverflow) { unmapped.add(evidence); continue; }
                if (current == null) current = addItem(items);
                if (key.equals("name")) product(current, value, evidence);
                else if (key.equals("legacyFlavor")) legacyFlavor(current, value, evidence, match.hint != null, fragments);
                else assign(current.fields, key, value, evidence);
            }
        }
        for (var time : times.entrySet()) for (String raw : time.getValue()) {
            try {
                String date;
                try { date = RecognitionValues.date(raw); }
                catch (IllegalArgumentException missingDate) {
                    if (RecognitionValues.containsDate(raw)) throw missingDate;
                    date = fields.get("requestedReceiveDate").value();
                    if (date == null) throw new IllegalArgumentException("缺少与时刻对应的明确日期");
                }
                String value = date + "T" + RecognitionValues.time(raw);
                var evidence = new ArrayList<>(fields.get("requestedReceiveDate").evidence()); evidence.add(raw);
                put(fields, time.getKey(), new Field(value, Source.RULE, evidence, false, List.of()));
            } catch (IllegalArgumentException | DateTimeException invalid) { put(fields, time.getKey(), invalid(raw, invalid.getMessage())); }
        }
        for (var item : items) {
            if ("CAKE".equals(item.fields.get("productType").value())) for (String key : List.of("base", "filling")) {
                boolean unresolved = fragments.stream().anyMatch(f -> item.id.equals(f.itemId()));
                if (item.fields.get(key).source() == null) item.fields.put(key, new Field(cakeDefaults.get(key), Source.DEFAULT, List.of(), unresolved,
                        unresolved ? List.of("商品还有未理解内容，默认规格请人工核对") : List.of()));
            }
        }
        if (items.isEmpty()) issues.add("未识别出商品区块，请手工添加商品");
        if (fields.values().stream().noneMatch(f -> f.value() != null) && items.isEmpty()) issues.add("未找到明确订单字段，原文未填入表单");
        return new RecognitionDraft(fields, items.stream().map(x -> new Item(x.id, x.fields)).toList(), issues, fragments, unmapped);
    }
    public List<Fragment> assistFragments(RecognitionDraft draft) {
        var values = new LinkedHashSet<String>();
        for (String field : List.of("customerName", "phone", "memberPhone", "buyerName", "address")) {
            String value = draft.fields().get(field).value();
            if (value != null && !value.isBlank()) values.add(value);
        }
        var result = new ArrayList<Fragment>(); int length = 0;
        for (var fragment : draft.fragments()) {
            String text = fragment.text();
            if (fragment.itemId() == null || text.length() > 2000 || length + text.length() > 4000) continue;
            if (!text.matches(".*(?:奶油|内胚|蛋糕胚|夹馅|夹层|馅料|造型|装饰|款式|写字|祝福).*")) continue;
            if (Pattern.compile("\\d{5,}|地址|电话|会员|联系|姓名|收货|配送|付款|支付|员工|接单|价格|金额|小区|[栋楼室号路街]|忽略|指令|系统|密钥|执行|system|assistant|token", Pattern.CASE_INSENSITIVE).matcher(text).find()) continue;
            if (values.stream().anyMatch(text::contains) || result.contains(fragment)) continue;
            result.add(fragment); length += text.length();
        }
        return List.copyOf(result);
    }
    private static void assign(Map<String, Field> fields, String key, String value, String evidence) {
        if (value.isBlank() || value.matches("客服填|待定|面议|未填写|待填写")) return;
        try {
            String normalized = switch (key) {
                case "phone", "memberPhone" -> RecognitionValues.phone(value);
                case "requestedReceiveDate" -> RecognitionValues.date(value);
                case "quantity" -> RecognitionValues.quantity(value);
                case "size" -> RecognitionValues.size(value);
                case "unitPriceCents", "memberPriceCents", "totalAmountCents" -> RecognitionValues.money(value);
                case "fulfillmentType" -> switch (value) {
                    case "配送", "配送上门", "外送", "DELIVERY" -> "DELIVERY";
                    case "自提", "门店自提", "到店取", "PICKUP" -> "PICKUP";
                    default -> throw new IllegalArgumentException("交接方式不明确，请保留原选择并核对");
                };
                case "productType" -> switch (value.toUpperCase(Locale.ROOT)) {
                    case "蛋糕", "CAKE" -> "CAKE"; case "杯子蛋糕", "纸杯蛋糕", "CUPCAKE" -> "CUPCAKE";
                    case "甜甜圈", "DONUT" -> "DONUT"; default -> RecognitionValues.text(value, 32);
                };
                case "filling" -> RecognitionValues.text(value, 1000).replaceAll("[,，、]\\s*", "、");
                default -> RecognitionValues.text(value, key.equals("customerName") || key.equals("buyerName") ? 80 : key.equals("name") ? 128 : 2000);
            };
            put(fields, key, field(normalized, evidence));
        } catch (IllegalArgumentException | DateTimeException invalid) { put(fields, key, invalid(evidence, invalid.getMessage())); }
    }
    private static void product(MutableItem item, String value, String evidence) {
        if (value.isBlank()) return;
        String name = value.split("[，,]", 2)[0].strip();
        if (!SIZE.matcher(name).find() && !QUANTITY.matcher(name).find()) assign(item.fields, "name", name, evidence);
        if (value.contains("杯子蛋糕") || value.contains("纸杯蛋糕")) put(item.fields, "productType", field("CUPCAKE", evidence));
        else if (value.contains("甜甜圈")) put(item.fields, "productType", field("DONUT", evidence));
        else if (value.contains("蛋糕")) put(item.fields, "productType", field("CAKE", evidence));
        inline(item, value);
    }
    private static void inline(MutableItem item, String value) {
        var sizes = SIZE.matcher(value); var found = new LinkedHashSet<String>(); while (sizes.find()) found.add(sizes.group());
        if (found.size() == 1) assign(item.fields, "size", found.iterator().next(), value);
        else if (found.size() > 1) put(item.fields, "size", invalid(value, "同一商品有多个尺寸，请核对"));
        var quantities = QUANTITY.matcher(value); found.clear(); while (quantities.find()) found.add(quantities.group(1));
        if (found.size() == 1) assign(item.fields, "quantity", found.iterator().next(), value);
        else if (found.size() > 1) put(item.fields, "quantity", invalid(value, "同一商品有多个数量，请核对"));
    }
    private static void legacyFlavor(MutableItem item, String value, String evidence, boolean templateHint, List<Fragment> fragments) {
        if (value.isBlank()) return;
        var fillings = new ArrayList<String>(); boolean explicit = templateHint;
        for (String token : value.split("[,，、]")) {
            token = token.strip();
            if (token.contains("奶油")) { assign(item.fields, "flavor", token, evidence); continue; }
            var base = Pattern.compile("^(.+?)(?:蛋糕胚|内胚|胚)$").matcher(token);
            if (base.matches()) { assign(item.fields, "base", base.group(1), evidence); continue; }
            var combined = Pattern.compile("^(.+?)(?:胚)?夹(.+)$").matcher(token);
            if (combined.matches() && !token.startsWith("夹") && !token.endsWith("夹馅") && !token.endsWith("夹层") && !token.endsWith("馅料")) {
                assign(item.fields, "base", combined.group(1), evidence); fillings.add(combined.group(2)); explicit = true; continue;
            }
            if (token.contains("夹馅") || token.contains("夹层") || token.contains("馅料")) explicit = true;
            String filling = token.replaceFirst("^(?:夹层|夹馅|馅料)\\s*", "").replaceFirst("(?:夹层|夹馅|馅料)$", "").strip();
            if (!filling.isBlank()) fillings.add(filling);
        }
        String filling = String.join("、", fillings);
        if (filling.isBlank()) return;
        if (explicit) {
            if (!filling.isBlank()) assign(item.fields, "filling", filling, evidence);
        } else {
            item.fields.put("filling", new Field(filling, Source.RULE, List.of(evidence), true, List.of("旧口味字段含义不明确，请核对夹馅；没有据此填写奶油")));
            fragments.add(new Fragment(item.id, evidence));
        }
    }
    private static Field field(String value, String evidence) { return new Field(value, Source.RULE, List.of(evidence), false, List.of()); }
    private static Field invalid(String evidence, String issue) { return new Field(null, Source.RULE, List.of(evidence), true, List.of(issue)); }
    private static void put(Map<String, Field> fields, String key, Field next) {
        Field before = fields.getOrDefault(key, Field.missing());
        if (before.source() == null) { fields.put(key, next); return; }
        var evidence = new ArrayList<>(before.evidence()); evidence.addAll(next.evidence());
        if (Objects.equals(before.value(), next.value()) && !before.needsReview() && !next.needsReview())
            fields.put(key, new Field(before.value(), Source.RULE, evidence, false, List.of()));
        else fields.put(key, new Field(null, Source.RULE, evidence, true, List.of("同一字段出现冲突或无效内容，请人工核对")));
    }
    private static LinkedHashMap<String, Field> empty(List<String> keys) { var map = new LinkedHashMap<String, Field>(); keys.forEach(k -> map.put(k, Field.missing())); return map; }
    private static MutableItem addItem(List<MutableItem> items) { var item = new MutableItem("item-" + (items.size() + 1), empty(ITEM_FIELDS)); items.add(item); return item; }
    private record MutableItem(String id, LinkedHashMap<String, Field> fields) { }
    private record Match(int start, int end, String label, String hint) { }
    private static Map<String, String> labels() {
        var map = new LinkedHashMap<String, String>();
        add(map, "customerName", "客户姓名", "收货人", "联系人", "姓名"); add(map, "phone", "联系电话", "收货电话", "手机号", "电话");
        add(map, "memberPhone", "会员手机号", "会员手机", "会员电话"); add(map, "buyerName", "客户下单人", "下单人");
        add(map, "address", "配送地址", "收货地址", "地址"); add(map, "fulfillmentType", "配送方式", "交接方式", "交付方式", "取货方式");
        add(map, "requestedReceiveDate", "收货日期", "取货日期", "配送日期", "日期"); add(map, "receiveTime", "收货时间", "取货时间");
        add(map, "plannedHandoffAt", "计划交接时间", "交接时间"); add(map, "plannedFinishAt", "计划出品时间", "出品时间");
        add(map, "totalAmountCents", "订单总金额", "约定总金额", "订单总价", "总金额", "总价", "合计");
        add(map, "name", "商品名称", "蛋糕名称", "小产品名称", "商品"); add(map, "productType", "商品类型", "类型"); add(map, "quantity", "数量");
        add(map, "size", "蛋糕尺寸", "尺寸"); add(map, "flavor", "奶油类型", "奶油"); add(map, "base", "蛋糕胚", "内胚");
        add(map, "filling", "夹馅", "夹层", "馅料"); add(map, "legacyFlavor", "蛋糕口味", "口味");
        add(map, "message", "祝福语", "蛋糕写字"); add(map, "requirements", "其他要求", "特殊要求", "备注");
        add(map, "unitPriceCents", "商品单价", "单价"); add(map, "memberPriceCents", "会员单价", "会员价");
        add(map, "unmapped", "订购方式", "付款方式", "支付方式", "接单人", "接单员工", "制作师傅", "价格");
        return Collections.unmodifiableMap(map);
    }
    private static void add(Map<String, String> map, String key, String... labels) { for (String label : labels) map.put(label, key); }
}
