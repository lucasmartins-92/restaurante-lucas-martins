DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100),
    item_id INT NOT NULL,
    status VARCHAR(20) DEFAULT 'Aberto'
);

ALTER TABLE orders
    ADD CONSTRAINT fk_orders_items
    FOREIGN KEY (item_id) REFERENCES items(id);

INSERT INTO items (name, category, price) VALUES ('Arroz Branco', 'Base', 12.50), ('Feijão Preto', 'Grão', 10.00);
