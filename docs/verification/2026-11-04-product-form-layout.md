# 商品表单布局与兼容性验证

## 当前行为

员工新建、追加及编辑、客户扫码及核对、套餐编辑使用共享字段排布。类型选择位于商品标题区，蛋糕名称占整行；规格（寸）/数量与蛋糕胚/夹馅分别成对，奶油、祝福语、特殊要求各占整行。360px 及以上成对字段两列，更窄屏幕单列，错误与默认提示可换行，成对控件顶边对齐。

- `size` 和 `base` 只改变显示标签，不改接口或草稿字段；非蛋糕 `specification` 保留文字规格语义。
- 员工录单及套餐尺寸沿用可留空规则，客户扫码与核对尺寸仍必填。结构化历史规格继续只读保留，未改动的异常旧尺寸不妨碍其他字段更正。
- 套餐默认提示明确下单时生效，套餐保存不写入默认内胚、夹馅或奶油。空名称但已选图片的商品视为已有内容，套餐追加时保留该商品与图片文件。
- 商品字段容器和图片组件使用不同的 React sibling key；识别替换和商品切换后只显示当前一组字段，不保留重名控件，业务商品 UUID 不变。
- 识别标题“规格（寸）／规格(寸)”与原“尺寸／蛋糕尺寸”映射 `size`；普通“规格：300ml”继续映射文字规格，不据此推断商品类型。
- 分类错误定位至标题区，商品字段错误按视觉顺序定位；多商品录单自动切换到对应商品。根字段保留原有校验优先级。
- 蛋糕单价隐藏、其他商品单价选填、每商品 5 张图、图片归属、草稿恢复、识别撤销及待确认创建请求的原始载荷继续保留。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 前端单元测试 | 150 项通过 |
| 前端构建 | 通过 |
| Chromium 浏览器回归 | 33 项通过，含 7 项布局场景及价格、图片、草稿回归 |
| 后端识别及 ArchUnit | 110 项通过 |
| git diff --check | 通过 |

新增布局场景逐入口验证 320、360、390、1440px 的 DOM 顺序、整行宽度、配对位置与顶边对齐、无横向溢出，以及分类入口和必填状态。覆盖识别标记、Tab 顺序、多商品错误聚焦、未知类型确认、历史结构化规格、异常尺寸、套餐空规格及带图套餐追加。浏览器检查使用真实 Chromium 和 IndexedDB，HTTP 接口由测试模拟。

后端识别验证新旧尺寸标签、中英文括号、普通文字规格及混合商品字段隔离。没有持久化或装配变更，没有新增数据库迁移，本轮未重跑完整数据库集成套件。

## 复验命令

```sh
cd frontend
npm test
npm run build
# 启动本地 Vite，PLAYWRIGHT_MODULE 使用本机可用的 playwright 包路径。
DRAFT_TEST_URL=http://127.0.0.1:5210 PLAYWRIGHT_MODULE=/path/to/playwright node --test --test-concurrency=1 tests/productFormLayout.browser.mjs tests/productPricing.browser.mjs tests/itemImages.browser.mjs tests/orderDraft.browser.mjs
```

后端使用 JDK 21：

```sh
./mvnw -pl WuhouCake-bootstrap -am test \
  '-Dtest=OrderRecognitionTest,OrderRecognitionServiceTest,*Architecture*Test' \
  -Dsurefire.failIfNoSpecifiedTests=false
```

## 边界

既有员工归属回归问题保持单独记录，见[商品单价验证](2026-11-04-product-pricing.md#已区分的既有回归问题)，本轮不改动归属逻辑或相关失败用例。订单详情和导出布局不变，已有未提交工作保留，本轮未部署服务器。
