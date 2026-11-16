-- 扩展岗位选择，不推定或修改任何存量员工的岗位分配。
ALTER TABLE identity_account_role ALTER COLUMN role TYPE VARCHAR(32);
ALTER TABLE identity_account_role DROP CONSTRAINT identity_account_role_role_check;
ALTER TABLE identity_account_role ADD CONSTRAINT identity_account_role_role_check
    CHECK (role IN ('STORE_MANAGER', 'PASTRY_SUPERVISOR', 'FRONT_DESK_SUPERVISOR',
                    'DECORATOR', 'BAKER', 'FRONT_DESK_CLERK',
                    'MANAGER', 'FRONT_DESK', 'PASTRY_CHEF'));
