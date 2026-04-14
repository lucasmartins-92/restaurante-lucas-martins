const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();

const dbConfig = {
    host: process.env.DB_HOST || 'db',
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

app.get('/dashboard', async (req, res) => {
    const [items] = await pool.query('SELECT * FROM items');
    const [orders] = await pool.query('SELECT * FROM orders');
    res.render('dashboard', { items, orders });
});

connectWithRetry().then(() => {
    app.listen(3000, () => console.log('🚀 MARMITATECH PRO ONLINE NA PORTA 3000'));
});
