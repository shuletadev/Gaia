-- Pulpería Don Beto (ficticia): inventario de una pulpería de barrio. Datos inventados para clase.
-- labctl ejecuta este script al terminar el despliegue; los lotes se separan con GO.

CREATE TABLE categorias (
    id      INT           NOT NULL PRIMARY KEY,
    nombre  NVARCHAR(40)  NOT NULL
);
GO

CREATE TABLE proveedores (
    id        INT            NOT NULL PRIMARY KEY,
    nombre    NVARCHAR(80)   NOT NULL,
    telefono  NVARCHAR(20)   NULL
);
GO

CREATE TABLE productos (
    id            INT            NOT NULL PRIMARY KEY,
    nombre        NVARCHAR(80)   NOT NULL,
    categoria_id  INT            NOT NULL REFERENCES categorias(id),
    proveedor_id  INT            NOT NULL REFERENCES proveedores(id),
    precio        DECIMAL(10,2)  NOT NULL,   -- colones
    stock         INT            NOT NULL,
    stock_minimo  INT            NOT NULL
);
GO

CREATE TABLE movimientos (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    producto_id  INT           NOT NULL REFERENCES productos(id),
    tipo         NVARCHAR(10)  NOT NULL CHECK (tipo IN ('venta', 'compra')),
    cantidad     INT           NOT NULL,
    fecha        DATE          NOT NULL
);
GO

INSERT INTO categorias (id, nombre) VALUES
    (1, N'Granos y básicos'), (2, N'Lácteos y huevos'), (3, N'Bebidas'),
    (4, N'Abarrotes'), (5, N'Limpieza y hogar'), (6, N'Panadería');
GO

INSERT INTO proveedores (id, nombre, telefono) VALUES
    (1, N'Distribuidora La Meseta (ficticia)', N'2222-0001'),
    (2, N'Lácteos del Valle (ficticia)',       N'2222-0002'),
    (3, N'Bebidas Tropicales (ficticia)',      N'2222-0003'),
    (4, N'Panadería La Espiga (ficticia)',     N'2222-0004');
GO

INSERT INTO productos (id, nombre, categoria_id, proveedor_id, precio, stock, stock_minimo) VALUES
    ( 1, N'Arroz 1 kg',                 1, 1,  1350, 40, 15),
    ( 2, N'Frijoles negros 1 kg',       1, 1,  1900, 22, 10),
    ( 3, N'Azúcar 2 kg',                1, 1,  1800, 30, 10),
    ( 4, N'Sal 1 kg',                   1, 1,   650, 18,  8),
    ( 5, N'Aceite vegetal 1 L',         1, 1,  2300,  6, 10),
    ( 6, N'Café molido 500 g',          4, 1,  3900, 14,  8),
    ( 7, N'Atún en lata',               4, 1,  1400, 35, 12),
    ( 8, N'Salsa Lizano 700 ml',        4, 1,  2650, 12,  6),
    ( 9, N'Leche entera 1 L',           2, 2,  1100, 28, 20),
    (10, N'Huevos (docena)',            2, 2,  2700,  9, 12),
    (11, N'Queso fresco 500 g',         2, 2,  3600,  7,  6),
    (12, N'Natilla 250 ml',             2, 2,  1300, 11,  8),
    (13, N'Gaseosa 2 L',                3, 3,  2200, 24, 12),
    (14, N'Agua 600 ml',                3, 3,   750, 48, 24),
    (15, N'Jugo de naranja 1 L',        3, 3,  1750,  5,  8),
    (16, N'Detergente en polvo 1 kg',   5, 1,  2900, 10,  5),
    (17, N'Jabón de baño',              5, 1,   850, 26, 10),
    (18, N'Papel higiénico (4 rollos)', 5, 1,  1950, 20, 10),
    (19, N'Pan de caja',                6, 4,  1800,  4,  8),
    (20, N'Tortillas de maíz (paquete)',6, 4,  1200,  8, 10);
GO

INSERT INTO movimientos (producto_id, tipo, cantidad, fecha) VALUES
    (1, 'venta', 12, '2025-09-29'), (1, 'compra', 40, '2025-09-30'),
    (5, 'venta', 14, '2025-09-29'), (5, 'compra', 12, '2025-09-26'),
    (10, 'venta', 21, '2025-09-30'), (10, 'compra', 24, '2025-09-27'),
    (19, 'venta', 16, '2025-09-30'), (19, 'compra', 12, '2025-09-29'),
    (14, 'venta', 30, '2025-09-28'), (14, 'compra', 48, '2025-09-25'),
    (9, 'venta', 25, '2025-09-30'), (9, 'compra', 36, '2025-09-28'),
    (15, 'venta', 9, '2025-09-29'), (20, 'venta', 11, '2025-09-30'),
    (13, 'venta', 8, '2025-09-29'), (2, 'venta', 6, '2025-09-30');
GO

-- Las preguntas de Don Beto, ya resueltas como vistas: ¿qué se está acabando y cuánto vale mi inventario?
CREATE VIEW v_stock_bajo AS
SELECT p.id, p.nombre, p.stock, p.stock_minimo, pr.nombre AS proveedor
FROM productos p
JOIN proveedores pr ON pr.id = p.proveedor_id
WHERE p.stock < p.stock_minimo;
GO

CREATE VIEW v_valor_inventario AS
SELECT c.nombre AS categoria, SUM(p.stock * p.precio) AS valor_colones, COUNT(*) AS productos
FROM productos p
JOIN categorias c ON c.id = p.categoria_id
GROUP BY c.nombre;
GO
