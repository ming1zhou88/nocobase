-- ============================================================
-- 修复 B 页菜单显示问题
-- 在服务器 PostgreSQL 中执行
-- ============================================================

-- Step 1: 检查 B 页记录是否存在
SELECT id, title, type, "parentId", sort, hidden, options
FROM desktopRoutes
WHERE id = 391579387559937;

-- Step 2: 如果上面返回空，则 INSERT B 页记录
-- 注意：如果记录已存在，跳过此步
INSERT INTO desktopRoutes (id, "parentId", title, type, "schemaUid", sort, hidden, "hideInMenu", options, "createdBy", "updatedBy", "createdAt", "updatedAt")
VALUES (
    391579387559937,
    377981514874880,
    'AI 驱动售后处理工作台',
    'link',
    'asbguideb01',
    2,
    false,
    false,
    '{"href":"/admin/after-sales/batch-workbench-b","params":[],"openInNewWindow":false}',
    1,
    1,
    NOW(),
    NOW()
);

-- Step 3: 检查 rolesDesktopRoutes 权限
SELECT r.id as role_id, r.name, rdr."desktopRouteId"
FROM rolesDesktopRoutes rdr
JOIN roles r ON r.id = rdr."roleId"
WHERE rdr."desktopRouteId" = 391579387559937;

-- Step 4: 如果上面返回空，则添加 root 角色的权限
-- 先找到 root 角色的 ID
SELECT id, name FROM roles WHERE name = 'root';

-- 假设 root 角色 ID 是 1（根据之前的记录），添加权限
-- 如果 root ID 不是 1，需要修改下面的 roleId
INSERT INTO rolesDesktopRoutes ("roleId", "desktopRouteId")
SELECT 1, 391579387559937
WHERE NOT EXISTS (
    SELECT 1 FROM rolesDesktopRoutes 
    WHERE "roleId" = 1 AND "desktopRouteId" = 391579387559937
);

-- 如果有其他角色也需要访问（如 member），可以用类似方式添加
-- INSERT INTO rolesDesktopRoutes ("roleId", "desktopRouteId")
-- SELECT role_id, 391579387559937
-- FROM roles WHERE name IN ('member', 'admin')
-- ON CONFLICT DO NOTHING;

-- Step 5: 验证修复结果
SELECT id, title, type, "parentId", sort, hidden
FROM desktopRoutes
WHERE "parentId" = 377981514874880
ORDER BY sort;