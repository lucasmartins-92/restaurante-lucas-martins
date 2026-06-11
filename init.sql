DROP DATABASE IF EXISTS lucasmartinsdb;
CREATE DATABASE IF NOT EXISTS lucasmartinsdb;
USE lucasmartinsdb;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    category VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    item_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'Aberto',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id)
);

INSERT INTO items (name, price, category) VALUES 
('Arroz Branco', 5.00, 'Acompanhamento'),
('Feijão Preto', 7.50, 'Acompanhamento'),
('Frango Grelhado', 18.90, 'Proteína'),
('Bife Acebolado', 22.50, 'Proteína'),
('Salada Mista', 9.00, 'Acompanhamento');
