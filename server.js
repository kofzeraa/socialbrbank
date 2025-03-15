const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

let db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha TEXT NOT NULL,
        saldo REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS extratos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        data TEXT NOT NULL,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        tipo TEXT NOT NULL -- 'pagar' ou 'receber'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS chaves_pix (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    chave_pix TEXT NOT NULL UNIQUE, 
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`);
});
   
app.post('/register', (req, res) => {
    const { nome, email, senha } = req.body;

    // Verificar se o email já existe
    const checkEmailQuery = `SELECT * FROM usuarios WHERE email = ?`;
    db.get(checkEmailQuery, [email], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (row) {
            res.status(400).json({ error: 'Email já registrado. Use um email diferente.' });
        } else {
            // Inserir novo usuário se o email não existir
            const insertQuery = `INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`;
            db.run(insertQuery, [nome, email, senha], function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ message: 'Usuário registrado com sucesso.', id: this.lastID });
            });
        }
    });
});

app.post('/login', (req, res) => {
    const { email, senha } = req.body;
    const query = `SELECT * FROM usuarios WHERE email = ? AND senha = ?`;
    db.get(query, [email, senha], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row) {
            res.json({ id: row.id, nome: row.nome, email: row.email, saldo: row.saldo });
        } else {
            res.status(401).json({ error: 'Credenciais inválidas.' });
        }
    });
});

app.post('/config', (req, res) => {
    const { id, nome, email, senha } = req.body;
    const query = `UPDATE usuarios SET nome = ?, email = ?, senha = ? WHERE id = ?`;
    db.run(query, [nome, email, senha, id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Configurações atualizadas com sucesso.' });
    });
});

app.post('/perfil', (req, res) => {
    const { id } = req.body;

    // Validação de entrada
    if (!id) {
        res.status(400).json({ error: 'ID é obrigatório' });
        return;
    }

    const query = `SELECT id, nome, email, saldo FROM usuarios WHERE id = ?`;

    db.get(query, [id], (err, row) => {
        if (err) {
            console.error(err.message);
            res.status(500).json({ error: 'Erro interno do servidor' });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'Usuário não encontrado' });
            return;
        }

        res.json(row);
    });
});

app.post('/extratos', (req, res) => {
    const { id } = req.body;  // Pegando o ID do corpo da requisição
    const query = `SELECT * FROM extratos WHERE usuario_id = ? ORDER BY data DESC`;
    db.all(query, [id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post('/pagar', (req, res) => {
    const { usuario_id, destinatario_id, descricao, valor } = req.body;
    const data = new Date().toISOString();
    const tipo = 'pagar';

    // Verificar se o usuário tem saldo suficiente
    const checkSaldoQuery = `SELECT saldo FROM usuarios WHERE id = ?`;
    db.get(checkSaldoQuery, [usuario_id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row && row.saldo >= valor) {
            // Atualizar o saldo do usuário pagador
            const updateSaldoQuery = `UPDATE usuarios SET saldo = saldo - ? WHERE id = ?`;
            db.run(updateSaldoQuery, [valor, usuario_id], function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                // Atualizar o saldo do usuário destinatário
                const updateSaldoDestQuery = `UPDATE usuarios SET saldo = saldo + ? WHERE id = ?`;
                db.run(updateSaldoDestQuery, [valor, destinatario_id], function(err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }

                    // Registrar o pagamento nos extratos do pagador
                    const insertExtratoQuery = `INSERT INTO extratos (usuario_id, data, descricao, valor, tipo) VALUES (?, ?, ?, ?, ?)`;
                    db.run(insertExtratoQuery, [usuario_id, data, descricao, valor, tipo], function(err) {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        // Registrar o recebimento nos extratos do destinatário
                        const insertRecebimentoQuery = `INSERT INTO extratos (usuario_id, data, descricao, valor, tipo) VALUES (?, ?, ?, ?, 'receber')`;
                        db.run(insertRecebimentoQuery, [destinatario_id, data, descricao, valor], function(err) {
                            if (err) {
                                res.status(500).json({ error: err.message });
                                return;
                            }

                            res.json({ message: 'Pagamento registrado com sucesso.' });
                        });
                    });
                });
            });
        } else {
            res.status(400).json({ error: 'Saldo insuficiente.' });
        }
    });
});


app.post('/receber', (req, res) => {
    const { usuario_id, descricao, valor } = req.body;
    const data = new Date().toISOString();
    const tipo = 'receber';
    const query = `INSERT INTO extratos (usuario_id, data, descricao, valor, tipo) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [usuario_id, data, descricao, valor, tipo], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Recebimento registrado com sucesso.' });
    });
});

app.get('/saldo', (req, res) => {
    const usuario_id = req.query.usuario_id;
    const query = `SELECT saldo FROM usuarios WHERE id = ?`;
    db.get(query, [usuario_id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ saldo: row.saldo });
    });
});

// Endpoint para cadastrar chave Pix
  app.post('/cadastrar-chave-pix', (req, res) => {
    const { usuario_id, chave } = req.body;

    console.log('Dados recebidos:', req.body); // Log dos dados recebidos

    if (!usuario_id || !chave) {
        return res.status(400).json({ error: 'ID do usuário e chave Pix são obrigatórios' });
    }

    // Verificar se a chave Pix já existe para evitar duplicação
    const queryVerificar = `SELECT COUNT(*) as count FROM chaves_pix WHERE chave_pix = ?`;
    db.get(queryVerificar, [chave], (err, row) => {
        if (err) {
            console.error('Erro ao verificar chave Pix:', err.message); // Log do erro
            return res.status(500).json({ error: 'Erro ao verificar chave Pix' });
        }

        if (row.count > 0) {
            return res.status(400).json({ error: 'Chave Pix já existe' });
        }

        const queryInserir = `INSERT INTO chaves_pix (usuario_id, chave_pix) VALUES (?, ?)`;
        db.run(queryInserir, [usuario_id, chave], function(err) {
            if (err) {
                console.error('Erro ao cadastrar chave Pix:', err.message); // Log do erro
                return res.status(500).json({ error: 'Erro ao cadastrar chave Pix' });
            }
            res.json({ message: 'Chave Pix cadastrada com sucesso!' });
        });
    });
});

// Endpoint para listar chaves Pix
app.post('/listar-chaves-pix', (req, res) => {
    const { usuario_id } = req.body;

    if (!usuario_id) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }

    const query = `SELECT chave_pix FROM chaves_pix WHERE usuario_id = ?`;
    db.all(query, [usuario_id], (err, rows) => {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Erro ao listar chaves Pix' });
        }

        const chavesPix = rows.map(row => row.chave_pix);
        res.json({ chavesPix });
    });
});

app.post('/enviar-pagamento-pix', (req, res) => {
    const { usuario_id, chave_pix, valor } = req.body;
    const data = new Date().toISOString();
    const tipo = 'pagar';

    // Verificar se o usuário tem saldo suficiente
    const checkSaldoQuery = `SELECT saldo FROM usuarios WHERE id = ?`;
    db.get(checkSaldoQuery, [usuario_id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row && row.saldo >= valor) {
            // Obter ID do destinatário usando a chave Pix
            const getDestinatarioQuery = `SELECT usuario_id FROM chaves_pix WHERE chave = ?`;
            db.get(getDestinatarioQuery, [chave_pix], (err, destinatario) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                if (destinatario) {
                    const destinatario_id = destinatario.usuario_id;

                    // Atualizar o saldo do usuário pagador
                    const updateSaldoQuery = `UPDATE usuarios SET saldo = saldo - ? WHERE id = ?`;
                    db.run(updateSaldoQuery, [valor, usuario_id], function(err) {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        // Atualizar o saldo do usuário destinatário
                        const updateSaldoDestQuery = `UPDATE usuarios SET saldo = saldo + ? WHERE id = ?`;
                        db.run(updateSaldoDestQuery, [valor, destinatario_id], function(err) {
                            if (err) {
                                res.status(500).json({ error: err.message });
                                return;
                            }

                            // Registrar o pagamento nos extratos do pagador
                            const insertExtratoQuery = `INSERT INTO extratos (usuario_id, data, descricao, valor, tipo) VALUES (?, ?, ?, ?, ?)`;
                            db.run(insertExtratoQuery, [usuario_id, data, `Pagamento para ${chave_pix}`, valor, tipo], function(err) {
                                if (err) {
                                    res.status(500).json({ error: err.message });
                                    return;
                                }

                                // Registrar o recebimento nos extratos do destinatário
                                const insertRecebimentoQuery = `INSERT INTO extratos (usuario_id, data, descricao, valor, tipo) VALUES (?, ?, ?, ?, 'receber')`;
                                db.run(insertRecebimentoQuery, [destinatario_id, data, `Recebimento de ${usuario_id}`, valor], function(err) {
                                    if (err) {
                                        res.status(500).json({ error: err.message });
                                        return;
                                    }

                                    res.json({ message: 'Pagamento Pix enviado com sucesso.' });
                                });
                            });
                        });
                    });
                } else {
                    res.status(400).json({ error: 'Chave Pix não encontrada.' });
                }
            });
        } else {
            res.status(400).json({ error: 'Saldo insuficiente.' });
        }
    });
});

// Endpoint para apagar chave Pix
app.post('/apagar-chave-pix', (req, res) => {
    const { usuario_id, chave } = req.body;

    console.log('Dados recebidos para apagar chave:', req.body); // Log dos dados recebidos

    if (!usuario_id || !chave) {
        return res.status(400).json({ error: 'ID do usuário e chave Pix são obrigatórios' });
    }

    const query = `DELETE FROM chaves_pix WHERE usuario_id = ? AND chave_pix = ?`;
    db.run(query, [usuario_id, chave], function(err) {
        if (err) {
            console.error('Erro ao apagar chave Pix:', err.message); // Log do erro
            return res.status(500).json({ error: 'Erro ao apagar chave Pix' });
        }
        res.json({ message: 'Chave Pix apagada com sucesso!' });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});

