-- Consultas de ejemplo para el laboratorio "Reporte mensual de ventas".
-- Se ejecutan en Synapse Studio, en el grupo de SQL "Built-in" (sin servidor). Reemplace <CUENTA> por el nombre
-- de la cuenta del data lake (aparece en los resultados del laboratorio). Antes, asígnese el rol
-- "Storage Blob Data Reader" sobre la cuenta: leer datos es un permiso distinto de administrar la cuenta.

-- 1. Ver las primeras filas del archivo, sin cargarlo en ninguna base de datos.
SELECT TOP 10 *
FROM OPENROWSET(
    BULK 'https://<CUENTA>.dfs.core.windows.net/ventas/ventas/ventas.csv',
    FORMAT = 'CSV', PARSER_VERSION = '2.0', HEADER_ROW = TRUE
) AS ventas;

-- 2. Ventas por mes.
SELECT LEFT(fecha, 7) AS mes, COUNT(*) AS lineas, SUM(total) AS colones
FROM OPENROWSET(
    BULK 'https://<CUENTA>.dfs.core.windows.net/ventas/ventas/ventas.csv',
    FORMAT = 'CSV', PARSER_VERSION = '2.0', HEADER_ROW = TRUE
) AS ventas
GROUP BY LEFT(fecha, 7)
ORDER BY mes;

-- 3. Los diez productos que más se venden en la temporada lluviosa (mayo a noviembre).
SELECT TOP 10 producto, SUM(cantidad) AS unidades
FROM OPENROWSET(
    BULK 'https://<CUENTA>.dfs.core.windows.net/ventas/ventas/ventas.csv',
    FORMAT = 'CSV', PARSER_VERSION = '2.0', HEADER_ROW = TRUE
) AS ventas
WHERE MONTH(CAST(fecha AS DATE)) BETWEEN 5 AND 11
GROUP BY producto
ORDER BY unidades DESC;

-- 4. Las horas más ocupadas del día.
SELECT LEFT(hora, 2) AS hora, COUNT(DISTINCT sale_id) AS ventas
FROM OPENROWSET(
    BULK 'https://<CUENTA>.dfs.core.windows.net/ventas/ventas/ventas.csv',
    FORMAT = 'CSV', PARSER_VERSION = '2.0', HEADER_ROW = TRUE
) AS ventas
GROUP BY LEFT(hora, 2)
ORDER BY ventas DESC;
