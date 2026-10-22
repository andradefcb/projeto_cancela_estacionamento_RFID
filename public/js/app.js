/**
 * SmartPark RFID - Sistema de Estacionamento Inteligente
 * Projeto PEX 2° Período
 *
 * Suporte a:
 * - Sistema de Cargos (Admin vs Cliente/Veículo) e Login
 * - Cronômetros ao vivo em tempo real (Pátio e Portal do Cliente)
 * - Tela de Pagamento por Tabela (Guarita e Online pelo Cliente)
 * - Integração com Arduino via Web Serial API
 */

// Estado Global da Aplicação
const Estado = {
  usuario: null, // { role: 'admin' | 'cliente', nome, veiculo, token }
  veiculos: [],
  sessoesAtivas: [],
  historico: [],
  tabelaPrecos: {
    toleranciaMinutos: 10,
    primeiraHora: 5.0,
    horaAdicional: 5.0,
    fracao15min: 2.0,
    valorDiaria: 50.0,
    limiteHorasDiaria: 8,
    modoCobranca: 'hora_fracao'
  },
  ultimoRfidLido: '',
  sessaoSelecionadaId: null,
  metodoPagamento: 'pix',
  metodoPagamentoCliente: 'pix',
  dadosClientePortal: null,
  intervaloCronometro: null
};

// ====================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  configurarAutenticacao();
  configurarNavegacaoAbas();
  configurarEventosForms();
  configurarEventosPagamento();
  configurarEventosPortalCliente();
  configurarSimulador();
  configurarSSE();
  configurarOuvinteSerialRFID();

  // Verifica se já existe sessão salva
  verificarSessaoSalva();

  // Inicia loop de atualização de cronômetros em tempo real
  iniciarLoopCronometro();
});

// ====================================================================
// AUTENTICAÇÃO E CONTROLE DE CARGOS (ADMIN vs CLIENTE)
// ====================================================================
function configurarAutenticacao() {
  const formLogin = document.getElementById('form-login');
  const btnRoleCliente = document.getElementById('btn-role-cliente');
  const btnRoleAdmin = document.getElementById('btn-role-admin');
  const lblLogin = document.getElementById('lbl-login-input');
  const helpLogin = document.getElementById('help-login-input');
  const inputLogin = document.getElementById('input-login');
  const inputSenha = document.getElementById('input-senha');

  btnRoleCliente?.addEventListener('click', () => {
    btnRoleCliente.classList.add('active');
    btnRoleAdmin.classList.remove('active');
    lblLogin.innerText = 'Placa do Veículo, CPF ou Login:';
    helpLogin.innerText = 'Digite a placa do seu carro ou CPF cadastrado.';
    inputLogin.placeholder = 'Ex: BRA2E19 ou seu CPF';
    inputLogin.value = '';
    inputSenha.value = '';
    inputLogin.focus();
  });

  btnRoleAdmin?.addEventListener('click', () => {
    btnRoleAdmin.classList.add('active');
    btnRoleCliente.classList.remove('active');
    lblLogin.innerText = 'Login de Administrador:';
    helpLogin.innerText = 'Digite as credenciais da guarita/administração.';
    inputLogin.placeholder = 'Ex: admin';
    inputLogin.value = 'admin';
    inputSenha.value = '123';
    inputSenha.focus();
  });

  // Botões de Demonstração Rápida
  document.getElementById('btn-demo-admin')?.addEventListener('click', () => {
    btnRoleAdmin.click();
    inputLogin.value = 'admin';
    inputSenha.value = '123';
    formLogin.requestSubmit();
  });

  document.getElementById('btn-demo-cliente')?.addEventListener('click', () => {
    btnRoleCliente.click();
    const primeiro = Estado.veiculos[0];
    inputLogin.value = primeiro ? (primeiro.login || primeiro.placa) : 'PHE1493';
    inputSenha.value = primeiro ? (primeiro.senha || '123') : '123';
    formLogin.requestSubmit();
  });

  // Submissão do Formulário de Login
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const login = inputLogin.value.trim();
    const senha = inputSenha.value.trim();

    if (!login || !senha) {
      mostrarToast('Preencha o login e a senha.', 'warning');
      return;
    }

    try {
      const btnSubmit = document.getElementById('btn-submit-login');
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Autenticando...';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, senha })
      });

      const dados = await res.json();
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Acessar Sistema';

      if (!dados.sucesso) {
        mostrarToast(dados.mensagem || 'Falha no login.', 'danger');
        return;
      }

      // Login bem-sucedido
      Estado.usuario = dados.usuario;
      localStorage.setItem('smartpark_user', JSON.stringify(dados.usuario));
      mostrarToast(`Bem-vindo, ${dados.usuario.nome || 'Usuário'}!`, 'success');

      aplicarVisualPorCargo(dados.usuario);
    } catch (err) {
      console.error('Erro no login:', err);
      mostrarToast('Erro ao conectar ao servidor.', 'danger');
    }
  });

  // Botão Sair (Logout)
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (confirm('Deseja realmente sair do sistema?')) {
      fazerLogout();
    }
  });
}

function verificarSessaoSalva() {
  const salvo = localStorage.getItem('smartpark_user');
  if (salvo) {
    try {
      Estado.usuario = JSON.parse(salvo);
      aplicarVisualPorCargo(Estado.usuario);
      return;
    } catch (e) {
      localStorage.removeItem('smartpark_user');
    }
  }

  // Se não estiver logado, exibe tela de login
  document.getElementById('tela-login').style.display = 'flex';
  document.getElementById('tela-principal-app').style.display = 'none';
}

function aplicarVisualPorCargo(usuario) {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('tela-principal-app').style.display = 'block';

  const avatarEl = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const navSubtitle = document.getElementById('nav-subtitle');

  if (usuario.role === 'admin') {
    // VISÃO DE ADMINISTRADOR
    avatarEl.innerHTML = '<i class="fa-solid fa-user-shield"></i>';
    nameEl.innerText = usuario.nome || 'Administrador';
    roleEl.innerText = 'ADMINISTRADOR';
    navSubtitle.innerText = 'Painel Geral • Guarita';

    document.getElementById('admin-nav-tabs').style.display = 'flex';
    document.getElementById('portal-admin').style.display = 'block';
    document.getElementById('portal-cliente').style.display = 'none';

    carregarStatusDashboard();
    carregarTabelaPrecos();
    carregarVeiculos();
    carregarSessoesAtivas();
    carregarHistorico();
    mudarAba('tab-patio');
  } else {
    // VISÃO DE CLIENTE / PROPRIETÁRIO DO VEÍCULO
    avatarEl.innerHTML = '<i class="fa-solid fa-car"></i>';
    nameEl.innerText = usuario.veiculo.nome || 'Cliente';
    roleEl.innerText = `VEÍCULO ${usuario.veiculo.placa}`;
    navSubtitle.innerText = 'Portal do Motorista';

    document.getElementById('admin-nav-tabs').style.display = 'none';
    document.getElementById('portal-admin').style.display = 'none';
    document.getElementById('portal-cliente').style.display = 'block';

    carregarTabelaPrecos();
    carregarDadosPortalCliente(usuario.veiculo.rfid);
  }
}

function fazerLogout() {
  localStorage.removeItem('smartpark_user');
  Estado.usuario = null;
  document.getElementById('tela-principal-app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
  document.getElementById('input-login').value = '';
  document.getElementById('input-senha').value = '';
  mostrarToast('Você saiu do sistema.', 'info');
}

// ====================================================================
// PORTAL DO CLIENTE (ACOMPANHAMENTO DO TEMPO E PAGAMENTO DO SEU CARRO)
// ====================================================================
function configurarEventosPortalCliente() {
  const cliMethodPix = document.getElementById('cli-method-pix');
  const cliMethodCartao = document.getElementById('cli-method-cartao');
  const cliAreaPix = document.getElementById('cli-area-pix');

  cliMethodPix?.addEventListener('click', () => {
    cliMethodPix.classList.add('selected');
    cliMethodCartao.classList.remove('selected');
    Estado.metodoPagamentoCliente = 'pix';
    if (cliAreaPix) cliAreaPix.style.display = 'block';
  });

  cliMethodCartao?.addEventListener('click', () => {
    cliMethodCartao.classList.add('selected');
    cliMethodPix.classList.remove('selected');
    Estado.metodoPagamentoCliente = 'cartao_credito';
    if (cliAreaPix) cliAreaPix.style.display = 'none';
  });

  // Botão Pagar pelo Portal do Cliente
  document.getElementById('btn-cli-confirmar-pagamento')?.addEventListener('click', async () => {
    await finalizarPagamentoCliente();
  });

  // Botão Simular Entrada do próprio cliente
  document.getElementById('btn-cli-simular-entrada')?.addEventListener('click', async () => {
    if (Estado.usuario && Estado.usuario.veiculo) {
      await processarLeituraRFID(Estado.usuario.veiculo.rfid);
      carregarDadosPortalCliente(Estado.usuario.veiculo.rfid);
    }
  });
}

async function carregarDadosPortalCliente(rfid) {
  try {
    const res = await fetch(`/api/cliente/meu-veiculo/${rfid}`);
    const dados = await res.json();

    if (!dados.sucesso) {
      mostrarToast('Não foi possível carregar os dados do seu veículo.', 'danger');
      return;
    }

    Estado.dadosClientePortal = dados;

    // Atualiza cabeçalho do cliente
    document.getElementById('cli-veiculo-placa').innerText = dados.veiculo.placa;
    document.getElementById('cli-veiculo-rfid').innerText = `RFID: ${dados.veiculo.rfid}`;
    document.getElementById('cli-titular-nome').innerText = dados.veiculo.nome;
    document.getElementById('cli-titular-cpf').innerText = dados.veiculo.cpf;
    document.getElementById('cli-titular-contato').innerText = dados.veiculo.contato;

    const statusBadge = document.getElementById('cli-status-badge');
    const blocoEstacionado = document.getElementById('cli-bloco-estacionado');
    const blocoFora = document.getElementById('cli-bloco-fora');

    if (dados.estacionado && dados.sessaoAtiva) {
      // CARRO ESTACIONADO
      statusBadge.className = 'client-status-badge parked';
      statusBadge.innerHTML = '<i class="fa-solid fa-car-side fa-beat"></i> Estacionado no Pátio';
      blocoEstacionado.style.display = 'block';
      blocoFora.style.display = 'none';

      document.getElementById('cli-hora-entrada').innerText = new Date(dados.sessaoAtiva.entrada).toLocaleTimeString('pt-BR');
      atualizarValoresTempoCliente(dados.sessaoAtiva.entrada);
    } else {
      // CARRO FORA DO PÁTIO
      statusBadge.className = 'client-status-badge outside';
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Fora do Estacionamento';
      blocoEstacionado.style.display = 'none';
      blocoFora.style.display = 'block';
    }

    renderizarHistoricoCliente(dados.historico || []);
  } catch (err) {
    console.error('Erro ao carregar portal do cliente:', err);
  }
}

function atualizarValoresTempoCliente(entradaMs) {
  const agora = Date.now();
  const cronEl = document.getElementById('cli-cronometro-tempo');
  const valorEl = document.getElementById('cli-valor-total');
  const calcEl = document.getElementById('cli-detalhes-calculo');

  if (cronEl) cronEl.innerText = formatarTempoHMS(agora - entradaMs);

  const calc = calcularValorTempoReal(entradaMs, agora);
  if (valorEl) valorEl.innerText = formatarMoeda(calc.valorTotal);
  if (calcEl) calcEl.innerText = calc.detalhes;
}

async function finalizarPagamentoCliente() {
  const portal = Estado.dadosClientePortal;
  if (!portal || !portal.sessaoAtiva) {
    mostrarToast('Nenhuma sessão ativa encontrada para pagamento.', 'warning');
    return;
  }

  const sessao = portal.sessaoAtiva;
  const btnPagar = document.getElementById('btn-cli-confirmar-pagamento');

  try {
    btnPagar.disabled = true;
    btnPagar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando Pagamento...';

    const payload = {
      sessaoId: sessao.id,
      formaPagamento: Estado.metodoPagamentoCliente,
      valorRecebido: null,
      desconto: 0,
      acrescimo: 0,
      saidaTimestamp: Date.now()
    };

    const res = await fetch('/api/pagamento/finalizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resposta = await res.json();
    btnPagar.disabled = false;
    btnPagar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagar Agora e Liberar Cancela';

    if (!resposta.sucesso) {
      mostrarToast(resposta.mensagem, 'danger');
      return;
    }

    // Abre a cancela de saída no Arduino!
    arduinoSerial.enviarComando('OPEN');

    mostrarToast('✅ Pagamento concluído com sucesso! Cancela liberada.', 'success');

    abrirModalRecibo(resposta.comprovante);

    // Recarrega o portal do cliente
    carregarDadosPortalCliente(portal.veiculo.rfid);
  } catch (err) {
    console.error('Erro ao pagar pelo portal:', err);
    btnPagar.disabled = false;
    btnPagar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagar Agora e Liberar Cancela';
    mostrarToast('Erro ao processar pagamento.', 'danger');
  }
}

function renderizarHistoricoCliente(historico) {
  const tbody = document.getElementById('cli-historico-tabela-body');
  if (!tbody) return;

  if (historico.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Você ainda não possui estadias finalizadas registradas.</td></tr>';
    return;
  }

  tbody.innerHTML = historico.map(s => `
    <tr>
      <td><strong>REC-${s.id.replace('SES-', '')}</strong></td>
      <td>${new Date(s.entrada).toLocaleString('pt-BR')}</td>
      <td>${s.saida ? new Date(s.saida).toLocaleString('pt-BR') : '-'}</td>
      <td>${s.tempoFormatado || '-'}</td>
      <td style="font-weight: 700; color: var(--success);">${formatarMoeda(s.valorCobrado || 0)}</td>
      <td><span class="badge" style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase;">${s.formaPagamento || '-'}</span></td>
      <td style="text-align: right;">
        <button class="btn btn-outline btn-sm" onclick="reimprimirRecibo('${s.id}')">
          <i class="fa-solid fa-receipt"></i> Recibo
        </button>
      </td>
    </tr>
  `).join('');
}

function copiarChavePix() {
  const chave = 'pex-estacionamento-2026@arduino.org';
  navigator.clipboard.writeText(chave);
  mostrarToast('Chave Pix copiada para a área de transferência!', 'success');
}

// ====================================================================
// SERVER-SENT EVENTS (SSE) E ATUALIZAÇÕES EM TEMPO REAL
// ====================================================================
function configurarSSE() {
  try {
    const evtSource = new EventSource('/api/eventos');

    evtSource.addEventListener('entrada_registrada', (e) => {
      const dados = JSON.parse(e.data);
      mostrarToast(`🚗 Entrada: ${dados.veiculo.placa} (${dados.veiculo.nome})!`, 'info');

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarSessoesAtivas();
        carregarStatusDashboard();
      } else if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.usuario.veiculo.rfid === dados.veiculo.rfid) {
        carregarDadosPortalCliente(dados.veiculo.rfid);
      }
    });

    evtSource.addEventListener('pagamento_concluido', (e) => {
      const dados = JSON.parse(e.data);

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarSessoesAtivas();
        carregarHistorico();
        carregarStatusDashboard();
      } else if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.usuario.veiculo.rfid === dados.sessao.rfid) {
        carregarDadosPortalCliente(dados.sessao.rfid);
      }
    });

    evtSource.addEventListener('veiculo_cadastrado', () => {
      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarVeiculos();
        carregarStatusDashboard();
      }
    });

    evtSource.addEventListener('tabela_atualizada', (e) => {
      Estado.tabelaPrecos = JSON.parse(e.data);
      atualizarCamposTabelaPrecos();
    });
  } catch (err) {
    console.warn('SSE indisponível:', err);
  }
}

// ====================================================================
// NAVEGAÇÃO ENTRE ABAS DO ADMIN
// ====================================================================
function configurarNavegacaoAbas() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }

      if (targetId === 'tab-patio') carregarSessoesAtivas();
      if (targetId === 'tab-pagamento') atualizarSelectSessaoPagamento();
      if (targetId === 'tab-veiculos') carregarVeiculos();
      if (targetId === 'tab-historico') carregarHistorico();
    });
  });

  const btnNovoVeiculo = document.getElementById('btn-novo-veiculo-atalho');
  if (btnNovoVeiculo) {
    btnNovoVeiculo.addEventListener('click', () => {
      mudarAba('tab-veiculos');
      document.getElementById('cad-rfid').focus();
    });
  }

  document.getElementById('btn-atualizar-patio')?.addEventListener('click', carregarSessoesAtivas);
  document.getElementById('btn-atualizar-historico')?.addEventListener('click', carregarHistorico);
}

function mudarAba(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

// ====================================================================
// LEITURA SERIAL DE RFID (ARDUINO / USB)
// ====================================================================
function configurarOuvinteSerialRFID() {
  window.addEventListener('rfid-lido', (e) => {
    const rfid = e.detail.rfid;
    processarLeituraRFID(rfid);
  });
}

async function processarLeituraRFID(rfid) {
  if (!rfid) return;
  Estado.ultimoRfidLido = rfid;

  const inputCadRfid = document.getElementById('cad-rfid');
  if (document.getElementById('tab-veiculos')?.classList.contains('active')) {
    inputCadRfid.value = rfid;
    mostrarToast(`Código RFID ${rfid} capturado para cadastro!`, 'info');
    document.getElementById('cad-nome').focus();
    return;
  }

  try {
    const res = await fetch('/api/leitura-rfid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfid })
    });
    const dados = await res.json();

    if (!dados.registrado) {
      arduinoSerial.enviarComando('DENIED');
      mostrarToast(dados.mensagem, 'warning');

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        if (confirm(`Tag RFID ${rfid} não cadastrada!\n\nDeseja cadastrar agora para associar ao titular e veículo?`)) {
          mudarAba('tab-veiculos');
          inputCadRfid.value = rfid;
          document.getElementById('cad-nome').focus();
        }
      }
      return;
    }

    if (dados.acao === 'ENTRADA_REGISTRADA') {
      arduinoSerial.enviarComando('OPEN');
      mostrarToast(`✅ Entrada autorizada: ${dados.veiculo.placa} - Temporizador iniciado!`, 'success');

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarSessoesAtivas();
        carregarStatusDashboard();
        mudarAba('tab-patio');
      } else if (Estado.usuario && Estado.usuario.role === 'cliente') {
        carregarDadosPortalCliente(dados.veiculo.rfid);
      }
      return;
    }

    if (dados.acao === 'JA_ESTACIONADO') {
      mostrarToast(`Veículo ${dados.veiculo.placa} já no pátio!`, 'info');

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        mudarAba('tab-pagamento');
        selecionarSessaoParaPagamento(dados.sessao.id);
      }
      return;
    }
  } catch (err) {
    console.error('Erro ao processar RFID:', err);
    mostrarToast('Erro ao comunicar com o servidor.', 'danger');
  }
}

// ====================================================================
// CARREGAMENTO DE DADOS (ADMIN)
// ====================================================================
async function carregarStatusDashboard() {
  try {
    const res = await fetch('/api/status');
    const dados = await res.json();
    if (dados.sucesso) {
      document.getElementById('stat-ocupados').innerText = dados.estacionadosAgora;
      document.getElementById('stat-faturamento').innerText = formatarMoeda(dados.faturamentoHoje);
      document.getElementById('stat-cadastrados').innerText = dados.veiculosCadastrados;
      document.getElementById('stat-saidas').innerText = dados.totalSessoesHoje;
    }
  } catch (e) {
    console.warn('Erro ao carregar status:', e);
  }
}

async function carregarTabelaPrecos() {
  try {
    const res = await fetch('/api/tabela-precos');
    const dados = await res.json();
    if (dados.sucesso) {
      Estado.tabelaPrecos = dados.tabelaPrecos;
      atualizarCamposTabelaPrecos();
    }
  } catch (e) {
    console.warn('Erro ao carregar tabela de preços:', e);
  }
}

function atualizarCamposTabelaPrecos() {
  const t = Estado.tabelaPrecos;
  if (!t) return;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  setVal('tab-tolerancia', t.toleranciaMinutos);
  setVal('tab-primeira-hora', Number(t.primeiraHora).toFixed(2));
  setVal('tab-modo-cobranca', t.modoCobranca || 'hora_fracao');
  setVal('tab-fracao-15min', Number(t.fracao15min).toFixed(2));
  setVal('tab-hora-adicional', Number(t.horaAdicional).toFixed(2));
  setVal('tab-valor-diaria', Number(t.valorDiaria).toFixed(2));
  setVal('tab-limite-diaria', t.limiteHorasDiaria);

  setText('prev-tolerancia', t.toleranciaMinutos);
  setText('prev-primeira-hora', Number(t.primeiraHora).toFixed(2));
  setText('prev-limite-diaria', t.limiteHorasDiaria);
  setText('prev-diaria', Number(t.valorDiaria).toFixed(2));
}

async function carregarVeiculos() {
  try {
    const res = await fetch('/api/veiculos');
    const dados = await res.json();
    if (dados.sucesso) {
      Estado.veiculos = dados.veiculos;
      renderizarTabelaVeiculos(dados.veiculos);
      renderizarTagsSimulador(dados.veiculos);
      document.getElementById('lbl-total-veiculos-tabela').innerText = `${dados.veiculos.length} veículos cadastrados`;
    }
  } catch (e) {
    console.warn('Erro ao carregar veículos:', e);
  }
}

async function carregarSessoesAtivas() {
  try {
    const res = await fetch('/api/sessoes/ativas');
    const dados = await res.json();
    if (dados.sucesso) {
      Estado.sessoesAtivas = dados.sessoes;
      renderizarPatio(dados.sessoes);
      atualizarSelectSessaoPagamento();
      carregarStatusDashboard();
    }
  } catch (e) {
    console.warn('Erro ao carregar sessões ativas:', e);
  }
}

async function carregarHistorico() {
  try {
    const res = await fetch('/api/sessoes/historico');
    const dados = await res.json();
    if (dados.sucesso) {
      Estado.historico = dados.historico;
      renderizarTabelaHistorico(dados.historico);
    }
  } catch (e) {
    console.warn('Erro ao carregar histórico:', e);
  }
}

// ====================================================================
// RENDERIZAÇÃO: PÁTIO EM TEMPO REAL (CARDS COM CRONÔMETRO)
// ====================================================================
function renderizarPatio(sessoes) {
  const container = document.getElementById('patio-grid');
  if (!container) return;

  if (sessoes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-square-parking"></i></div>
        <h3>O Pátio está Vazio</h3>
        <p>Aproxime uma tag RFID cadastrada no leitor para registrar uma entrada ou use o botão <strong>Simular RFID</strong>.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sessoes.map(s => {
    const calc = calcularValorTempoReal(s.entrada, Date.now());
    const tempoHms = formatarTempoHMS(Date.now() - s.entrada);

    return `
      <div class="vehicle-card" data-sessao-id="${s.id}" data-entrada="${s.entrada}">
        <div>
          <div class="vehicle-card-top">
            <span class="car-badge"><i class="fa-solid fa-car"></i> ${s.veiculo.placa}</span>
            <span class="rfid-tag-badge">RFID: ${s.rfid}</span>
          </div>

          <div class="vehicle-info-block">
            <h4>${s.veiculo.nome}</h4>
            <p><i class="fa-solid fa-id-card"></i> CPF: ${s.veiculo.cpf}</p>
            <p><i class="fa-solid fa-phone"></i> ${s.veiculo.contato}</p>
            <p><i class="fa-regular fa-clock"></i> Entrada: ${new Date(s.entrada).toLocaleTimeString()}</p>
          </div>
        </div>

        <div>
          <div class="timer-box">
            <div>
              <div class="timer-label"><i class="fa-solid fa-stopwatch"></i> Tempo Estacionado</div>
              <div class="timer-value card-cronometro">${tempoHms}</div>
            </div>
            <div>
              <div class="timer-label">Valor Parcial</div>
              <div class="timer-cost card-valor">${formatarMoeda(calc.valorTotal)}</div>
            </div>
          </div>

          <div class="card-footer-actions">
            <button class="btn btn-success btn-sm" style="flex: 1;" onclick="irParaPagamentoComSessao('${s.id}')">
              <i class="fa-solid fa-cash-register"></i> Finalizar & Pagar
            </button>
            <button class="btn btn-outline btn-sm" style="color: var(--danger);" title="Cancelar entrada" onclick="cancelarSessao('${s.id}')">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// LOOP CONTÍNUO QUE ATUALIZA TODOS OS CRONÔMETROS AO VIVO A CADA SEGUNDO
function iniciarLoopCronometro() {
  if (Estado.intervaloCronometro) clearInterval(Estado.intervaloCronometro);

  Estado.intervaloCronometro = setInterval(() => {
    const agora = Date.now();

    // 1. Atualiza os cards no pátio do Admin
    const cards = document.querySelectorAll('.vehicle-card');
    cards.forEach(card => {
      const entrada = Number(card.getAttribute('data-entrada'));
      if (entrada) {
        const decorrido = agora - entrada;
        const cronEl = card.querySelector('.card-cronometro');
        const valorEl = card.querySelector('.card-valor');

        if (cronEl) cronEl.innerText = formatarTempoHMS(decorrido);
        if (valorEl) {
          const calc = calcularValorTempoReal(entrada, agora);
          valorEl.innerText = formatarMoeda(calc.valorTotal);
        }
      }
    });

    // 2. Atualiza a tela de pagamento da guarita (se aberta)
    if (Estado.sessaoSelecionadaId) {
      const sessao = Estado.sessoesAtivas.find(s => s.id === Estado.sessaoSelecionadaId);
      if (sessao) {
        const cronPag = document.getElementById('pag-cronometro-final');
        const valorPag = document.getElementById('pag-valor-total');
        const detalhesPag = document.getElementById('pag-memoria-calculo');

        if (cronPag) cronPag.innerText = formatarTempoHMS(agora - sessao.entrada);

        const calc = calcularValorTempoReal(sessao.entrada, agora);
        const desconto = Number(document.getElementById('input-desconto')?.value || 0);
        const acrescimo = Number(document.getElementById('input-acrescimo')?.value || 0);
        let final = calc.valorTotal - desconto + acrescimo;
        if (final < 0) final = 0;

        if (valorPag) valorPag.innerText = formatarMoeda(final);
        if (detalhesPag) detalhesPag.innerText = calc.detalhes;

        atualizarCalculoTroco(final);
      }
    }

    // 3. Atualiza o Portal do Cliente (se o cliente estiver logado e seu carro estiver no pátio)
    if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.dadosClientePortal && Estado.dadosClientePortal.estacionado) {
      atualizarValoresTempoCliente(Estado.dadosClientePortal.sessaoAtiva.entrada);
    }
  }, 1000);
}

// ====================================================================
// TELA DE PAGAMENTO (GUARITA / ADMIN)
// ====================================================================
function configurarEventosPagamento() {
  const selectSessao = document.getElementById('select-sessao-pagamento');
  selectSessao?.addEventListener('change', (e) => {
    selecionarSessaoParaPagamento(e.target.value);
  });

  const methodOptions = document.querySelectorAll('.method-option[data-method]');
  methodOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      methodOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      Estado.metodoPagamento = opt.getAttribute('data-method');

      const blocoPix = document.getElementById('bloco-pix');
      const blocoDinheiro = document.getElementById('bloco-dinheiro');

      if (Estado.metodoPagamento === 'pix') {
        blocoPix.style.display = 'block';
        blocoDinheiro.style.display = 'none';
      } else if (Estado.metodoPagamento === 'dinheiro') {
        blocoPix.style.display = 'none';
        blocoDinheiro.style.display = 'block';
      } else {
        blocoPix.style.display = 'none';
        blocoDinheiro.style.display = 'none';
      }
    });
  });

  const inputDinheiro = document.getElementById('input-dinheiro-recebido');
  inputDinheiro?.addEventListener('input', () => {
    const valorAtual = obterValorTotalAtual();
    atualizarCalculoTroco(valorAtual);
  });

  document.getElementById('input-desconto')?.addEventListener('input', recalcularTelaPagamento);
  document.getElementById('input-acrescimo')?.addEventListener('input', recalcularTelaPagamento);

  const btnFinalizar = document.getElementById('btn-finalizar-pagamento');
  btnFinalizar?.addEventListener('click', async () => {
    await finalizarPagamentoGuarita();
  });
}

function atualizarSelectSessaoPagamento() {
  const select = document.getElementById('select-sessao-pagamento');
  if (!select) return;

  const selecionadoAnterior = select.value;
  select.innerHTML = '<option value="">-- Selecione um veículo estacionado --</option>';

  Estado.sessoesAtivas.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.veiculo.placa} - ${s.veiculo.nome} (RFID: ${s.rfid})`;
    select.appendChild(opt);
  });

  if (selecionadoAnterior && Estado.sessoesAtivas.some(s => s.id === selecionadoAnterior)) {
    select.value = selecionadoAnterior;
  }
}

function irParaPagamentoComSessao(sessaoId) {
  mudarAba('tab-pagamento');
  selecionarSessaoParaPagamento(sessaoId);
}

function selecionarSessaoParaPagamento(sessaoId) {
  Estado.sessaoSelecionadaId = sessaoId;
  const select = document.getElementById('select-sessao-pagamento');
  if (select) select.value = sessaoId;

  const boxDetalhes = document.getElementById('box-detalhes-veiculo');
  const boxPlaceholder = document.getElementById('box-placeholder-veiculo');
  const btnFinalizar = document.getElementById('btn-finalizar-pagamento');

  if (!sessaoId) {
    if (boxDetalhes) boxDetalhes.style.display = 'none';
    if (boxPlaceholder) boxPlaceholder.style.display = 'block';
    if (btnFinalizar) btnFinalizar.disabled = true;
    return;
  }

  const sessao = Estado.sessoesAtivas.find(s => s.id === sessaoId);
  if (!sessao) {
    if (boxDetalhes) boxDetalhes.style.display = 'none';
    if (boxPlaceholder) boxPlaceholder.style.display = 'block';
    if (btnFinalizar) btnFinalizar.disabled = true;
    return;
  }

  document.getElementById('pag-veiculo-placa').innerText = sessao.veiculo.placa;
  document.getElementById('pag-veiculo-rfid').innerText = `RFID: ${sessao.rfid}`;
  document.getElementById('pag-veiculo-titular').innerText = sessao.veiculo.nome;
  document.getElementById('pag-veiculo-cpf').innerText = sessao.veiculo.cpf;
  document.getElementById('pag-veiculo-contato').innerText = sessao.veiculo.contato;
  document.getElementById('pag-tempo-entrada').innerText = new Date(sessao.entrada).toLocaleString('pt-BR');

  recalcularTelaPagamento();

  if (boxDetalhes) boxDetalhes.style.display = 'block';
  if (boxPlaceholder) boxPlaceholder.style.display = 'none';
  if (btnFinalizar) btnFinalizar.disabled = false;
}

function recalcularTelaPagamento() {
  if (!Estado.sessaoSelecionadaId) return;
  const sessao = Estado.sessoesAtivas.find(s => s.id === Estado.sessaoSelecionadaId);
  if (!sessao) return;

  const agora = Date.now();
  const calc = calcularValorTempoReal(sessao.entrada, agora);

  const desconto = Number(document.getElementById('input-desconto')?.value || 0);
  const acrescimo = Number(document.getElementById('input-acrescimo')?.value || 0);
  let final = calc.valorTotal - desconto + acrescimo;
  if (final < 0) final = 0;

  document.getElementById('pag-cronometro-final').innerText = formatarTempoHMS(agora - sessao.entrada);
  document.getElementById('pag-memoria-calculo').innerText = calc.detalhes;
  document.getElementById('pag-valor-total').innerText = formatarMoeda(final);

  atualizarCalculoTroco(final);
}

function obterValorTotalAtual() {
  const el = document.getElementById('pag-valor-total');
  if (!el) return 0;
  const text = el.innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
  return parseFloat(text) || 0;
}

function atualizarCalculoTroco(valorTotal) {
  const inputDinheiro = document.getElementById('input-dinheiro-recebido');
  const lblTroco = document.getElementById('lbl-troco-calculado');
  if (!inputDinheiro || !lblTroco) return;

  const valorRecebido = parseFloat(inputDinheiro.value) || 0;
  const troco = Math.max(0, valorRecebido - valorTotal);
  lblTroco.innerText = formatarMoeda(troco);
}

async function finalizarPagamentoGuarita() {
  if (!Estado.sessaoSelecionadaId) {
    mostrarToast('Selecione um veículo para finalizar.', 'warning');
    return;
  }

  const sessao = Estado.sessoesAtivas.find(s => s.id === Estado.sessaoSelecionadaId);
  if (!sessao) return;

  const valorRecebido = parseFloat(document.getElementById('input-dinheiro-recebido')?.value) || null;
  const desconto = parseFloat(document.getElementById('input-desconto')?.value) || 0;
  const acrescimo = parseFloat(document.getElementById('input-acrescimo')?.value) || 0;

  try {
    const btnFinalizar = document.getElementById('btn-finalizar-pagamento');
    btnFinalizar.disabled = true;
    btnFinalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';

    const payload = {
      sessaoId: sessao.id,
      formaPagamento: Estado.metodoPagamento,
      valorRecebido,
      desconto,
      acrescimo,
      saidaTimestamp: Date.now()
    };

    const res = await fetch('/api/pagamento/finalizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resposta = await res.json();

    if (!resposta.sucesso) {
      mostrarToast(resposta.mensagem, 'danger');
      btnFinalizar.disabled = false;
      btnFinalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Finalizar Temporizador & Pagar';
      return;
    }

    // Abre cancela de saída no Arduino
    arduinoSerial.enviarComando('OPEN');

    mostrarToast('✅ Pagamento registrado com sucesso! Cancela liberada.', 'success');

    abrirModalRecibo(resposta.comprovante);

    Estado.sessaoSelecionadaId = null;
    selecionarSessaoParaPagamento(null);
    document.getElementById('input-dinheiro-recebido').value = '';
    document.getElementById('input-desconto').value = '0.00';
    document.getElementById('input-acrescimo').value = '0.00';

    carregarSessoesAtivas();
    carregarHistorico();
    carregarStatusDashboard();

    btnFinalizar.disabled = true;
    btnFinalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Finalizar Temporizador & Pagar';
  } catch (err) {
    console.error('Erro ao finalizar pagamento:', err);
    mostrarToast('Erro ao processar pagamento.', 'danger');
  }
}

// ====================================================================
// MODAL: RECIBO / COMPROVANTE
// ====================================================================
function abrirModalRecibo(comprovante) {
  document.getElementById('recibo-cupom-id').innerText = comprovante.numeroCupom;
  document.getElementById('recibo-titular').innerText = comprovante.titular;
  document.getElementById('recibo-cpf').innerText = comprovante.cpf;
  document.getElementById('recibo-placa').innerText = comprovante.placa;
  document.getElementById('recibo-contato').innerText = comprovante.contato;
  document.getElementById('recibo-rfid').innerText = comprovante.rfid;
  document.getElementById('recibo-entrada').innerText = comprovante.dataEntrada;
  document.getElementById('recibo-saida').innerText = comprovante.dataSaida;
  document.getElementById('recibo-duracao').innerText = comprovante.duracaoFormatada;
  document.getElementById('recibo-detalhes').innerText = comprovante.detalhesCalculo;
  document.getElementById('recibo-valor').innerText = formatarMoeda(comprovante.valorTotal);
  document.getElementById('recibo-forma').innerText = comprovante.formaPagamento;

  const linhaTroco = document.getElementById('recibo-troco-linha');
  if (comprovante.troco && comprovante.troco > 0) {
    linhaTroco.style.display = 'block';
    document.getElementById('recibo-troco').innerText = formatarMoeda(comprovante.troco);
  } else {
    linhaTroco.style.display = 'none';
  }

  abrirModal('modal-recibo');
}

// ====================================================================
// FORMULÁRIO DE CADASTRO DE VEÍCULOS (COM LOGIN E SENHA)
// ====================================================================
function configurarEventosForms() {
  const formVeiculo = document.getElementById('form-cadastrar-veiculo');
  formVeiculo?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rfid = document.getElementById('cad-rfid').value.trim().toUpperCase();
    const nome = document.getElementById('cad-nome').value.trim();
    const placa = document.getElementById('cad-placa').value.trim().toUpperCase();
    const contato = document.getElementById('cad-contato').value.trim();
    const cpf = document.getElementById('cad-cpf').value.trim();
    const login = document.getElementById('cad-login').value.trim().toUpperCase() || placa;
    const senha = document.getElementById('cad-senha').value.trim() || '123';

    try {
      const res = await fetch('/api/veiculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid, nome, placa, contato, cpf, login, senha })
      });
      const dados = await res.json();

      if (!dados.sucesso) {
        mostrarToast(dados.mensagem, 'danger');
        return;
      }

      mostrarToast('Veículo e credenciais cadastradas com sucesso!', 'success');
      formVeiculo.reset();
      document.getElementById('cad-senha').value = '123';
      carregarVeiculos();
    } catch (err) {
      console.error('Erro ao cadastrar:', err);
      mostrarToast('Erro ao salvar veículo.', 'danger');
    }
  });

  document.getElementById('btn-capturar-rfid')?.addEventListener('click', () => {
    if (Estado.ultimoRfidLido) {
      document.getElementById('cad-rfid').value = Estado.ultimoRfidLido;
      mostrarToast(`Último RFID preenchido: ${Estado.ultimoRfidLido}`, 'info');
    } else {
      mostrarToast('Nenhum RFID foi lido recentemente.', 'warning');
    }
  });

  document.getElementById('btn-limpar-cad')?.addEventListener('click', () => {
    formVeiculo.reset();
    document.getElementById('cad-senha').value = '123';
  });

  document.getElementById('busca-veiculo')?.addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    const filtrados = Estado.veiculos.filter(v =>
      v.nome.toLowerCase().includes(termo) ||
      v.placa.toLowerCase().includes(termo) ||
      v.cpf.toLowerCase().includes(termo) ||
      v.rfid.toLowerCase().includes(termo) ||
      (v.login && v.login.toLowerCase().includes(termo))
    );
    renderizarTabelaVeiculos(filtrados);
  });

  // Salvar Tabela de Preços
  const formTabela = document.getElementById('form-tabela-precos');
  formTabela?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      toleranciaMinutos: document.getElementById('tab-tolerancia').value,
      primeiraHora: document.getElementById('tab-primeira-hora').value,
      modoCobranca: document.getElementById('tab-modo-cobranca').value,
      fracao15min: document.getElementById('tab-fracao-15min').value,
      horaAdicional: document.getElementById('tab-hora-adicional').value,
      valorDiaria: document.getElementById('tab-valor-diaria').value,
      limiteHorasDiaria: document.getElementById('tab-limite-diaria').value
    };

    try {
      const res = await fetch('/api/tabela-precos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const dados = await res.json();
      if (dados.sucesso) {
        Estado.tabelaPrecos = dados.tabelaPrecos;
        atualizarCamposTabelaPrecos();
        mostrarToast('Tabela de preços atualizada com sucesso!', 'success');
      }
    } catch (err) {
      mostrarToast('Erro ao atualizar tabela.', 'danger');
    }
  });

  aplicarMascarasInputs();
}

function renderizarTabelaVeiculos(lista) {
  const tbody = document.getElementById('tabela-veiculos-body');
  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum veículo cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(v => `
    <tr>
      <td><span class="rfid-tag-badge">${v.rfid}</span></td>
      <td><span class="car-badge" style="font-size: 0.85rem; padding: 0.2rem 0.5rem;">${v.placa}</span></td>
      <td><strong>${v.nome}</strong></td>
      <td>${v.contato}</td>
      <td><code>${v.login || v.placa}</code> / •••</td>
      <td style="text-align: right;">
        <button class="btn btn-outline btn-sm" title="Simular Entrada com este RFID" onclick="processarLeituraRFID('${v.rfid}')">
          <i class="fa-solid fa-play text-primary"></i>
        </button>
        <button class="btn btn-outline btn-sm" title="Excluir veículo" style="color: var(--danger);" onclick="excluirVeiculo('${v.rfid}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function excluirVeiculo(rfid) {
  if (!confirm(`Deseja realmente remover o veículo com a tag RFID ${rfid}?`)) return;

  try {
    const res = await fetch(`/api/veiculos/${rfid}`, { method: 'DELETE' });
    const dados = await res.json();
    if (dados.sucesso) {
      mostrarToast(dados.mensagem, 'success');
      carregarVeiculos();
    } else {
      mostrarToast(dados.mensagem, 'danger');
    }
  } catch (err) {
    mostrarToast('Erro ao excluir veículo.', 'danger');
  }
}

async function cancelarSessao(sessaoId) {
  if (!confirm('Deseja realmente cancelar esta sessão de estacionamento?')) return;

  try {
    const res = await fetch(`/api/sessoes/${sessaoId}/cancelar`, { method: 'POST' });
    const dados = await res.json();
    if (dados.sucesso) {
      mostrarToast(dados.mensagem, 'success');
      carregarSessoesAtivas();
    }
  } catch (e) {
    mostrarToast('Erro ao cancelar sessão.', 'danger');
  }
}

// ====================================================================
// RENDERIZAÇÃO: HISTÓRICO GERAL (ADMIN)
// ====================================================================
function renderizarTabelaHistorico(lista) {
  const tbody = document.getElementById('tabela-historico-body');
  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhuma saída registrada até o momento.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(s => {
    const cupomId = 'REC-' + s.id.replace('SES-', '');
    const dataEntrada = new Date(s.entrada).toLocaleString('pt-BR');
    const dataSaida = s.saida ? new Date(s.saida).toLocaleString('pt-BR') : '-';
    const valor = formatarMoeda(s.valorCobrado || 0);

    return `
      <tr>
        <td><strong>${cupomId}</strong></td>
        <td><span class="car-badge" style="font-size: 0.8rem; padding: 0.15rem 0.45rem;">${s.veiculo.placa}</span></td>
        <td>${s.veiculo.nome}</td>
        <td>${dataEntrada}</td>
        <td>${dataSaida}</td>
        <td>${s.tempoFormatado || '-'}</td>
        <td style="font-weight: 700; color: var(--success);">${valor}</td>
        <td><span class="badge" style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase;">${s.formaPagamento || '-'}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-sm" onclick="reimprimirRecibo('${s.id}')">
            <i class="fa-solid fa-receipt"></i> Recibo
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function reimprimirRecibo(sessaoId) {
  let s = Estado.historico.find(h => h.id === sessaoId);
  if (!s && Estado.dadosClientePortal && Estado.dadosClientePortal.historico) {
    s = Estado.dadosClientePortal.historico.find(h => h.id === sessaoId);
  }
  if (!s) return;

  const comprovante = {
    numeroCupom: 'REC-' + s.id.replace('SES-', ''),
    sessaoId: s.id,
    rfid: s.rfid,
    titular: s.veiculo.nome,
    cpf: s.veiculo.cpf,
    placa: s.veiculo.placa,
    contato: s.veiculo.contato,
    dataEntrada: new Date(s.entrada).toLocaleString('pt-BR'),
    dataSaida: new Date(s.saida).toLocaleString('pt-BR'),
    duracaoFormatada: s.tempoFormatado,
    valorTotal: s.valorCobrado,
    formaPagamento: (s.formaPagamento || 'DINHEIRO').toUpperCase(),
    troco: s.troco || 0,
    detalhesCalculo: s.historicoCalculo || 'Cobrança padrão',
    emitidoEm: new Date().toLocaleString('pt-BR')
  };

  abrirModalRecibo(comprovante);
}

// ====================================================================
// SIMULADOR DE RFID
// ====================================================================
function configurarSimulador() {
  const btnAbrir = document.getElementById('btn-abrir-simulador');
  btnAbrir?.addEventListener('click', () => {
    abrirModal('modal-simulador');
  });

  const btnExec = document.getElementById('btn-executar-simulacao');
  btnExec?.addEventListener('click', () => {
    const input = document.getElementById('sim-rfid-input');
    const rfid = input.value.trim().toUpperCase();
    if (!rfid) {
      alert('Digite um código RFID para simular.');
      return;
    }
    fecharModal('modal-simulador');
    processarLeituraRFID(rfid);
  });
}

function renderizarTagsSimulador(veiculos) {
  const container = document.getElementById('sim-tags-rapidas');
  if (!container) return;

  if (veiculos.length === 0) {
    container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">Nenhum veículo cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = veiculos.map(v => `
    <button class="btn btn-outline btn-sm" style="display: flex; justify-content: space-between; text-align: left; padding: 0.6rem 0.8rem;" onclick="simularTagRapida('${v.rfid}')">
      <span><strong>${v.placa}</strong> - ${v.nome}</span>
      <span class="rfid-tag-badge">${v.rfid}</span>
    </button>
  `).join('');
}

function simularTagRapida(rfid) {
  fecharModal('modal-simulador');
  processarLeituraRFID(rfid);
}

// ====================================================================
// CÁLCULOS, TEMPO E FORMATAÇÃO
// ====================================================================
function calcularValorTempoReal(entradaMs, saidaMs) {
  const diffMs = Math.max(0, saidaMs - entradaMs);
  const totalMinutos = Math.max(1, Math.ceil(diffMs / 60000));

  const t = Estado.tabelaPrecos || {};
  const tolerancia = Number(t.toleranciaMinutos) || 10;
  const primeiraHora = Number(t.primeiraHora) || 5.0;
  const horaAdicional = Number(t.horaAdicional) || 5.0;
  const fracao15min = Number(t.fracao15min) || 2.0;
  const valorDiaria = Number(t.valorDiaria) || 50.0;
  const limiteDiariaMin = (Number(t.limiteHorasDiaria) || 8) * 60;

  if (totalMinutos <= tolerancia) {
    return {
      valorTotal: 0.00,
      detalhes: `Dentro da tolerância gratuita (${tolerancia} min)`
    };
  }

  if (totalMinutos >= limiteDiariaMin) {
    return {
      valorTotal: valorDiaria,
      detalhes: `Tarifa Diária máxima aplicada (acima de ${t.limiteHorasDiaria}h)`
    };
  }

  let valor = primeiraHora;
  let detalhes = `1ª Hora: R$ ${primeiraHora.toFixed(2)}`;

  if (totalMinutos > 60) {
    const excedente = totalMinutos - 60;
    if (t.modoCobranca === 'hora_fracao') {
      const qtdFracoes = Math.ceil(excedente / 15);
      const valorFracoes = qtdFracoes * fracao15min;
      valor += valorFracoes;
      detalhes += ` + ${qtdFracoes} fração(ões) 15m (R$ ${valorFracoes.toFixed(2)})`;
    } else {
      const horasExcedentes = Math.ceil(excedente / 60);
      const valorHoras = horasExcedentes * horaAdicional;
      valor += valorHoras;
      detalhes += ` + ${horasExcedentes}h adic. (R$ ${valorHoras.toFixed(2)})`;
    }
  }

  if (valor > valorDiaria) {
    valor = valorDiaria;
    detalhes += ` (teto da diária: R$ ${valorDiaria.toFixed(2)})`;
  }

  return {
    valorTotal: valor,
    detalhes
  };
}

function formatarTempoHMS(ms) {
  const totalSeg = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeg / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSeg % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeg % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function abrirModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function fecharModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

document.querySelectorAll('.modal-overlay').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

function mostrarToast(mensagem, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;

  let icone = 'fa-circle-info';
  if (tipo === 'success') icone = 'fa-circle-check';
  if (tipo === 'danger') icone = 'fa-triangle-exclamation';
  if (tipo === 'warning') icone = 'fa-bell';

  toast.innerHTML = `<i class="fa-solid ${icone}"></i> <div>${mensagem}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function aplicarMascarasInputs() {
  const inputPlaca = document.getElementById('cad-placa');
  inputPlaca?.addEventListener('input', (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length > 7) v = v.slice(0, 7);
    e.target.value = v;

    const loginInput = document.getElementById('cad-login');
    if (loginInput && !loginInput.value) {
      loginInput.placeholder = `Padrão: ${v}`;
    }
  });

  const inputCpf = document.getElementById('cad-cpf');
  inputCpf?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    if (v.length > 9) {
      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    } else if (v.length > 6) {
      v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    } else if (v.length > 3) {
      v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    }
    e.target.value = v;
  });

  const inputContato = document.getElementById('cad-contato');
  inputContato?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    if (v.length > 10) {
      v = v.replace(/^(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (v.length > 6) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})/, '($1) ');
    }
    e.target.value = v;
  });
}
