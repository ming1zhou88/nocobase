-- ============================================================
-- 验证 B 页菜单是否存在于 desktopRoutes 表
-- 在服务器 PostgreSQL 中执行
-- ============================================================

-- 1. 检查 B 页记录是否存在
SELECT id, title, type, "parentId", sort, hidden, "hideInMenu", options
FROM desktopRoutes
WHERE id = 391579387559937;

-- 2. 如果上面查询返回空，尝试用 title 搜索
SELECT id, title, type, "parentId", sort, hidden, options
FROM desktopRoutes
WHERE title LIKE '%驱动%' OR title LIKE '%batch-workbench%';

-- 3. 检查 "AI 驱动售后处理" 分组下的所有子菜单
SELECT id, title, type, "parentId", sort, hidden
FROM desktopRoutes
WHERE "parentId" = 377981514874880
ORDER BY sort;

-- 4. 检查 rolesDesktopRoutes 关联（B 页是否有权限）
SELECT r.name, rdr."desktopRouteId", dr.title, dr.type
FROM rolesDesktopRoutes rdr
JOIN roles r ON r.id = rdr."roleId"
JOIN desktopRoutes dr ON dr.id = rdr."desktopRouteId"
WHERE rdr."desktopRouteId" = 391579387559937;

-- 5. 对比 A 页和 B 页的权限
SELECT r.name, rdr."desktopRouteId", dr.title
FROM rolesDesktopRoutes rdr
JOIN roles r ON r.id = rdr."roleId"
JOIN desktopRoutes dr ON dr.id = rdr."desktopRouteId"
WHERE rdr."desktopRouteId" IN (380954072055808, 391579387559937)
ORDER BY rdr."desktopRouteId", r.name;