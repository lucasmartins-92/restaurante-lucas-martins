const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const session = require('express-session');

const app = express();
// Ensure header that exposes framework/version is disabled
app.disable('x-powered-by');

const ORDER_STATUSES = ['Aberto', 'Cozinha', 'Entrega', 'Entregue'];

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

const dbConfig = {
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'user',
    password: requireEnv('DB_PASS'),
    database: process.env.DB_NAME || 'lucasmartinsdb'
};

let pool = null;
const BCRYPT_SALT_ROUNDS = 10;
const SESSION_SECRET = requireEnv('SESSION_SECRET');

const AUTH_PAGE_CONFIGS = {
    login: {
        title: 'Login Premium - Podrão do Lucas',
        cardLabel: 'Acesso ao sistema',
        heading: 'Podrão do Lucas',
        subtitle: 'O sabor autêntico na sua tela.',
        formAction: '/login',
        submitLabel: 'Entrar no Sistema',
        secondaryHref: '/cadastro',
        secondaryLabel: 'Cadastrar Novo Usuário',
        fields: [
            {
                name: 'username',
                type: 'text',
                placeholder: 'Seu usuário',
                ariaLabel: 'Seu usuário',
                autocomplete: 'username'
            },
            {
                name: 'password',
                type: 'password',
                placeholder: 'Sua senha',
                ariaLabel: 'Sua senha',
                autocomplete: 'current-password'
            }
        ],
        showFooterLinks: true,
        footerText: 'Acesso restrito a funcionários.',
        footerLinkText: 'Clique aqui',
        footerLinkHref: '#'
    },
    cadastro: {
        title: 'Cadastro de Usuário - Podrão do Lucas',
        cardLabel: 'Cadastro de usuário',
        heading: 'Podrão do Lucas',
        subtitle: 'Cadastro de novo usuário.',
        formAction: '/cadastro',
        submitLabel: 'Confirmar Cadastro',
        secondaryHref: '/',
        secondaryLabel: 'Voltar para Login',
        fields: [
            {
                name: 'username',
                type: 'text',
                placeholder: 'Nome de usuário',
                ariaLabel: 'Nome de usuário',
                autocomplete: 'username'
            },
            {
                name: 'password',
                type: 'password',
                placeholder: 'Senha',
                ariaLabel: 'Senha',
                autocomplete: 'new-password'
            },
            {
                name: 'confirmPassword',
                type: 'password',
                placeholder: 'Confirmar senha',
                ariaLabel: 'Confirmar senha',
                autocomplete: 'new-password'
            }
        ],
        showFooterLinks: false
    }
};

function renderAuthPage(res, pageKey, error = null) {
    return res.render('auth', {
        ...AUTH_PAGE_CONFIGS[pageKey],
        error
    });
}

async function connectWithRetry() {
    console.log('🔍 [INFRA] Tentando conectar ao MySQL...');
    for (let i = 1; i <= 10; i++) {
        try {
            pool = mysql.createPool(dbConfig);
            await pool.query('SELECT 1');
            console.log('✅ [DATABASE] Conectado ao MySQL com sucesso!');
            return;
        } catch (_err) {
            console.log(`⚠️ [DATABASE] Tentativa ${i}/10 falhou. Aguardando...`);
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    process.exit(1);
}

app.use(express.urlencoded({ limit: '10kb', extended: true }));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 8
    }
}));
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    etag: true,
    lastModified: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

async function loadDashboardData() {
    const [items] = await pool.query('SELECT * FROM items');
    const [orders] = await pool.query(
        'SELECT ' +
        'orders.id, ' +
        'orders.customer_name, ' +
        'orders.status, ' +
        'orders.item_id, ' +
        'items.name AS item_name, ' +
        'items.category AS item_category, ' +
        'items.price AS item_price ' +
        'FROM orders ' +
        'LEFT JOIN items ON items.id = orders.item_id ' +
        "ORDER BY FIELD(orders.status, 'Aberto', 'Cozinha', 'Entrega', 'Entregue'), orders.id DESC"
    );

    const ordersByStatus = ORDER_STATUSES.reduce((columns, status) => {
        columns[status] = [];
        return columns;
    }, {});

    orders.forEach(order => {
        const status = ORDER_STATUSES.includes(order.status) ? order.status : 'Aberto';
        ordersByStatus[status].push(order);
    });

    // Inclui métricas financeiras do mês corrente
    let financeMetrics = {};
    try {
        financeMetrics = await computeMonthlyFinance();
    } catch (err) {
        console.log('Erro ao calcular métricas financeiras:', err instanceof Error ? err.message : String(err));
        financeMetrics = {
            totalValueSold: 0,
            numberOfSales: 0,
            totalItemsSold: 0,
            averageItemsPerSale: 0,
            topProducts: [],
            leastProducts: []
        };
    }

    return { items, orders, ordersByStatus, financeMetrics };
}

async function computeMonthlyFinance() {
    // Verifica se existe created_at na tabela orders
    const [cols] = await pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'orders\' AND COLUMN_NAME = \'created_at\'',
        [dbConfig.database]
    );

    const hasCreatedAt = cols.length > 0;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const summaryParams = hasCreatedAt ? ['Entregue', month, year] : ['Entregue'];

    const summaryQuery = hasCreatedAt
        ? 'SELECT COUNT(orders.id) AS num_sales, SUM(IF(items.price IS NULL, 0, items.price)) AS total_value, SUM(IF(items.id IS NOT NULL, 1, 0)) AS total_items_sold FROM orders LEFT JOIN items ON items.id = orders.item_id WHERE orders.status = ? AND MONTH(orders.created_at)=? AND YEAR(orders.created_at)=?'
        : 'SELECT COUNT(orders.id) AS num_sales, SUM(IF(items.price IS NULL, 0, items.price)) AS total_value, SUM(IF(items.id IS NOT NULL, 1, 0)) AS total_items_sold FROM orders LEFT JOIN items ON items.id = orders.item_id WHERE orders.status = ?';

    const [summaryRows] = await pool.query(summaryQuery, summaryParams);

    const summary = summaryRows[0] || { num_sales: 0, total_value: 0, total_items_sold: 0 };

    const subParams = hasCreatedAt ? [month, year] : [];

    const topQuery = hasCreatedAt
        ? 'SELECT i.id, i.name, COALESCE(c.cnt,0) AS sold_count FROM items i LEFT JOIN (SELECT item_id, COUNT(*) AS cnt FROM orders o WHERE o.status = \'Entregue\' AND MONTH(o.created_at)=? AND YEAR(o.created_at)=? AND item_id IS NOT NULL GROUP BY item_id) c ON c.item_id = i.id ORDER BY sold_count DESC, i.name ASC LIMIT 5'
        : 'SELECT i.id, i.name, COALESCE(c.cnt,0) AS sold_count FROM items i LEFT JOIN (SELECT item_id, COUNT(*) AS cnt FROM orders o WHERE o.status = \'Entregue\' AND item_id IS NOT NULL GROUP BY item_id) c ON c.item_id = i.id ORDER BY sold_count DESC, i.name ASC LIMIT 5';

    const [topRows] = await pool.query(topQuery, subParams);

    const leastQuery = hasCreatedAt
        ? 'SELECT i.id, i.name, COALESCE(c.cnt,0) AS sold_count FROM items i LEFT JOIN (SELECT item_id, COUNT(*) AS cnt FROM orders o WHERE o.status = \'Entregue\' AND MONTH(o.created_at)=? AND YEAR(o.created_at)=? AND item_id IS NOT NULL GROUP BY item_id) c ON c.item_id = i.id ORDER BY sold_count ASC, i.name ASC LIMIT 5'
        : 'SELECT i.id, i.name, COALESCE(c.cnt,0) AS sold_count FROM items i LEFT JOIN (SELECT item_id, COUNT(*) AS cnt FROM orders o WHERE o.status = \'Entregue\' AND item_id IS NOT NULL GROUP BY item_id) c ON c.item_id = i.id ORDER BY sold_count ASC, i.name ASC LIMIT 5';

    const [leastRows] = await pool.query(leastQuery, subParams);

    const averageItemsPerSale = summary.num_sales > 0 ? (Number(summary.total_items_sold) / Number(summary.num_sales)) : 0;

    return {
        totalValueSold: Number(summary.total_value || 0),
        numberOfSales: Number(summary.num_sales || 0),
        totalItemsSold: Number(summary.total_items_sold || 0),
        averageItemsPerSale: Number(averageItemsPerSale.toFixed(2)),
        topProducts: topRows,
        leastProducts: leastRows,
        period: { month, year }
    };
}

async function ensureItemsSchema() {
    const [columns] = await pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'items\' AND COLUMN_NAME = \'price\'',
        [dbConfig.database]
    );

    if (columns.length === 0) {
        console.log('🛠️ [DATABASE] Adicionando coluna price à tabela items...');
        await pool.query('ALTER TABLE items ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER category');
    }
}

async function ensureOrdersSchema() {
    const [columns] = await pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'orders\' AND COLUMN_NAME = \'item_id\'',
        [dbConfig.database]
    );

    if (columns.length === 0) {
        console.log('🛠️ [DATABASE] Adicionando coluna item_id à tabela orders...');
        await pool.query('ALTER TABLE orders ADD COLUMN item_id INT NULL AFTER customer_name');
    }

    const [statusColumns] = await pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'orders\' AND COLUMN_NAME = \'status\'',
        [dbConfig.database]
    );

    if (statusColumns.length === 0) {
        console.log('🛠️ [DATABASE] Adicionando coluna status à tabela orders...');
        await pool.query("ALTER TABLE orders ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Aberto' AFTER item_id");
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

function getNextOrderStatus(currentStatus) {
    const currentIndex = ORDER_STATUSES.indexOf(currentStatus);
    if (currentIndex < 0 || currentIndex === ORDER_STATUSES.length - 1) {
        return currentStatus || ORDER_STATUSES[0];
    }

    return ORDER_STATUSES[currentIndex + 1];
}

function requireAuth(req, res, next) {
    if (req.session?.user) {
        return next();
    }

    return res.redirect('/');
}

app.get('/', (req, res) => renderAuthPage(res, 'login'));

app.get('/cadastro', (req, res) => renderAuthPage(res, 'cadastro'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT password FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).render('auth', {
                ...AUTH_PAGE_CONFIGS.login,
                error: 'Usuário ou senha inválidos.'
            });
        }

        const storedPassword = rows[0].password;
        const isValidPassword = await bcrypt.compare(password, storedPassword);

        if (isValidPassword) {
            return req.session.regenerate(regenerateError => {
                if (regenerateError) {
                    return res.status(500).render('auth', {
                        ...AUTH_PAGE_CONFIGS.login,
                        error: 'Erro ao iniciar sessão.'
                    });
                }

                req.session.user = { username };
                return res.redirect('/dashboard');
            });
        }

        return res.status(401).render('auth', {
            ...AUTH_PAGE_CONFIGS.login,
            error: 'Usuário ou senha inválidos.'
        });
    } catch (_err) {
        res.status(500).render('auth', {
            ...AUTH_PAGE_CONFIGS.login,
            error: 'Erro no banco. Tente novamente.'
        });
    }
});

app.post('/cadastro', async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).render('auth', {
            ...AUTH_PAGE_CONFIGS.cadastro,
            error: 'As senhas não conferem.'
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        res.redirect('/');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).render('auth', {
                ...AUTH_PAGE_CONFIGS.cadastro,
                error: 'Usuário já existe.'
            });
        }
        res.status(500).render('auth', {
            ...AUTH_PAGE_CONFIGS.cadastro,
            error: 'Erro ao cadastrar usuário.'
        });
    }
});

app.post('/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.post('/add-item', requireAuth, async (req, res) => {
    const validation = validateItemInput(req.body);

    if (validation.error) {
        const dashboardData = await loadDashboardData();
        return res.status(400).render('dashboard', {
            ...dashboardData,
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
    } catch (_err) {
        const dashboardData = await loadDashboardData();
        res.status(500).render('dashboard', {
            ...dashboardData,
            error: 'Erro ao cadastrar item.'
        });
    }
});

app.post('/items/:id/edit', requireAuth, async (req, res) => {
    const itemId = Number(req.params.id);
    const validation = validateItemInput(req.body);

    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).redirect('/dashboard');
    }

    if (validation.error) {
        const dashboardData = await loadDashboardData();
        return res.status(400).render('dashboard', {
            ...dashboardData,
            error: validation.error
        });
    }

    try {
        const { name, category, price } = validation;
        await pool.query(
            'UPDATE items SET name = ?, category = ?, price = ? WHERE id = ?',
            [name, category, price, itemId]
        );

        res.redirect('/dashboard');
    } catch (_err) {
        const dashboardData = await loadDashboardData();
        res.status(500).render('dashboard', {
            ...dashboardData,
            error: 'Erro ao editar item.'
        });
    }
});

app.post('/items/:id/delete', requireAuth, async (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).redirect('/dashboard');
    }

    try {
        // Verifica se o item está vinculado a pedidos
        const [orders] = await pool.query(
            'SELECT id FROM orders WHERE item_id = ? LIMIT 1',
            [itemId]
        );

        if (orders.length > 0) {
            const dashboardData = await loadDashboardData();
            return res.status(400).render('dashboard', {
                ...dashboardData,
                error: 'Não é possível deletar um item que possui pedidos associados.'
            });
        }

        await pool.query('DELETE FROM items WHERE id = ?', [itemId]);
        res.redirect('/dashboard');
    } catch (_err) {
        const dashboardData = await loadDashboardData();
        res.status(500).render('dashboard', {
            ...dashboardData,
            error: 'Erro ao deletar item.'
        });
    }
});

app.post('/orders', requireAuth, async (req, res) => {
    const validation = validateOrderInput(req.body);

    if (validation.error) {
        const dashboardData = await loadDashboardData();
        return res.status(400).render('dashboard', {
            ...dashboardData,
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
    } catch (_err) {
        const dashboardData = await loadDashboardData();
        res.status(500).render('dashboard', {
            ...dashboardData,
            error: 'Erro ao registrar pedido.'
        });
    }
});

app.post('/orders/:id/advance', requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).redirect('/dashboard');
    }

    try {
        const [rows] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);

        if (rows.length === 0) {
            return res.status(404).redirect('/dashboard');
        }

        const nextStatus = getNextOrderStatus(rows[0].status);

        if (nextStatus !== rows[0].status) {
            await pool.query('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, orderId]);
        }

        res.redirect('/dashboard');
    } catch (_err) {
        res.status(500).redirect('/dashboard');
    }
});

app.get('/dashboard', requireAuth, async (req, res) => {
    const dashboardData = await loadDashboardData();
    res.render('dashboard', { ...dashboardData, error: null });
});

app.get('/admin/export', requireAuth, async (req, res) => {
    try {
        const [orders] = await pool.query(
            'SELECT orders.id, orders.customer_name, orders.status, items.name AS item_name, items.price AS item_price ' +
            'FROM orders LEFT JOIN items ON items.id = orders.item_id ORDER BY orders.id DESC'
        );

        // Gera CSV com BOM para abrir corretamente no Excel
        let csv = '\uFEFF'; // BOM UTF-8
        csv += 'ID,Cliente,Item,Preço,Status\n';

        orders.forEach(order => {
            const price = order.item_price !== null && order.item_price !== undefined ? `R$ ${Number(order.item_price).toFixed(2)}` : 'N/A';
            const itemName = order.item_name || 'Marmita removida';

            // Escapa aspas duplas em valores CSV
            const escapedCustomerName = `"${order.customer_name.replace(/"/g, '""')}"`;
            const escapedItemName = `"${itemName.replace(/"/g, '""')}"`;

            csv += `${order.id},${escapedCustomerName},${escapedItemName},${price},${order.status}\n`;
        });

        // Define headers para download
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="relatorio-vendas-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    } catch (_err) {
        res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
});

connectWithRetry()
    .then(async () => {
        await ensureItemsSchema();
        await ensureOrdersSchema();
        app.listen(3000, () => console.log('🚀 MARMITATECH PRO ONLINE NA PORTA 3000'));
    })
    .catch(err => {
        console.error('❌ [DATABASE] Falha ao iniciar aplicação:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
