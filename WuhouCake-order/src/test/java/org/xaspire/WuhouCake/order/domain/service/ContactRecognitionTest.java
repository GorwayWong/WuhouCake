package org.xaspire.WuhouCake.order.domain.service;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import static org.junit.jupiter.api.Assertions.*;

class ContactRecognitionTest {
    private final OrderRecognition parser = new OrderRecognition(CakeSpecifications.DEFAULTS);
    @Test void partialAndMixedLabelContactsKeepIndependentlyRecognizedFields() {
        for (String text : List.of("王女士，13900000000", "王女士 13900000000 地址：四川省成都市武侯区合成路1号")) {
            var fields = parser.parse(text).fields();
            assertEquals("13900000000", fields.get("phone").value()); assertEquals("王女士", fields.get("customerName").value());
            assertTrue(fields.get("customerName").needsReview());
        }
        assertNull(parser.parse("王女士，13900000000").fields().get("address").value());
        var address = parser.parse("四川省成都市武侯区合成路1号").fields();
        assertEquals("四川省成都市武侯区合成路1号", address.get("address").value());
        assertNull(address.get("phone").value()); assertTrue(address.get("address").needsReview());
    }
    @Test void understandsUnlabelledRecipientOrderAndPhoneFormatting() {
        for (String text : List.of("王女士，13900000000，四川省成都市武侯区合成路1号", "四川省成都市武侯区合成路1号\n139 0000 0000\n王女士", "王女士 13900000000 四川省成都市武侯区合成路1号", "收货电话：13900000000\n王女士\n四川省成都市武侯区合成路1号")) {
            var fields = parser.parse(text).fields();
            assertEquals("13900000000", fields.get("phone").value()); assertEquals("王女士", fields.get("customerName").value());
            assertEquals("四川省成都市武侯区合成路1号", fields.get("address").value());
        }
    }
    @Test void businessContactIsNotARecipientAndMultipleCandidatesRequireReview() {
        var ignored = parser.parse("客服电话：02812345678\n门店地址：四川省成都市门店路1号").fields();
        assertNull(ignored.get("phone").value()); assertNull(ignored.get("address").value());
        var spaced = parser.parse("客服 电话：02812345678\n发票 地址：四川省成都市武侯区门店路1号").fields();
        assertNull(spaced.get("phone").value()); assertNull(spaced.get("address").value());
        assertTrue(parser.parse("王女士，13900000000，春熙路1号").fields().get("address").needsReview());
        var multiple = parser.parse("王女士，13900000000，13800000000，四川省成都市武侯区合成路1号").fields();
        assertNull(multiple.get("phone").value()); assertTrue(multiple.get("phone").needsReview()); assertTrue(multiple.get("address").needsReview());
        var address = parser.parse("王女士，13900000000，四川省成都市武侯区合成路1号，四川省成都市青羊区合成路2号").fields();
        assertNull(address.get("address").value()); assertTrue(address.get("address").needsReview());
    }
}
