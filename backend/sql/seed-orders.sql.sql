USE shopeefood_db;

INSERT INTO orders (
    order_code,
    customer_name,
    customer_phone,
    delivery_address,
    total_amount,
    status
)
SELECT 'SF001', 'Khách mẫu A', '0900000001',
       'Địa chỉ thử nghiệm A', 85000, 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE order_code = 'SF001'
);

INSERT INTO orders (
    order_code,
    customer_name,
    customer_phone,
    delivery_address,
    total_amount,
    status
)
SELECT 'SF002', 'Khách mẫu B', '0900000002',
       'Địa chỉ thử nghiệm B', 120000, 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE order_code = 'SF002'
);

INSERT INTO orders (
    order_code,
    customer_name,
    customer_phone,
    delivery_address,
    total_amount,
    status
)
SELECT 'SF003', 'Khách mẫu C', '0900000003',
       'Địa chỉ thử nghiệm C', 65000, 'confirmed'
WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE order_code = 'SF003'
);

SELECT order_code, customer_name, total_amount, status
FROM orders
WHERE status = 'pending'
ORDER BY created_at DESC, id DESC;