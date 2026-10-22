const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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
          toleranciaMinutos: 10,
          primeiraHora: 5.0,
          horaAdicional: 5.0,
          fracao15min: 2.0,
          valorDiaria: 50.0,
          limiteHorasDiaria: 8,
          modoCobranca: 'hora_fracao'
        },
        config: {
          admin: {
            login: 'admin',
            senha: '123',
            nome: 'Administrador SmartPark'
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

    if (!db.config) {
      db.config = {
        admin: { login: 'admin', senha: '123', nome: 'Administrador SmartPark' }
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
// REGRA DE CÁLCULO DA TABELA DE PREÇOS
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

  const tolerancia = Number(tabela.toleranciaMinutos) || 10;
  const primeiraHora = Number(tabela.primeiraHora) || 5.0;
  const horaAdicional = Number(tabela.horaAdicional) || 5.0;
  const fracao15min = Number(tabela.fracao15min) || 2.0;
  const valorDiaria = Number(tabela.valorDiaria) || 50.0;
  const limiteDiariaMin = (Number(tabela.limiteHorasDiaria) || 8) * 60;

  // 1. Tolerância
  if (totalMinutos <= tolerancia) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: 0.00,
      isTolerancia: true,
      detalhes: `Tempo dentro do período de tolerância gratuita (${tolerancia} min). Valor isento.`
    };
  }

  // 2. Diária
  if (totalMinutos >= limiteDiariaMin) {
    return {
      tempoMinutos: totalMinutos,
      tempoSegundos: totalSegundos,
      tempoFormatado,
      valorTotal: valorDiaria,
      isTolerancia: false,
      detalhes: `Tempo superior a ${tabela.limiteHorasDiaria}h. Aplicada tarifa diária máxima de R$ ${valorDiaria.toFixed(2)}.`
    };
  }

  // 3. Primeira hora
  let valor = primeiraHora;
  let detalhes = `1ª Hora: R$ ${primeiraHora.toFixed(2)}`;

  // 4. Minutos adicionais além de 60 min
  if (totalMinutos > 60) {
    const excedente = totalMinutos - 60;
    if (tabela.modoCobranca === 'hora_fracao') {
      const qtdFracoes = Math.ceil(excedente / 15);
      const valorFracoes = qtdFracoes * fracao15min;
      valor += valorFracoes;
      detalhes += ` + ${qtdFracoes} fração(ões) de 15min (${excedente}m excedentes): R$ ${valorFracoes.toFixed(2)}`;
    } else {
      const horasExcedentes = Math.ceil(excedente / 60);
      const valorHoras = horasExcedentes * horaAdicional;
      valor += valorHoras;
      detalhes += ` + ${horasExcedentes}h adicional(is): R$ ${valorHoras.toFixed(2)}`;
    }
  }

  // Não excede o valor da diária
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
// AUTENTICAÇÃO E CARGOS (ADMIN vs CLIENTE)
// ====================================================================
app.post('/api/auth/login', (req, res) => {
  const db = lerBanco();
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe o login e a senha.' });
  }

  const loginLimpo = login.trim().toLowerCase();
  const senhaLimpa = senha.trim();

  // 1. Verifica se é Administrador
  const adminConfig = db.config?.admin || { login: 'admin', senha: '123', nome: 'Administrador SmartPark' };
  if (loginLimpo === adminConfig.login.toLowerCase() && senhaLimpa === adminConfig.senha) {
    return res.json({
      sucesso: true,
      token: 'token-admin-' + Date.now(),
      usuario: {
        role: 'admin',
        nome: adminConfig.nome || 'Administrador',
        login: adminConfig.login
      }
    });
  }

  // 2. Verifica se é um Cliente / Veículo cadastrado
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
    return res.json({
      sucesso: true,
      token: 'token-cliente-' + veiculo.id + '-' + Date.now(),
      usuario: {
        role: 'cliente',
        veiculo: {
          id: veiculo.id,
          rfid: veiculo.rfid,
          nome: veiculo.nome,
          placa: veiculo.placa,
          contato: veiculo.contato,
          cpf: veiculo.cpf,
          login: veiculo.login || veiculo.placa
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
      login: veiculo.login || veiculo.placa
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
  let { rfid, nome, placa, contato, cpf, login, senha } = req.body;

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

  // Verifica se o RFID já está cadastrado
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
    criadoEm: new Date().toISOString()
  };

  db.veiculos.push(novoVeiculo);
  salvarBanco(db);

  enviarEvento('veiculo_cadastrado', novoVeiculo);

  res.status(201).json({ sucesso: true, mensagem: 'Veículo e RFID cadastrados com sucesso!', veiculo: novoVeiculo });
});

app.put('/api/veiculos/:rfid', (req, res) => {
  const db = lerBanco();
  const rfidParam = req.params.rfid.trim().toUpperCase();
  const index = db.veiculos.findIndex(v => v.rfid.toUpperCase() === rfidParam);

  if (index === -1) {
    return res.status(404).json({ sucesso: false, mensagem: 'Veículo não encontrado para alteração.' });
  }

  const { nome, placa, contato, cpf, login, senha } = req.body;
  if (nome) db.veiculos[index].nome = nome.trim();
  if (placa) db.veiculos[index].placa = placa.trim().toUpperCase();
  if (contato) db.veiculos[index].contato = contato.trim();
  if (cpf) db.veiculos[index].cpf = cpf.trim();
  if (login) db.veiculos[index].login = login.trim().toUpperCase();
  if (senha) db.veiculos[index].senha = senha.trim();

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

  // 1. Verifica se o RFID está cadastrado
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

  // 2. Veículo cadastrado: verifica se já está estacionado
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

  // 3. REGISTRA A ENTRADA E INICIA O TEMPORIZADOR!
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
    formaPagamento: null,
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
// FUNCIONALIDADE DO SITE: PAGAMENTO
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

  res.json({
    sucesso: true,
    sessao,
    saida: momentoSaida,
    ...calculo
  });
});

app.post('/api/pagamento/finalizar', (req, res) => {
  const db = lerBanco();
  const {
    sessaoId,
    formaPagamento,
    valorRecebido,
    saidaTimestamp,
    desconto = 0,
    acrescimo = 0,
    observacoes = ''
  } = req.body;

  if (!sessaoId || !formaPagamento) {
    return res.status(400).json({ sucesso: false, mensagem: 'Sessão e Forma de Pagamento são obrigatórias.' });
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

  let troco = 0;
  if (formaPagamento === 'dinheiro' && valorRecebido) {
    troco = Math.max(0, Number(valorRecebido) - valorFinal);
    troco = Number(troco.toFixed(2));
  }

  sessao.status = 'PAGO';
  sessao.saida = saidaFinal;
  sessao.tempoMinutos = calculo.tempoMinutos;
  sessao.tempoFormatado = calculo.tempoFormatado;
  sessao.valorBase = calculo.valorTotal;
  sessao.desconto = Number(desconto || 0);
  sessao.acrescimo = Number(acrescimo || 0);
  sessao.valorCobrado = valorFinal;
  sessao.formaPagamento = formaPagamento;
  sessao.valorRecebido = valorRecebido ? Number(valorRecebido) : valorFinal;
  sessao.troco = troco;
  sessao.historicoCalculo = calculo.detalhes;
  sessao.observacoes = observacoes;

  // Recibo / Comprovante
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
    formaPagamento: formaPagamento.toUpperCase(),
    valorRecebido: sessao.valorRecebido,
    troco: sessao.troco,
    detalhesCalculo: calculo.detalhes,
    emitidoEm: new Date().toLocaleString('pt-BR')
  };

  salvarBanco(db);

  enviarEvento('pagamento_concluido', { sessao, comprovante });

  res.json({
    sucesso: true,
    mensagem: 'Pagamento concluído com sucesso e cancela liberada!',
    sessao,
    comprovante
  });
});

// ====================================================================
// ROTAS DA TABELA DE PREÇOS
// ====================================================================
app.get('/api/tabela-precos', (req, res) => {
  const db = lerBanco();
  res.json({ sucesso: true, tabelaPrecos: db.tabelaPrecos });
});

app.put('/api/tabela-precos', (req, res) => {
  const db = lerBanco();
  const { toleranciaMinutos, primeiraHora, horaAdicional, fracao15min, valorDiaria, limiteHorasDiaria, modoCobranca } = req.body;

  db.tabelaPrecos = {
    toleranciaMinutos: Number(toleranciaMinutos) >= 0 ? Number(toleranciaMinutos) : db.tabelaPrecos.toleranciaMinutos,
    primeiraHora: Number(primeiraHora) >= 0 ? Number(primeiraHora) : db.tabelaPrecos.primeiraHora,
    horaAdicional: Number(horaAdicional) >= 0 ? Number(horaAdicional) : db.tabelaPrecos.horaAdicional,
    fracao15min: Number(fracao15min) >= 0 ? Number(fracao15min) : db.tabelaPrecos.fracao15min,
    valorDiaria: Number(valorDiaria) >= 0 ? Number(valorDiaria) : db.tabelaPrecos.valorDiaria,
    limiteHorasDiaria: Number(limiteHorasDiaria) >= 1 ? Number(limiteHorasDiaria) : db.tabelaPrecos.limiteHorasDiaria,
    modoCobranca: modoCobranca || db.tabelaPrecos.modoCobranca || 'hora_fracao'
  };

  salvarBanco(db);
  enviarEvento('tabela_atualizada', db.tabelaPrecos);

  res.json({ sucesso: true, mensagem: 'Tabela de preços atualizada com sucesso!', tabelaPrecos: db.tabelaPrecos });
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` SmartPark RFID - Sistema de Estacionamento (PEX)   `);
  console.log(` Servidor rodando em: http://localhost:${PORT}        `);
  console.log(`====================================================`);
});
