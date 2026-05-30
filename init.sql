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

-- SENHA: admin123 (hasheada com HMAC-SHA256 + salt, formato: salt:hash)
INSERT INTO users (username, password) VALUES 
('admin', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4:18790963ae27d0273292ddda92ed337ae2492c920badc3a854c32eaefabcaf92');

INSERT INTO items (name, price, category) VALUES 
('Arroz Branco', 5.00, 'Base'),
('Feijão Preto', 7.50, 'Grão'),
('Frango Grelhado', 18.90, 'Proteína'),
('Bife Acebolado', 22.50, 'Proteína'),
('Salada Mista', 9.00, 'Acompanhamento');