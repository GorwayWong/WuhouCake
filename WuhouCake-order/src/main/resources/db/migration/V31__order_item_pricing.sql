ALTER TABLE cake_order ADD COLUMN pricing_mode varchar(16) NOT NULL DEFAULT 'MANUAL' CHECK (pricing_mode IN ('MANUAL', 'ITEM_SUM'));
