const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();

const dbConfig = {
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASS || 'password',
    database: process.env.DB_NAME || 'marmitadb'
};

let pool;
const BCRYPT_SALT_ROUNDS = 10;

async function connectWithRetry() {
    console.log('🔍 [INFRA] Tentando conectar ao MySQL...');
    for (let i = 1; i <= 10; i++) {
        try {
            pool = mysql.createPool(dbConfig);
            await pool.query('SELECT 1');
            console.log('✅ [DATABASE] Conectado ao MySQL com sucesso!');
            return;
        } catch (err) {
            console.log(`⚠️ [DATABASE] Tentativa ${i}/10 falhou. Aguardando...`);
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    process.exit(1);
}

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

async function loadDashboardData() {
    const [items] = await pool.query('SELECT * FROM items');
    const [orders] = await pool.query(
        `SELECT
            orders.id,
            orders.customer_name,
            orders.status,
            orders.item_id,
            items.name AS item_name,
            items.category AS item_category,
            items.price AS item_price
            FROM orders
            LEFT JOIN items ON items.id = orders.item_id
         ORDER BY orders.id DESC`
    );
    return { items, orders };
}

async function ensureItemsSchema() {
    const [columns] = await pool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'items'
           AND COLUMN_NAME = 'price'`,
        [dbConfig.database]
    );

    if (columns.length === 0) {
        console.log('🛠️ [DATABASE] Adicionando coluna price à tabela items...');
        await pool.query('ALTER TABLE items ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER category');
    }
}

async function ensureOrdersSchema() {
    const [columns] = await pool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'orders'
           AND COLUMN_NAME = 'item_id'`,
        [dbConfig.database]
    );

    if (columns.length === 0) {
        console.log('🛠️ [DATABASE] Adicionando coluna item_id à tabela orders...');
        await pool.query('ALTER TABLE orders ADD COLUMN item_id INT NULL AFTER customer_name');
    }
}

function validateItemInput({ name, price, category }) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    const parsedPrice = Number(price);

    if (!normalizedName) {
        return { error: 'O nome não pode estar vazio.' };
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return { error: 'O preço da marmita deve ser um número positivo.' };
    }

    return {
        name: normalizedName,
        category: normalizedCategory || null,
        price: parsedPrice
    };
}

function validateOrderInput({ customer_name, item_id }) {
    const normalizedCustomerName = typeof customer_name === 'string' ? customer_name.trim() : '';
    const parsedItemId = Number(item_id);

    if (!normalizedCustomerName) {
        return { error: 'O nome do cliente não pode estar vazio.' };
    }

    if (!Number.isInteger(parsedItemId) || parsedItemId <= 0) {
        return { error: 'Selecione uma marmita válida.' };
    }

    return {
        customerName: normalizedCustomerName,
        itemId: parsedItemId
    };
}

app.get('/', (req, res) => res.render('login', { error: null }));

app.get('/cadastro', (req, res) => res.render('cadastro', { error: null }));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT password FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).render('login', { error: 'Usuário ou senha inválidos.' });
        }

        const storedPassword = rows[0].password;
        const isValidPassword = await bcrypt.compare(password, storedPassword);

        if (isValidPassword) res.redirect('/dashboard');
        else res.status(401).render('login', { error: 'Usuário ou senha inválidos.' });
    } catch (err) {
        res.status(500).render('login', { error: 'Erro no banco. Tente novamente.' });
    }
});

app.post('/cadastro', async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).render('cadastro', { error: 'As senhas não conferem.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        res.redirect('/');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).render('cadastro', { error: 'Usuário já existe.' });
        }
        res.status(500).render('cadastro', { error: 'Erro ao cadastrar usuário.' });
    }
});

app.post('/add-item', async (req, res) => {
    const validation = validateItemInput(req.body);

    if (validation.error) {
        const { items, orders } = await loadDashboardData();
        return res.status(400).render('dashboard', {
            items,
            orders,
            error: validation.error
        });
    }

    try {
        const { name, category, price } = validation;
        await pool.query(
            'INSERT INTO items (name, category, price) VALUES (?, ?, ?)',
            [name, category, price]
        );

        res.redirect('/dashboard');
    } catch (err) {
        const { items, orders } = await loadDashboardData();
        res.status(500).render('dashboard', {
            items,
            orders,
            error: 'Erro ao cadastrar item.'
        });
    }
});

app.post('/orders', async (req, res) => {
    const validation = validateOrderInput(req.body);

    if (validation.error) {
        const { items, orders } = await loadDashboardData();
        return res.status(400).render('dashboard', {
            items,
            orders,
            error: validation.error
        });
    }

    try {
        const { customerName, itemId } = validation;
        const [items] = await pool.query('SELECT id FROM items WHERE id = ?', [itemId]);

        if (items.length === 0) {
            const dashboardData = await loadDashboardData();
            return res.status(400).render('dashboard', {
                ...dashboardData,
                error: 'A marmita selecionada não existe.'
            });
        }

        await pool.query(
            'INSERT INTO orders (customer_name, item_id, status) VALUES (?, ?, ?)',
            [customerName, itemId, 'Aberto']
        );

        res.redirect('/dashboard');
    } catch (err) {
        const { items, orders } = await loadDashboardData();
        res.status(500).render('dashboard', {
            items,
            orders,
            error: 'Erro ao registrar pedido.'
        });
    }
});

app.get('/dashboard', async (req, res) => {
    const { items, orders } = await loadDashboardData();
    res.render('dashboard', { items, orders, error: null });
});

connectWithRetry()
    .then(async () => {
        await ensureItemsSchema();
        await ensureOrdersSchema();
        app.listen(3000, () => console.log('🚀 MARMITATECH PRO ONLINE NA PORTA 3000'));
    })
    .catch(err => {
        console.error('❌ [DATABASE] Falha ao iniciar aplicação:', err);
        process.exit(1);
    });
