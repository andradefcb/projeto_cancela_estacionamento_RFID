const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { CONFIG_PIX, gerarCobrancaPix, gerarPayloadPixCopiaECola } = require('./pixService');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clientes SSE (Server-Sent Events) para atualizações em tempo real
let sseClients = [];

// ====================================================================
// FUNÇÕES AUXILIARES DO BANCO DE DADOS JSON
// ====================================================================
function lerBanco() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const dbInicial = {
        tabelaPrecos: {
          isencaoMinutos: 15,
          valor30min: 5.0,
          valor1Hora: 10.0,
          valorHoraAdicional: 5.0,
          valorDiaria: 40.0,
          limiteHorasDiaria: 8
        },
        config: {
          admin: {
            login: 'admin',
            senha: '123',
            nome: 'Administrador SmartPark',
            cargo: 'admin'
          },
          pix: {
            chave: 'pex-estacionamento-2026@arduino.org',
            tipoChave: 'EMAIL',
            beneficiario: 'SmartPark Estacionamento PEX',
            cidade: 'MANAUS'
          }
        },
        veiculos: [],
        sessoes: []
      };
      salvarBanco(dbInicial);
      return dbInicial;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const db = JSON.parse(data);

    if (!db.config) db.config = {};
    if (!db.config.admin) {
      db.config.admin = { login: 'admin', senha: '123', nome: 'Administrador SmartPark', cargo: 'admin' };
    }
    if (!db.tabelaPrecos) {
      db.tabelaPrecos = {
        isencaoMinutos: 15,
        valor30min: 5.0,
        valor1Hora: 10.0,
        valorHoraAdicional: 5.0,
        valorDiaria: 40.0,
        limiteHorasDiaria: 8
      };
    }
    return db;
  } catch (err) {
    console.error('Erro ao ler banco de dados:', err);
    return { tabelaPrecos: {}, config: {}, veiculos: [], sessoes: [] };
  }
}

function salvarBanco(dados) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dados, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar banco de dados:', err);
  }
}

function enviarEvento(tipo, dados) {
  const mensagem = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(mensagem);
    } catch (e) {
      // Cliente desconectado
    }
  });
}

// ====================================================================
// REGRA DE CÁLCULO DA TABELA DE PREÇOS (5 OPÇÕES OFICIAIS)
// 1. Isenção (em minutos)
// 2. 30 minutos
// 3. 1 hora
// 4. Hora adicional
// 5. Diária
// ====================================================================
function calcularValorEstacionamento(entradaMs, saidaMs, tabela) {
  const diffMs = Math.max(0, saidaMs - entradaMs);
  const totalSegundos = Math.floor(diffMs / 1000);
  const totalMinutos = Math.max(1, Math.ceil(diffMs / 60000));
  
  const horas = Math.floor(totalMinutos / 60);
  const minutosRestantes = totalMinutos % 60;
  
  let tempoFormatado = '';
  if (horas > 0) {
    tempoFormatado = `${horas}h ${minutosRestantes.toString().padStart(2, '0')}m`;
  } else {
    tempoFormatado = `${totalMinutos} min`;
  }

  const isencaoMinutos = Number(tabela.isencaoMinutos !== undefined ? tabela.isencaoMinutos : (tabela.toleranciaMinutos || 15));
  const valor30min = Number(tabela.valor30min !== undefined ? tabela.valor30min : 5.0);
  const valor1Hora = Number(tabela.valor1Hora !== undefined ? tabela.valor1Hora : (tabela.primeiraHora || 10.0));
  const valorHoraAdicional = Number(tabela.valorHoraAdicional !== undefined ? tabela.valorHoraAdicional : (tabela.horaAdicional || 5.0));
  const valorDiaria = Number(tabela.valorDiaria || 40.0);
  const limiteDiariaMin = (Number(tabela.limiteHorasDiaria) || 8) * 60;

  // 1. Isenção (Tolerância gratuita)
  if (totalMinutos <= isencaoMinutos) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: 0.00,
      isTolerancia: true,
      detalhes: `Período de isenção gratuito (${isencaoMinutos} min). Valor isento.`
    };
  }

  // 2. Diária (quando o tempo atinge o limite de horas configurado)
  if (totalMinutos >= limiteDiariaMin) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: valorDiaria,
      isTolerancia: false,
      detalhes: `Estadia superior a ${tabela.limiteHorasDiaria || 8}h. Aplicada tarifa diária de R$ ${valorDiaria.toFixed(2)}.`
    };
  }

  // 3. Até 30 minutos
  if (totalMinutos <= 30) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: Number(valor30min.toFixed(2)),
      isTolerancia: false,
      detalhes: `Permanência de até 30 minutos: R$ ${valor30min.toFixed(2)}`
    };
  }

  // 4. Até 1 hora (60 minutos)
  if (totalMinutos <= 60) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: Number(valor1Hora.toFixed(2)),
      isTolerancia: false,
      detalhes: `Permanência de até 1 hora: R$ ${valor1Hora.toFixed(2)}`
    };
  }

  // 5. Hora adicional (acima de 60 minutos)
  const excedente = totalMinutos - 60;
  const horasExcedentes = Math.ceil(excedente / 60);
  let valor = valor1Hora + (horasExcedentes * valorHoraAdicional);
  let detalhes = `1ª Hora: R$ ${valor1Hora.toFixed(2)} + ${horasExcedentes}h adicional(is): R$ ${(horasExcedentes * valorHoraAdicional).toFixed(2)}`;

  // Não excede o teto da diária
  if (valor > valorDiaria) {
    valor = valorDiaria;
    detalhes += ` (limitado ao teto da diária de R$ ${valorDiaria.toFixed(2)})`;
  }

  return {
    tempoMinutos: totalMinutos,
    tempoSegundos: totalSegundos,
    tempoFormatado,
    valorTotal: Number(valor.toFixed(2)),
    isTolerancia: false,
    detalhes
  };
}

// ====================================================================
// ROTAS SSE (SERVER-SENT EVENTS)
// ====================================================================
app.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  res.write(`event: conectado\ndata: ${JSON.stringify({ status: 'ok', time: Date.now() })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// ====================================================================
// AUTENTICAÇÃO UNIFICADA (TELA ÚNICA DE LOGIN)
// Reconhece automaticamente Administradores e Clientes
// ====================================================================
app.post('/api/auth/login', (req, res) => {
  const db = lerBanco();
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe o login e a senha.' });
  }

  const loginLimpo = login.trim().toLowerCase();
  const senhaLimpa = senha.trim();

  // 1. Verifica Administrador Master configurado
  const adminConfig = db.config?.admin || { login: 'admin', senha: '123', nome: 'Administrador SmartPark', cargo: 'admin' };
  if (loginLimpo === adminConfig.login.toLowerCase() && senhaLimpa === adminConfig.senha) {
    return res.json({
      sucesso: true,
      token: 'token-admin-' + Date.now(),
      usuario: {
        role: 'admin',
        cargo: 'admin',
        nome: adminConfig.nome || 'Administrador',
        login: adminConfig.login
      }
    });
  }

  // 2. Verifica usuários/veículos cadastrados
  const veiculo = db.veiculos.find(v => {
    const vLogin = (v.login || v.placa || '').toLowerCase().trim();
    const vPlaca = (v.placa || '').toLowerCase().trim();
    const vCpf = (v.cpf || '').replace(/\D/g, '');
    const vRfid = (v.rfid || '').toLowerCase().trim();
    const inputCpfLimpo = login.replace(/\D/g, '');

    const loginCorresponde = (vLogin === loginLimpo || vPlaca === loginLimpo || (inputCpfLimpo && vCpf === inputCpfLimpo) || vRfid === loginLimpo);
    const senhaCorresponde = (v.senha || '123') === senhaLimpa;

    return loginCorresponde && senhaCorresponde;
  });

  if (veiculo) {
    const isCargoAdmin = (veiculo.cargo === 'admin');
    return res.json({
      sucesso: true,
      token: 'token-' + (isCargoAdmin ? 'admin-' : 'cliente-') + veiculo.id + '-' + Date.now(),
      usuario: {
        role: isCargoAdmin ? 'admin' : 'cliente',
        cargo: isCargoAdmin ? 'admin' : 'cliente',
        nome: veiculo.nome,
        login: veiculo.login || veiculo.placa,
        veiculo: {
          id: veiculo.id,
          rfid: veiculo.rfid,
          nome: veiculo.nome,
          placa: veiculo.placa,
          contato: veiculo.contato,
          cpf: veiculo.cpf,
          login: veiculo.login || veiculo.placa,
          cargo: veiculo.cargo || 'cliente'
        }
      }
    });
  }

  return res.status(401).json({
    sucesso: false,
    mensagem: 'Usuário ou senha incorretos. Verifique suas credenciais.'
  });
});

// ====================================================================
// GESTÃO DE CARGOS (EXCLUSIVO ADMINISTRADOR)
// ====================================================================
app.get('/api/cargos/usuarios', (req, res) => {
  const db = lerBanco();
  const lista = [];

  // Admin Master
  const adminConfig = db.config?.admin || { login: 'admin', nome: 'Administrador SmartPark', cargo: 'admin' };
  lista.push({
    id: 'ADMIN-MASTER',
    nome: adminConfig.nome || 'Administrador SmartPark',
    login: adminConfig.login,
    placa: '---',
    cpf: 'Administrador Geral',
    cargo: 'admin',
    isMaster: true
  });

  // Veículos / Usuários cadastrados
  db.veiculos.forEach(v => {
    lista.push({
      id: v.id,
      rfid: v.rfid,
      nome: v.nome,
      login: v.login || v.placa,
      placa: v.placa,
      cpf: v.cpf,
      cargo: v.cargo || 'cliente',
      isMaster: false
    });
  });

  res.json({ sucesso: true, usuarios: lista });
});

app.put('/api/cargos/usuarios/:id', (req, res) => {
  const db = lerBanco();
  const { id } = req.params;
  const { cargo } = req.body;

  if (!['admin', 'cliente'].includes(cargo)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Cargo inválido. Escolha "admin" ou "cliente".' });
  }

  // Se for o Admin Master
  if (id === 'ADMIN-MASTER' || id === 'admin') {
    if (!db.config.admin) {
      db.config.admin = { login: 'admin', senha: '123', nome: 'Administrador SmartPark', cargo: 'admin' };
    }
    db.config.admin.cargo = cargo;
    salvarBanco(db);
    enviarEvento('cargos_atualizados', { id: 'ADMIN-MASTER', cargo });
    return res.json({
      sucesso: true,
      mensagem: `Cargo do Administrador Master atualizado para ${cargo === 'admin' ? 'Administrador' : 'Cliente'}!`,
      usuario: db.config.admin
    });
  }

  // Busca o veículo por id, rfid, placa ou login
  const veiculo = db.veiculos.find(v => v.id === id || v.rfid === id || v.placa === id || (v.login && v.login === id));
  if (!veiculo) {
    return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
  }

  veiculo.cargo = cargo;
  salvarBanco(db);

  enviarEvento('cargos_atualizados', { id: veiculo.id, cargo });
  res.json({
    sucesso: true,
    mensagem: `Cargo de ${veiculo.nome} atualizado para ${cargo === 'admin' ? 'Administrador' : 'Cliente'} com sucesso!`,
    veiculo
  });
});

// ====================================================================
// PORTAL DO CLIENTE (DADOS ESPECÍFICOS DO SEU CARRO)
// ====================================================================
app.get('/api/cliente/meu-veiculo/:rfid', (req, res) => {
  const db = lerBanco();
  const rfidParam = (req.params.rfid || '').trim().toUpperCase();

  const veiculo = db.veiculos.find(v => v.rfid.toUpperCase() === rfidParam);
  if (!veiculo) {
    return res.status(404).json({ sucesso: false, mensagem: 'Veículo não encontrado.' });
  }

  const agora = Date.now();
  const sessaoAtiva = db.sessoes.find(s => s.rfid.toUpperCase() === rfidParam && s.status === 'ESTACIONADO');

  let dadosSessao = null;
  if (sessaoAtiva) {
    const calculo = calcularValorEstacionamento(sessaoAtiva.entrada, agora, db.tabelaPrecos);
    dadosSessao = {
      ...sessaoAtiva,
      tempoDecorridoMs: agora - sessaoAtiva.entrada,
      tempoFormatado: calculo.tempoFormatado,
      tempoMinutos: calculo.tempoMinutos,
      valorEstimado: calculo.valorTotal,
      detalhesCalculo: calculo.detalhes
    };
  }

  const historicoVeiculo = db.sessoes
    .filter(s => s.rfid.toUpperCase() === rfidParam && s.status === 'PAGO')
    .sort((a, b) => b.saida - a.saida)
    .slice(0, 10);

  res.json({
    sucesso: true,
    veiculo: {
      id: veiculo.id,
      rfid: veiculo.rfid,
      nome: veiculo.nome,
      placa: veiculo.placa,
      contato: veiculo.contato,
      cpf: veiculo.cpf,
      login: veiculo.login || veiculo.placa,
      cargo: veiculo.cargo || 'cliente'
    },
    estacionado: !!sessaoAtiva,
    sessaoAtiva: dadosSessao,
    historico: historicoVeiculo,
    tabelaPrecos: db.tabelaPrecos
  });
});

// ====================================================================
// ROTAS DE STATUS E DASHBOARD (EXCLUSIVO ADMIN)
// ====================================================================
app.get('/api/status', (req, res) => {
  const db = lerBanco();
  const ativas = db.sessoes.filter(s => s.status === 'ESTACIONADO');
  
  const hojeStr = new Date().toISOString().slice(0, 10);
  const faturamentoHoje = db.sessoes
    .filter(s => s.status === 'PAGO' && s.saida && new Date(s.saida).toISOString().slice(0, 10) === hojeStr)
    .reduce((acc, curr) => acc + (Number(curr.valorCobrado) || 0), 0);

  res.json({
    sucesso: true,
    agora: Date.now(),
    veiculosCadastrados: db.veiculos.length,
    estacionadosAgora: ativas.length,
    faturamentoHoje: Number(faturamentoHoje.toFixed(2)),
    totalSessoesHoje: db.sessoes.filter(s => s.status === 'PAGO' && s.saida && new Date(s.saida).toISOString().slice(0, 10) === hojeStr).length
  });
});

// ====================================================================
// ROTAS DE VEÍCULOS / CADASTRO DE RFID
// ====================================================================
app.get('/api/veiculos', (req, res) => {
  const db = lerBanco();
  const q = (req.query.q || '').trim().toLowerCase();
  
  let lista = db.veiculos;
  if (q) {
    lista = lista.filter(v => 
      (v.nome && v.nome.toLowerCase().includes(q)) ||
      (v.placa && v.placa.toLowerCase().includes(q)) ||
      (v.cpf && v.cpf.toLowerCase().includes(q)) ||
      (v.rfid && v.rfid.toLowerCase().includes(q)) ||
      (v.login && v.login.toLowerCase().includes(q))
    );
  }
  res.json({ sucesso: true, veiculos: lista });
});

app.get('/api/veiculos/:rfid', (req, res) => {
  const db = lerBanco();
  const rfid = (req.params.rfid || '').trim().toUpperCase();
  const veiculo = db.veiculos.find(v => v.rfid.toUpperCase() === rfid);
  if (!veiculo) {
    return res.status(404).json({ sucesso: false, mensagem: 'Veículo não encontrado.' });
  }
  res.json({ sucesso: true, veiculo });
});

app.post('/api/veiculos', (req, res) => {
  const db = lerBanco();
  let { rfid, nome, placa, contato, cpf, login, senha, cargo = 'cliente' } = req.body;

  if (!rfid || !nome || !placa || !contato || !cpf) {
    return res.status(400).json({ sucesso: false, mensagem: 'Todos os campos são obrigatórios (RFID, Nome, Placa, Contato, CPF).' });
  }

  rfid = rfid.trim().toUpperCase();
  nome = nome.trim();
  placa = placa.trim().toUpperCase();
  contato = contato.trim();
  cpf = cpf.trim();
  login = (login || placa).trim().toUpperCase();
  senha = (senha || '123').trim();
  cargo = cargo === 'admin' ? 'admin' : 'cliente';

  const existente = db.veiculos.find(v => v.rfid.toUpperCase() === rfid);
  if (existente) {
    return res.status(409).json({ sucesso: false, mensagem: `O código RFID ${rfid} já está cadastrado para o veículo ${existente.placa} (${existente.nome}).` });
  }

  const novoVeiculo = {
    id: 'VEI-' + Date.now(),
    rfid,
    nome,
    placa,
    contato,
    cpf,
    login,
    senha,
    cargo,
    criadoEm: new Date().toISOString()
  };

  db.veiculos.push(novoVeiculo);
  salvarBanco(db);

  enviarEvento('veiculo_cadastrado', novoVeiculo);

  res.status(201).json({ sucesso: true, mensagem: 'Veículo cadastrado com sucesso!', veiculo: novoVeiculo });
});

app.put('/api/veiculos/:rfid', (req, res) => {
  const db = lerBanco();
  const rfidParam = req.params.rfid.trim().toUpperCase();
  const index = db.veiculos.findIndex(v => v.rfid.toUpperCase() === rfidParam);

  if (index === -1) {
    return res.status(404).json({ sucesso: false, mensagem: 'Veículo não encontrado para alteração.' });
  }

  const { nome, placa, contato, cpf, login, senha, cargo } = req.body;
  if (nome) db.veiculos[index].nome = nome.trim();
  if (placa) db.veiculos[index].placa = placa.trim().toUpperCase();
  if (contato) db.veiculos[index].contato = contato.trim();
  if (cpf) db.veiculos[index].cpf = cpf.trim();
  if (login) db.veiculos[index].login = login.trim().toUpperCase();
  if (senha) db.veiculos[index].senha = senha.trim();
  if (cargo) db.veiculos[index].cargo = cargo === 'admin' ? 'admin' : 'cliente';

  salvarBanco(db);
  res.json({ sucesso: true, mensagem: 'Cadastro atualizado com sucesso!', veiculo: db.veiculos[index] });
});

app.delete('/api/veiculos/:rfid', (req, res) => {
  const db = lerBanco();
  const rfidParam = req.params.rfid.trim().toUpperCase();
  
  const sessaoAtiva = db.sessoes.find(s => s.status === 'ESTACIONADO' && s.rfid.toUpperCase() === rfidParam);
  if (sessaoAtiva) {
    return res.status(400).json({ sucesso: false, mensagem: 'Não é possível excluir o veículo pois ele está atualmente no estacionamento!' });
  }

  const anteriorLength = db.veiculos.length;
  db.veiculos = db.veiculos.filter(v => v.rfid.toUpperCase() !== rfidParam);

  if (db.veiculos.length === anteriorLength) {
    return res.status(404).json({ sucesso: false, mensagem: 'Veículo não encontrado.' });
  }

  salvarBanco(db);
  res.json({ sucesso: true, mensagem: 'Veículo removido com sucesso!' });
});

// ====================================================================
// LEITURA DE RFID (ENTRADA DO VEÍCULO)
// ====================================================================
app.post('/api/leitura-rfid', (req, res) => {
  const db = lerBanco();
  let { rfid } = req.body;

  if (!rfid) {
    return res.status(400).json({ sucesso: false, mensagem: 'Código RFID não informado.' });
  }

  rfid = rfid.trim().toUpperCase();

  const veiculo = db.veiculos.find(v => v.rfid.toUpperCase() === rfid);

  if (!veiculo) {
    enviarEvento('rfid_nao_cadastrado', { rfid, timestamp: Date.now() });

    return res.json({
      sucesso: false,
      registrado: false,
      rfid,
      acao: 'ABRIR_CADASTRO',
      mensagem: `Cartão RFID ${rfid} não cadastrado! Deseja associá-lo a um novo titular?`
    });
  }

  const sessaoAberta = db.sessoes.find(s => s.rfid.toUpperCase() === rfid && s.status === 'ESTACIONADO');

  if (sessaoAberta) {
    enviarEvento('rfid_ja_estacionado', { rfid, veiculo, sessao: sessaoAberta });

    return res.json({
      sucesso: true,
      registrado: true,
      acao: 'JA_ESTACIONADO',
      sessao: sessaoAberta,
      veiculo,
      mensagem: `Veículo ${veiculo.placa} (${veiculo.nome}) já se encontra estacionado desde ${new Date(sessaoAberta.entrada).toLocaleTimeString()}. Direcionando para tela de Pagamento.`
    });
  }

  // REGISTRA ENTRADA E INICIA O TEMPORIZADOR!
  const agora = Date.now();
  const novaSessao = {
    id: 'SES-' + agora,
    rfid,
    veiculo: {
      nome: veiculo.nome,
      placa: veiculo.placa,
      contato: veiculo.contato,
      cpf: veiculo.cpf
    },
    entrada: agora,
    saida: null,
    status: 'ESTACIONADO',
    valorCobrado: null,
    formaPagamento: 'PIX',
    historicoCalculo: null
  };

  db.sessoes.push(novaSessao);
  salvarBanco(db);

  enviarEvento('entrada_registrada', { sessao: novaSessao, veiculo });

  res.json({
    sucesso: true,
    registrado: true,
    acao: 'ENTRADA_REGISTRADA',
    sessao: novaSessao,
    veiculo,
    mensagem: `Entrada autorizada para ${veiculo.nome} (Placa ${veiculo.placa})! Temporizador iniciado.`
  });
});

// ====================================================================
// ROTAS DE SESSÕES (ESTACIONADOS E HISTÓRICO)
// ====================================================================
app.get('/api/sessoes/ativas', (req, res) => {
  const db = lerBanco();
  const agora = Date.now();

  const ativas = db.sessoes
    .filter(s => s.status === 'ESTACIONADO')
    .map(s => {
      const calculo = calcularValorEstacionamento(s.entrada, agora, db.tabelaPrecos);
      return {
        ...s,
        tempoDecorridoMs: agora - s.entrada,
        tempoFormatado: calculo.tempoFormatado,
        tempoMinutos: calculo.tempoMinutos,
        valorEstimado: calculo.valorTotal
      };
    })
    .sort((a, b) => b.entrada - a.entrada);

  res.json({ sucesso: true, sessoes: ativas });
});

app.get('/api/sessoes/historico', (req, res) => {
  const db = lerBanco();
  const historico = db.sessoes
    .filter(s => s.status === 'PAGO' || s.status === 'CANCELADO')
    .sort((a, b) => (b.saida || b.entrada) - (a.saida || a.entrada));

  res.json({ sucesso: true, historico });
});

app.post('/api/sessoes/:id/cancelar', (req, res) => {
  const db = lerBanco();
  const sessao = db.sessoes.find(s => s.id === req.params.id && s.status === 'ESTACIONADO');

  if (!sessao) {
    return res.status(404).json({ sucesso: false, mensagem: 'Sessão ativa não encontrada.' });
  }

  sessao.status = 'CANCELADO';
  sessao.saida = Date.now();
  salvarBanco(db);

  enviarEvento('sessao_cancelada', { id: sessao.id });
  res.json({ sucesso: true, mensagem: 'Sessão cancelada com sucesso.' });
});

// ====================================================================
// ROTAS PIX: GERAÇÃO DE COBRANÇA E WEBHOOK
// ====================================================================

// 1. Gera cobrança PIX dinâmica para a sessão ativa
app.post('/api/pagamento/pix/gerar', (req, res) => {
  const db = lerBanco();
  const { sessaoId, rfid } = req.body;

  let sessao = null;
  if (sessaoId) {
    sessao = db.sessoes.find(s => s.id === sessaoId && s.status === 'ESTACIONADO');
  } else if (rfid) {
    sessao = db.sessoes.find(s => s.rfid.toUpperCase() === rfid.trim().toUpperCase() && s.status === 'ESTACIONADO');
  }

  if (!sessao) {
    return res.status(404).json({ sucesso: false, mensagem: 'Sessão ativa não encontrada.' });
  }

  const agora = Date.now();
  const calculo = calcularValorEstacionamento(sessao.entrada, agora, db.tabelaPrecos);

  const cobrancaPix = gerarCobrancaPix({
    sessaoId: sessao.id,
    valor: calculo.valorTotal,
    placa: sessao.veiculo.placa,
    titular: sessao.veiculo.nome
  });

  res.json({
    sucesso: true,
    sessao,
    calculo,
    cobrancaPix,
    pix: {
      chavePix: cobrancaPix.chave,
      copiaECola: cobrancaPix.copiaECola,
      valor: cobrancaPix.valor,
      txid: cobrancaPix.txid
    }
  });
});

// 2. Webhook oficial da API do PIX (Mercado Pago, EFI Bank, Banco Inter, Asaas, etc.)
// Chamado pelo banco quando o cliente transfere via PIX
app.post('/api/pix/webhook', (req, res) => {
  const db = lerBanco();
  const payload = req.body || {};

  console.log('[PIX Webhook] Notificação recebida da API Bancária:', JSON.stringify(payload));

  // Extrai identificador da transação ou sessão enviado pelo gateway
  const txid = payload.txid || payload.id || (payload.data && payload.data.id);
  const status = payload.status || (payload.action === 'payment.created' ? 'approved' : 'approved');

  // Localiza a sessão associada
  const index = db.sessoes.findIndex(s => s.status === 'ESTACIONADO');
  if (index === -1) {
    return res.status(200).json({ status: 'ignored', message: 'Nenhuma sessão ativa aguardando PIX.' });
  }

  const sessao = db.sessoes[index];
  const saidaFinal = Date.now();
  const calculo = calcularValorEstacionamento(sessao.entrada, saidaFinal, db.tabelaPrecos);

  sessao.status = 'PAGO';
  sessao.saida = saidaFinal;
  sessao.tempoMinutos = calculo.tempoMinutos;
  sessao.tempoFormatado = calculo.tempoFormatado;
  sessao.valorBase = calculo.valorTotal;
  sessao.desconto = 0;
  sessao.acrescimo = 0;
  sessao.valorCobrado = calculo.valorTotal;
  sessao.formaPagamento = 'PIX';
  sessao.valorRecebido = calculo.valorTotal;
  sessao.troco = 0;
  sessao.historicoCalculo = calculo.detalhes;

  const comprovante = {
    numeroCupom: 'REC-' + sessao.id.replace('SES-', ''),
    sessaoId: sessao.id,
    rfid: sessao.rfid,
    titular: sessao.veiculo.nome,
    cpf: sessao.veiculo.cpf,
    placa: sessao.veiculo.placa,
    contato: sessao.veiculo.contato,
    dataEntrada: new Date(sessao.entrada).toLocaleString('pt-BR'),
    dataSaida: new Date(sessao.saida).toLocaleString('pt-BR'),
    duracaoFormatada: calculo.tempoFormatado,
    valorTotal: calculo.valorTotal,
    formaPagamento: 'PIX',
    valorRecebido: calculo.valorTotal,
    troco: 0,
    detalhesCalculo: calculo.detalhes,
    emitidoEm: new Date().toLocaleString('pt-BR')
  };

  salvarBanco(db);

  // Notifica o frontend em tempo real e libera a cancela e o ticket!
  enviarEvento('pagamento_concluido', { sessao, comprovante });

  return res.status(200).json({ sucesso: true, mensagem: 'Pagamento PIX confirmado e ticket liberado!' });
});

// ====================================================================
// CÁLCULO E FINALIZAÇÃO DE PAGAMENTO (EXCLUSIVO PIX)
// Ticket liberado somente após este endpoint confirmar o pagamento
// ====================================================================
app.post('/api/pagamento/calcular', (req, res) => {
  const db = lerBanco();
  const { sessaoId, rfid, saidaCustomizada } = req.body;

  let sessao = null;
  if (sessaoId) {
    sessao = db.sessoes.find(s => s.id === sessaoId && s.status === 'ESTACIONADO');
  } else if (rfid) {
    sessao = db.sessoes.find(s => s.rfid.toUpperCase() === rfid.trim().toUpperCase() && s.status === 'ESTACIONADO');
  }

  if (!sessao) {
    return res.status(404).json({ sucesso: false, mensagem: 'Sessão de estacionamento ativa não encontrada para este veículo/RFID.' });
  }

  const momentoSaida = saidaCustomizada ? Number(saidaCustomizada) : Date.now();
  const calculo = calcularValorEstacionamento(sessao.entrada, momentoSaida, db.tabelaPrecos);

  const cobrancaPix = gerarCobrancaPix({
    sessaoId: sessao.id,
    valor: calculo.valorTotal,
    placa: sessao.veiculo.placa,
    titular: sessao.veiculo.nome
  });

  res.json({
    sucesso: true,
    sessao,
    saida: momentoSaida,
    cobrancaPix,
    ...calculo
  });
});

app.post('/api/pagamento/finalizar', (req, res) => {
  const db = lerBanco();
  const {
    sessaoId,
    saidaTimestamp,
    desconto = 0,
    acrescimo = 0,
    observacoes = ''
  } = req.body;

  if (!sessaoId) {
    return res.status(400).json({ sucesso: false, mensagem: 'ID da sessão é obrigatório.' });
  }

  const index = db.sessoes.findIndex(s => s.id === sessaoId && s.status === 'ESTACIONADO');
  if (index === -1) {
    return res.status(404).json({ sucesso: false, mensagem: 'Sessão ativa não encontrada ou já finalizada.' });
  }

  const sessao = db.sessoes[index];
  const saidaFinal = saidaTimestamp ? Number(saidaTimestamp) : Date.now();
  const calculo = calcularValorEstacionamento(sessao.entrada, saidaFinal, db.tabelaPrecos);

  let valorFinal = calculo.valorTotal - Number(desconto || 0) + Number(acrescimo || 0);
  if (valorFinal < 0) valorFinal = 0;
  valorFinal = Number(valorFinal.toFixed(2));

  // Atualiza a sessão para PAGO
  sessao.status = 'PAGO';
  sessao.saida = saidaFinal;
  sessao.tempoMinutos = calculo.tempoMinutos;
  sessao.tempoFormatado = calculo.tempoFormatado;
  sessao.valorBase = calculo.valorTotal;
  sessao.desconto = Number(desconto || 0);
  sessao.acrescimo = Number(acrescimo || 0);
  sessao.valorCobrado = valorFinal;
  sessao.formaPagamento = 'PIX';
  sessao.valorRecebido = valorFinal;
  sessao.troco = 0;
  sessao.historicoCalculo = calculo.detalhes;
  sessao.observacoes = observacoes;

  // Recibo / Comprovante Oficial (TICKET LIBERADO APÓS PAGAMENTO)
  const comprovante = {
    numeroCupom: 'REC-' + sessao.id.replace('SES-', ''),
    sessaoId: sessao.id,
    rfid: sessao.rfid,
    titular: sessao.veiculo.nome,
    cpf: sessao.veiculo.cpf,
    placa: sessao.veiculo.placa,
    contato: sessao.veiculo.contato,
    dataEntrada: new Date(sessao.entrada).toLocaleString('pt-BR'),
    dataSaida: new Date(sessao.saida).toLocaleString('pt-BR'),
    duracaoFormatada: calculo.tempoFormatado,
    valorTotal: valorFinal,
    formaPagamento: 'PIX',
    valorRecebido: valorFinal,
    troco: 0,
    detalhesCalculo: calculo.detalhes,
    emitidoEm: new Date().toLocaleString('pt-BR')
  };

  salvarBanco(db);

  enviarEvento('pagamento_concluido', { sessao, comprovante });

  res.json({
    sucesso: true,
    mensagem: 'Pagamento PIX confirmado com sucesso! Ticket liberado e cancela aberta.',
    sessao,
    comprovante
  });
});

// ====================================================================
// ROTAS DA TABELA DE PREÇOS (5 OPÇÕES OFICIAIS)
// ====================================================================
app.get('/api/tabela-precos', (req, res) => {
  const db = lerBanco();
  res.json({ sucesso: true, tabelaPrecos: db.tabelaPrecos });
});

app.put('/api/tabela-precos', (req, res) => {
  const db = lerBanco();
  const { isencaoMinutos, valor30min, valor1Hora, valorHoraAdicional, valorDiaria, limiteHorasDiaria } = req.body;

  db.tabelaPrecos = {
    isencaoMinutos: Number(isencaoMinutos) >= 0 ? Number(isencaoMinutos) : (db.tabelaPrecos.isencaoMinutos || 15),
    valor30min: Number(valor30min) >= 0 ? Number(valor30min) : (db.tabelaPrecos.valor30min || 5.0),
    valor1Hora: Number(valor1Hora) >= 0 ? Number(valor1Hora) : (db.tabelaPrecos.valor1Hora || 10.0),
    valorHoraAdicional: Number(valorHoraAdicional) >= 0 ? Number(valorHoraAdicional) : (db.tabelaPrecos.valorHoraAdicional || 5.0),
    valorDiaria: Number(valorDiaria) >= 0 ? Number(valorDiaria) : (db.tabelaPrecos.valorDiaria || 40.0),
    limiteHorasDiaria: Number(limiteHorasDiaria) >= 1 ? Number(limiteHorasDiaria) : (db.tabelaPrecos.limiteHorasDiaria || 8)
  };

  salvarBanco(db);
  enviarEvento('tabela_atualizada', db.tabelaPrecos);

  res.json({ sucesso: true, mensagem: 'Tabela de preços atualizada com sucesso!', tabelaPrecos: db.tabelaPrecos });
});

// Inicialização resiliente do servidor com fallback de porta
function iniciarServidor(porta) {
  const servidor = app.listen(porta, () => {
    console.log(`====================================================`);
    console.log(` SmartPark RFID - Sistema de Estacionamento (PEX)   `);
    console.log(` Servidor rodando em: http://localhost:${porta}        `);
    console.log(`====================================================`);
  });

  servidor.on('error', (err) => {
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && porta === 3000) {
      console.warn(`Porta 3000 indisponível (${err.code}). Tentando fallback para porta 3001...`);
      iniciarServidor(3001);
    } else {
      console.error('Erro fatal ao iniciar servidor:', err);
    }
  });

  return servidor;
}

iniciarServidor(PORT);
