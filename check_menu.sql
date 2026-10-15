-- ============================================================
-- NocoBase 菜单显示排查脚本
-- 检查 "AI 驱动售后处理工作台" (batch-workbench-b) 不显示的原因
-- ============================================================

-- 1. 检查 desktopRoutes 表中 batch-workbench-b 的完整记录
--    重点关注: hidden, hideInMenu, parentId, options 字段
SELECT 
    id,
    title,
    type,
    schemaUid,
    menuSchemaUid,
    parentId,
    sort,
    hidden,
    "hideInMenu",
    "enableTabs",
    "enableHeader",
    "displayTitle",
    icon,
    options,
    "createdAt",
    "updatedAt"
FROM desktopRoutes
WHERE id = 391579387559937;

-- 2. 对比检查正常显示的 batch-workbench (非B版本)
SELECT 
    id,
    title,
    type,
    schemaUid,
    menuSchemaUid,
    parentId,
    sort,
    hidden,
    "hideInMenu",
    "enableTabs",
    "enableHeader",
    "displayTitle",
    icon,
    options,
    "createdAt",
    "updatedAt"
FROM desktopRoutes
WHERE schemaUid = 'er8ktx89che';

-- 3. 检查父级路由是否正常 (AI 驱动售后处理 分组)
SELECT 
    id,
    title,
    type,
    schemaUid,
    parentId,
    sort,
    hidden,
    "hideInMenu",
    options
FROM desktopRoutes
WHERE id = 377981514874880;

-- 4. 检查 rolesDesktopRoutes 关联（确认 B 版本有权限）
SELECT 
    r.id AS role_id,
    r.name AS role_name,
    r.title AS role_title,
    dr.id AS route_id,
    dr.title AS route_title,
    dr.type,
    dr.hidden,
    dr."hideInMenu"
FROM rolesDesktopRoutes rdr
JOIN roles r ON r.id = rdr.roleId
JOIN desktopRoutes dr ON dr.id = rdr.desktopRouteId
WHERE dr.id = 391579387559937
ORDER BY r.name;

-- 5. 检查同一父级下所有子菜单的完整数据（对比排序和可见性）
SELECT 
    id,
    title,
    type,
    schemaUid,
    sort,
    hidden,
    "hideInMenu",
    options
FROM desktopRoutes
WHERE parentId = 377981514874880
ORDER BY sort;

-- 6. 检查 uiSchemas 表中是否存在相关的 schemaUid
SELECT uid, name, title, "isLeaf", "parentUid", "snapshot"
FROM uiSchemas
WHERE uid IN ('asbguideb01', 'er8ktx89che');

-- 7. 检查 flowModels 表中是否有相关记录
SELECT uid, name, "key", "eventName", type, enabled
FROM flowModels
WHERE uid IN ('asbguideb01', 'er8ktx89che');

-- 8. 检查 rolesUischemas 表的权限
SELECT 
    r.name AS role_name,
    us.schemaUid,
    us.roleId
FROM "rolesUischemas" us
JOIN roles r ON r.id = us.roleId
WHERE us.schemaUid IN ('asbguideb01', 'er8ktx89che')
ORDER BY r.name, us.schemaUid;

-- 9. 检查 uiSchemaTreePath 表
SELECT "ancestor", "descendant", depth, type
FROM "uiSchemaTreePath"
WHERE "ancestor" IN ('asbguideb01', 'er8ktx89che')
   OR "descendant" IN ('asbguideb01', 'er8ktx89che');

-- 10. 检查数据是否与 10/14 备份一致
-- 对比所有 batch-workbench 相关的 desktopRoutes
SELECT *
FROM desktopRoutes
WHERE title LIKE '%售后%' OR title LIKE '%workbench%' OR title LIKE '%工作台%'
ORDER BY parentId, sort;