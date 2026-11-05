/**
 * SmartPark RFID - Sistema de Estacionamento Inteligente
 * Projeto PEX 2° Período
 *
 * Suporte a:
 * - Login unificado com detecção automática de cargo (Admin vs Cliente/Veículo)
 * - Tela exclusiva de Gestão de Cargos (Admin)
 * - Cronômetros ao vivo em tempo real (Pátio e Portal do Cliente)
 * - Cobrança estritamente via PIX (QR Code e Copia-e-Cola dinâmico)
 * - Liberação de ticket e cancela apenas após o pagamento
 * - Tabela de preços com 5 opções (Isenção, 30 min, 1h, hora adicional, diária)
 * - Integração com Arduino via Web Serial API
 */

// Estado Global da Aplicação
const Estado = {
  usuario: null, // { role: 'admin' | 'cliente', nome, veiculo, token }
  veiculos: [],
  sessoesAtivas: [],
  historico: [],
  usuariosCargos: [],
  tabelaPrecos: {
    isencaoMinutos: 15,
    valor30min: 5.0,
    valor1Hora: 10.0,
    valorHoraAdicional: 5.0,
    valorDiaria: 40.0,
    limiteHorasDiaria: 8
  },
  ultimoRfidLido: '',
  sessaoSelecionadaId: null,
  pixAdminAtual: null,
  pixClienteAtual: null,
  metodoPagamento: 'pix',
  dadosClientePortal: null,
  intervaloCronometro: null
};

// ====================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  configurarAutenticacao();
  configurarNavegacaoAbas();
  configurarGestaoCargos();
  configurarEventosForms();
  configurarEventosPagamento();
  configurarEventosPortalCliente();
  configurarEventosExportacao();
  configurarSimulador();
  configurarSSE();
  configurarOuvinteSerialRFID();

  // Define SEMPRE a tela de login como tela padrão ao inicializar
  exibirTelaLoginPadrao();

  // Inicia loop de atualização de cronômetros em tempo real
  iniciarLoopCronometro();
});

// ====================================================================
// AUTENTICAÇÃO UNIFICADA (LOGIN ÚNICO)
// ====================================================================
function configurarAutenticacao() {
  const formLogin = document.getElementById('form-login');
  const inputLogin = document.getElementById('input-login');
  const inputSenha = document.getElementById('input-senha');

  // Submissão do Formulário de Login Único
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

      // Login bem-sucedido: o backend já retorna o role ('admin' ou 'cliente')
      Estado.usuario = dados.usuario;
      mostrarToast(`Bem-vindo, ${dados.usuario.nome || 'Usuário'}!`, 'success');

      aplicarVisualPorCargo(dados.usuario);
    } catch (err) {
      console.error('Erro no login:', err);
      const btnSubmit = document.getElementById('btn-submit-login');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Acessar Sistema';
      }
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

function exibirTelaLoginPadrao() {
  // Limpa qualquer vestígio de sessão anterior
  localStorage.removeItem('smartpark_user');
  sessionStorage.removeItem('smartpark_user');
  Estado.usuario = null;

  // Garante que a tela de login esteja sempre visível e o app oculto
  const telaLogin = document.getElementById('tela-login');
  const telaPrincipal = document.getElementById('tela-principal-app');
  if (telaLogin) telaLogin.style.display = 'flex';
  if (telaPrincipal) telaPrincipal.style.display = 'none';

  // Limpa campos de credenciais
  const inputLogin = document.getElementById('input-login');
  const inputSenha = document.getElementById('input-senha');
  if (inputLogin) inputLogin.value = '';
  if (inputSenha) inputSenha.value = '';
}

function aplicarVisualPorCargo(usuario) {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('tela-principal-app').style.display = 'block';

  const avatarEl = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const navSubtitle = document.getElementById('nav-subtitle');

  if (usuario.role === 'admin') {
    // VISÃO DE ADMINISTRADOR (Acesso total às abas de guarita, cargos, preços, etc)
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
    carregarGestaoCargos();
    mudarAba('tab-patio');
  } else {
    // VISÃO DE CLIENTE / PROPRIETÁRIO DO VEÍCULO (Acesso exclusivo ao seu veículo)
    avatarEl.innerHTML = '<i class="fa-solid fa-car"></i>';
    nameEl.innerText = (usuario.veiculo && usuario.veiculo.nome) || usuario.nome || 'Cliente';
    roleEl.innerText = usuario.veiculo ? `VEÍCULO ${usuario.veiculo.placa}` : 'CLIENTE';
    navSubtitle.innerText = 'Portal do Motorista';

    document.getElementById('admin-nav-tabs').style.display = 'none';
    document.getElementById('portal-admin').style.display = 'none';
    document.getElementById('portal-cliente').style.display = 'block';

    carregarTabelaPrecos();
    if (usuario.veiculo && usuario.veiculo.rfid) {
      carregarDadosPortalCliente(usuario.veiculo.rfid);
    }
  }
}

function fazerLogout() {
  exibirTelaLoginPadrao();
  mostrarToast('Você saiu do sistema.', 'info');
}

// ====================================================================
// GESTÃO DE CARGOS (EXCLUSIVA ADMINISTRADORES)
// ====================================================================
function configurarGestaoCargos() {
  document.getElementById('btn-atualizar-cargos')?.addEventListener('click', carregarGestaoCargos);
}

async function carregarGestaoCargos() {
  try {
    const res = await fetch('/api/cargos/usuarios');
    const dados = await res.json();
    if (dados.sucesso) {
      Estado.usuariosCargos = dados.usuarios;
      renderizarTabelaCargos(dados.usuarios);
    }
  } catch (err) {
    console.warn('Erro ao carregar lista de cargos:', err);
  }
}

function renderizarTabelaCargos(usuarios) {
  const tbody = document.getElementById('tabela-cargos-body');
  if (!tbody) return;

  if (usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = usuarios.map((u, idx) => {
    const isAdmin = u.cargo === 'admin';
    const isMaster = Boolean(u.isMaster || u.id === 'ADMIN-MASTER' || u.tipo === 'admin_master');
    const safeId = (u.id || 'usr_' + idx).replace(/[^a-zA-Z0-9_-]/g, '_');

    let badgeCargo = isAdmin
      ? `<span class="badge" style="background: #dbeafe; color: #1e40af; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 6px;"><i class="fa-solid fa-user-shield"></i> Administrador</span>`
      : `<span class="badge" style="background: #dcfce7; color: #15803d; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 6px;"><i class="fa-solid fa-car"></i> Cliente</span>`;

    const selectId = `cargo-sel-${safeId}`;
    const btnId = `btn-salvar-cargo-${safeId}`;

    const seletorHtml = `
      <select id="${selectId}" class="form-control form-control-sm" style="font-weight: 600; max-width: 170px;" onchange="alterarCargoUsuario('${u.id}', this.value, '${btnId}')">
        <option value="cliente" ${u.cargo === 'cliente' ? 'selected' : ''}>Cliente</option>
        <option value="admin" ${u.cargo === 'admin' ? 'selected' : ''}>Administrador</option>
      </select>
    `;

    const acaoHtml = `
      <button type="button" id="${btnId}" class="btn btn-primary btn-sm" onclick="salvarCargoLinha('${u.id}', '${selectId}', '${btnId}')">
        <i class="fa-solid fa-floppy-disk"></i> Salvar
      </button>
    `;

    return `
      <tr>
        <td>
          <strong>${u.nome}</strong>
          ${isMaster ? '<span class="badge" style="background: #eff6ff; color: #2563eb; font-size: 0.72rem; margin-left: 6px; font-weight: 700;"><i class="fa-solid fa-crown"></i> Master</span>' : ''}
        </td>
        <td><code>${u.login || u.placa || '-'}</code></td>
        <td>${badgeCargo}</td>
        <td>${seletorHtml}</td>
        <td style="text-align: right;">${acaoHtml}</td>
      </tr>
    `;
  }).join('');
}

async function salvarCargoLinha(id, selectId, btnId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  await alterarCargoUsuario(id, sel.value, btnId);
}

async function alterarCargoUsuario(id, novoCargo, btnId = null) {
  const btn = btnId ? document.getElementById(btnId) : null;
  const textoOriginal = btn ? btn.innerHTML : null;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    const res = await fetch(`/api/cargos/usuarios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cargo: novoCargo })
    });
    const dados = await res.json();

    if (dados.sucesso) {
      mostrarToast(`✅ ${dados.mensagem || 'Cargo atualizado com sucesso!'}`, 'success');
      carregarGestaoCargos();
      carregarVeiculos();
    } else {
      mostrarToast(dados.mensagem || 'Erro ao alterar cargo.', 'danger');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
      }
      carregarGestaoCargos();
    }
  } catch (err) {
    console.error('Erro ao alterar cargo:', err);
    mostrarToast('Erro ao comunicar com o servidor.', 'danger');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
    carregarGestaoCargos();
  }
}

// ====================================================================
// PORTAL DO CLIENTE (ACOMPANHAMENTO DO TEMPO E PAGAMENTO PIX)
// ====================================================================
function configurarEventosPortalCliente() {
  // Botão Pagar via PIX pelo Portal do Cliente
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

      // Gera e renderiza o PIX dinâmico para o cliente
      solicitarPixDinamico(dados.sessaoAtiva.id, 'cliente');
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
    btnPagar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirmando Pagamento PIX...';

    const payload = {
      sessaoId: sessao.id,
      formaPagamento: 'pix',
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
    btnPagar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagar via PIX e Liberar Ticket';

    if (!resposta.sucesso) {
      mostrarToast(resposta.mensagem, 'danger');
      return;
    }

    // Abre a cancela de saída no Arduino!
    arduinoSerial.enviarComando('OPEN');

    mostrarToast('✅ Pagamento PIX confirmado com sucesso! Ticket liberado e cancela aberta.', 'success');

    // Abre modal com o comprovante/ticket liberado
    abrirModalRecibo(resposta.comprovante);

    // Recarrega o portal do cliente
    carregarDadosPortalCliente(portal.veiculo.rfid);
  } catch (err) {
    console.error('Erro ao pagar pelo portal:', err);
    btnPagar.disabled = false;
    btnPagar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagar via PIX e Liberar Ticket';
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
      <td><span class="badge" style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase;">${s.formaPagamento || 'PIX'}</span></td>
      <td style="text-align: right;">
        <button class="btn btn-outline btn-sm" onclick="reimprimirRecibo('${s.id}')">
          <i class="fa-solid fa-receipt"></i> Ticket / Recibo
        </button>
      </td>
    </tr>
  `).join('');
}

// ====================================================================
// SERVIÇO PIX: GERAÇÃO E CÓPIA
// ====================================================================
async function solicitarPixDinamico(sessaoId, tipo = 'admin') {
  try {
    const res = await fetch('/api/pagamento/pix/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessaoId })
    });
    const dados = await res.json();

    if (!dados.sucesso) return;

    const pixData = dados.pix || dados.cobrancaPix;
    if (!pixData) return;

    if (tipo === 'admin') {
      Estado.pixAdminAtual = pixData.copiaECola;
      const containerSvg = document.getElementById('admin-qrcode-container');
      if (containerSvg && pixData.qrCodeSvg) {
        containerSvg.innerHTML = pixData.qrCodeSvg;
      }
      const txtChave = document.getElementById('admin-chave-pix-texto');
      if (txtChave) txtChave.innerText = pixData.chavePix || pixData.chave || 'pex-estacionamento-2026@arduino.org';
    } else {
      Estado.pixClienteAtual = pixData.copiaECola;
      const containerSvg = document.getElementById('cli-qrcode-container');
      if (containerSvg && pixData.qrCodeSvg) {
        containerSvg.innerHTML = pixData.qrCodeSvg;
      }
      const txtChave = document.getElementById('cli-chave-pix-texto');
      if (txtChave) txtChave.innerText = pixData.chavePix || pixData.chave || 'pex-estacionamento-2026@arduino.org';
    }
  } catch (err) {
    console.warn('Erro ao solicitar PIX dinâmico:', err);
  }
}

function copiarChavePix() {
  const chave = Estado.pixAdminAtual || Estado.pixClienteAtual || 'pex-estacionamento-2026@arduino.org';
  navigator.clipboard.writeText(chave).then(() => {
    mostrarToast('Código Pix Copia-e-Cola copiado para a área de transferência!', 'success');
  }).catch(() => {
    mostrarToast('Chave PIX: ' + chave, 'info');
  });
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
      } else if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.usuario.veiculo && Estado.usuario.veiculo.rfid === dados.veiculo.rfid) {
        carregarDadosPortalCliente(dados.veiculo.rfid);
      }
    });

    evtSource.addEventListener('pagamento_concluido', (e) => {
      const dados = JSON.parse(e.data);

      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarSessoesAtivas();
        carregarHistorico();
        carregarStatusDashboard();
      } else if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.usuario.veiculo && Estado.usuario.veiculo.rfid === dados.sessao.rfid) {
        carregarDadosPortalCliente(dados.sessao.rfid);
      }
    });

    evtSource.addEventListener('veiculo_cadastrado', () => {
      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarVeiculos();
        carregarGestaoCargos();
        carregarStatusDashboard();
      }
    });

    evtSource.addEventListener('cargos_atualizados', () => {
      if (Estado.usuario && Estado.usuario.role === 'admin') {
        carregarGestaoCargos();
        carregarVeiculos();
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
      if (targetId === 'tab-cargos') carregarGestaoCargos();
      if (targetId === 'tab-tabela') carregarTabelaPrecos();
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

  const isencao = t.isencaoMinutos ?? 15;
  const v30 = Number(t.valor30min ?? 5).toFixed(2);
  const v1h = Number(t.valor1Hora ?? 10).toFixed(2);
  const vAdic = Number(t.valorHoraAdicional ?? 5).toFixed(2);
  const vDiaria = Number(t.valorDiaria ?? 40).toFixed(2);
  const limDiaria = t.limiteHorasDiaria ?? 8;

  setVal('tab-isencao', isencao);
  setVal('tab-30min', v30);
  setVal('tab-1hora', v1h);
  setVal('tab-hora-adicional', vAdic);
  setVal('tab-valor-diaria', vDiaria);
  setVal('tab-limite-diaria', limDiaria);

  setText('prev-isencao', isencao);
  setText('prev-30min', v30);
  setText('prev-1hora', v1h);
  setText('prev-hora-adic', vAdic);
  setText('prev-limite-diaria', limDiaria);
  setText('prev-diaria', vDiaria);
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
              <div class="timer-label">Valor PIX Parcial</div>
              <div class="timer-cost card-valor">${formatarMoeda(calc.valorTotal)}</div>
            </div>
          </div>

          <div class="card-footer-actions">
            <button class="btn btn-success btn-sm" style="flex: 1;" onclick="irParaPagamentoComSessao('${s.id}')">
              <i class="fa-solid fa-cash-register"></i> Cobrança PIX
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
      }
    }

    // 3. Atualiza o Portal do Cliente (se o cliente estiver logado e seu carro estiver no pátio)
    if (Estado.usuario && Estado.usuario.role === 'cliente' && Estado.dadosClientePortal && Estado.dadosClientePortal.estacionado && Estado.dadosClientePortal.sessaoAtiva) {
      atualizarValoresTempoCliente(Estado.dadosClientePortal.sessaoAtiva.entrada);
    }
  }, 1000);
}

// ====================================================================
// TELA DE PAGAMENTO (GUARITA / ADMIN - EXCLUSIVO PIX)
// ====================================================================
function configurarEventosPagamento() {
  const selectSessao = document.getElementById('select-sessao-pagamento');
  selectSessao?.addEventListener('change', (e) => {
    selecionarSessaoParaPagamento(e.target.value);
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

  // Solicita QR Code PIX dinâmico
  solicitarPixDinamico(sessao.id, 'admin');

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
}

async function finalizarPagamentoGuarita() {
  if (!Estado.sessaoSelecionadaId) {
    mostrarToast('Selecione um veículo para finalizar.', 'warning');
    return;
  }

  const sessao = Estado.sessoesAtivas.find(s => s.id === Estado.sessaoSelecionadaId);
  if (!sessao) return;

  const desconto = parseFloat(document.getElementById('input-desconto')?.value) || 0;
  const acrescimo = parseFloat(document.getElementById('input-acrescimo')?.value) || 0;

  try {
    const btnFinalizar = document.getElementById('btn-finalizar-pagamento');
    btnFinalizar.disabled = true;
    btnFinalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirmando PIX...';

    const payload = {
      sessaoId: sessao.id,
      formaPagamento: 'pix',
      valorRecebido: null,
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
      btnFinalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Confirmar Recebimento PIX e Liberar Ticket';
      return;
    }

    // Abre cancela de saída no Arduino
    arduinoSerial.enviarComando('OPEN');

    mostrarToast('✅ Pagamento PIX confirmado com sucesso! Ticket liberado e cancela aberta.', 'success');

    // Abre modal com o comprovante liberado
    abrirModalRecibo(resposta.comprovante);

    Estado.sessaoSelecionadaId = null;
    selecionarSessaoParaPagamento(null);
    document.getElementById('input-desconto').value = '0.00';
    document.getElementById('input-acrescimo').value = '0.00';

    carregarSessoesAtivas();
    carregarHistorico();
    carregarStatusDashboard();

    btnFinalizar.disabled = true;
    btnFinalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Confirmar Recebimento PIX e Liberar Ticket';
  } catch (err) {
    console.error('Erro ao finalizar pagamento:', err);
    mostrarToast('Erro ao processar pagamento.', 'danger');
  }
}

// ====================================================================
// MODAL: RECIBO / COMPROVANTE (DESBLOQUEADO APENAS APÓS PAGAMENTO)
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
  document.getElementById('recibo-forma').innerText = comprovante.formaPagamento || 'PIX';

  const linhaTroco = document.getElementById('recibo-troco-linha');
  if (linhaTroco) linhaTroco.style.display = 'none';

  abrirModal('modal-recibo');
}

// ====================================================================
// FORMULÁRIO DE CADASTRO DE VEÍCULOS (COM SELETOR DE CARGO)
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
    const cargo = document.getElementById('cad-cargo')?.value || 'cliente';
    const login = document.getElementById('cad-login').value.trim().toUpperCase() || placa;
    const senha = document.getElementById('cad-senha').value.trim() || '123';

    try {
      const res = await fetch('/api/veiculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid, nome, placa, contato, cpf, cargo, login, senha })
      });
      const dados = await res.json();

      if (!dados.sucesso) {
        mostrarToast(dados.mensagem, 'danger');
        return;
      }

      mostrarToast(`Veículo cadastrado com sucesso como ${cargo.toUpperCase()}!`, 'success');
      formVeiculo.reset();
      document.getElementById('cad-senha').value = '123';
      document.getElementById('cad-cargo').value = 'cliente';
      carregarVeiculos();
      carregarGestaoCargos();
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
    document.getElementById('cad-cargo').value = 'cliente';
  });

  document.getElementById('busca-veiculo')?.addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    const filtrados = Estado.veiculos.filter(v =>
      v.nome.toLowerCase().includes(termo) ||
      v.placa.toLowerCase().includes(termo) ||
      v.cpf.toLowerCase().includes(termo) ||
      v.rfid.toLowerCase().includes(termo) ||
      (v.cargo && v.cargo.toLowerCase().includes(termo)) ||
      (v.login && v.login.toLowerCase().includes(termo))
    );
    renderizarTabelaVeiculos(filtrados);
  });

  // Salvar Tabela de Preços (5 opções oficiais)
  const formTabela = document.getElementById('form-tabela-precos');
  formTabela?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      isencaoMinutos: document.getElementById('tab-isencao').value,
      valor30min: document.getElementById('tab-30min').value,
      valor1Hora: document.getElementById('tab-1hora').value,
      valorHoraAdicional: document.getElementById('tab-hora-adicional').value,
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
        mostrarToast('Tabela de preços com as 5 opções atualizada com sucesso!', 'success');
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

  tbody.innerHTML = lista.map(v => {
    const isAdmin = v.cargo === 'admin';
    const badgeCargo = isAdmin
      ? `<span class="badge" style="background: #dbeafe; color: #1e40af; font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px;">Admin</span>`
      : `<span class="badge" style="background: #dcfce7; color: #15803d; font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px;">Cliente</span>`;

    return `
      <tr>
        <td><span class="rfid-tag-badge">${v.rfid}</span></td>
        <td><span class="car-badge" style="font-size: 0.85rem; padding: 0.2rem 0.5rem;">${v.placa}</span></td>
        <td><strong>${v.nome}</strong></td>
        <td>${badgeCargo}</td>
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
    `;
  }).join('');
}

async function excluirVeiculo(rfid) {
  if (!confirm(`Deseja realmente remover o veículo com a tag RFID ${rfid}?`)) return;

  try {
    const res = await fetch(`/api/veiculos/${rfid}`, { method: 'DELETE' });
    const dados = await res.json();
    if (dados.sucesso) {
      mostrarToast(dados.mensagem, 'success');
      carregarVeiculos();
      carregarGestaoCargos();
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
        <td><span class="badge" style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase;">${s.formaPagamento || 'PIX'}</span></td>
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
    formaPagamento: (s.formaPagamento || 'PIX').toUpperCase(),
    detalhesCalculo: s.historicoCalculo || 'Cobrança padrão',
    emitidoEm: new Date().toLocaleString('pt-BR')
  };

  abrirModalRecibo(comprovante);
}

// ====================================================================
// EXPORTAÇÃO PARA EXCEL (CSV FORMATADO COM UTF-8 BOM E DELIMITADOR ';')
// ====================================================================
function configurarEventosExportacao() {
  // 1. Exportar Histórico de Tickets
  document.getElementById('btn-exportar-historico-excel')?.addEventListener('click', () => {
    exportarHistoricoTicketsExcel();
  });

  // 2. Exportar Gestão de Cargos
  document.getElementById('btn-exportar-cargos-excel')?.addEventListener('click', () => {
    exportarCargosExcel();
  });

  // 3. Exportar Cadastros de Veículos
  document.getElementById('btn-exportar-veiculos-excel')?.addEventListener('click', () => {
    exportarCadastrosVeiculosExcel();
  });
}

function exportarTabelaParaExcel({ nomeArquivo, cabecalhos, linhas }) {
  if (!linhas || linhas.length === 0) {
    mostrarToast('Nenhum registro encontrado para exportar.', 'warning');
    return;
  }

  const separador = ';';
  // \uFEFF é o Byte Order Mark (BOM) para o Microsoft Excel interpretar como UTF-8
  let csv = '\uFEFF';

  // Cabeçalhos
  csv += cabecalhos.map(c => `"${String(c).replace(/"/g, '""')}"`).join(separador) + '\r\n';

  // Linhas
  linhas.forEach(linha => {
    const linhaFormatada = linha.map(col => {
      let val = col !== null && col !== undefined ? String(col) : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(separador);
    csv += linhaFormatada + '\r\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dataHoje = new Date().toISOString().slice(0, 10);
  link.setAttribute('href', url);
  link.setAttribute('download', `${nomeArquivo}_${dataHoje}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  mostrarToast(`Planilha ${nomeArquivo}.csv exportada com sucesso!`, 'success');
}

async function exportarHistoricoTicketsExcel() {
  let lista = Estado.historico || [];
  if (lista.length === 0) {
    try {
      const res = await fetch('/api/sessoes/historico');
      const dados = await res.json();
      if (dados.sucesso && dados.historico) {
        lista = dados.historico;
        Estado.historico = dados.historico;
      }
    } catch (e) {
      console.warn('Erro ao carregar histórico para exportar:', e);
    }
  }

  if (lista.length === 0) {
    mostrarToast('O histórico de tickets está vazio no momento.', 'warning');
    return;
  }

  const cabecalhos = [
    'Número do Cupom / Ticket',
    'Placa do Veículo',
    'Nome do Titular',
    'CPF do Titular',
    'Telefone / Contato',
    'Código RFID',
    'Data e Hora de Entrada',
    'Data e Hora de Saída',
    'Tempo de Permanência',
    'Valor Cobrado (R$)',
    'Forma de Pagamento',
    'Status do Pagamento',
    'Histórico de Cálculo'
  ];

  const linhas = lista.map(s => {
    const cupomId = 'REC-' + s.id.replace('SES-', '');
    const dataEntrada = s.entrada ? new Date(s.entrada).toLocaleString('pt-BR') : '-';
    const dataSaida = s.saida ? new Date(s.saida).toLocaleString('pt-BR') : '-';
    const valorCobrado = Number(s.valorCobrado || 0).toFixed(2).replace('.', ',');

    return [
      cupomId,
      s.veiculo?.placa || '-',
      s.veiculo?.nome || '-',
      s.veiculo?.cpf || '-',
      s.veiculo?.contato || '-',
      s.rfid || '-',
      dataEntrada,
      dataSaida,
      s.tempoFormatado || '-',
      `R$ ${valorCobrado}`,
      (s.formaPagamento || 'PIX').toUpperCase(),
      s.status || 'PAGO',
      s.historicoCalculo || 'Cobrança padrão'
    ];
  });

  exportarTabelaParaExcel({
    nomeArquivo: 'historico_tickets_estacionamento',
    cabecalhos,
    linhas
  });
}

async function exportarCargosExcel() {
  let lista = Estado.usuariosCargos || [];
  if (lista.length === 0) {
    try {
      const res = await fetch('/api/cargos/usuarios');
      const dados = await res.json();
      if (dados.sucesso && dados.usuarios) {
        lista = dados.usuarios;
        Estado.usuariosCargos = dados.usuarios;
      }
    } catch (e) {
      console.warn('Erro ao carregar lista de cargos para exportar:', e);
    }
  }

  if (lista.length === 0) {
    mostrarToast('Nenhum usuário cadastrado para exportação.', 'warning');
    return;
  }

  const cabecalhos = [
    'Nome Completo',
    'Identificador / Login',
    'Placa do Veículo',
    'CPF do Usuário',
    'Código RFID',
    'Tipo de Conta',
    'Cargo Definido',
    'Nível de Acesso'
  ];

  const linhas = lista.map(u => {
    const isMaster = Boolean(u.isMaster || u.id === 'ADMIN-MASTER' || u.tipo === 'admin_master');
    const cargoNome = u.cargo === 'admin' ? 'Administrador' : 'Cliente';
    const nivelAcesso = u.cargo === 'admin'
      ? 'Acesso Geral (Guarita, Pátio, Preços e Cargos)'
      : 'Acesso Restrito (Portal do seu próprio veículo e pagamento PIX)';

    return [
      u.nome || '-',
      u.login || u.placa || '-',
      u.placa || '-',
      u.cpf || '-',
      u.rfid || '-',
      isMaster ? 'Admin Master' : 'Veículo / Motorista',
      cargoNome,
      nivelAcesso
    ];
  });

  exportarTabelaParaExcel({
    nomeArquivo: 'relatorio_gestao_cargos',
    cabecalhos,
    linhas
  });
}

async function exportarCadastrosVeiculosExcel() {
  let lista = Estado.veiculos || [];
  if (lista.length === 0) {
    try {
      const res = await fetch('/api/veiculos');
      const dados = await res.json();
      if (dados.sucesso && dados.veiculos) {
        lista = dados.veiculos;
        Estado.veiculos = dados.veiculos;
      }
    } catch (e) {
      console.warn('Erro ao carregar veículos para exportar:', e);
    }
  }

  if (lista.length === 0) {
    mostrarToast('Nenhum veículo cadastrado para exportação.', 'warning');
    return;
  }

  const cabecalhos = [
    'Código RFID',
    'Placa do Carro',
    'Nome do Titular',
    'CPF do Titular',
    'Telefone / Contato',
    'Cargo de Acesso',
    'Login de Usuário',
    'Data de Cadastro'
  ];

  const linhas = lista.map(v => [
    v.rfid || '-',
    v.placa || '-',
    v.nome || '-',
    v.cpf || '-',
    v.contato || '-',
    v.cargo === 'admin' ? 'Administrador' : 'Cliente',
    v.login || v.placa,
    v.criadoEm ? new Date(v.criadoEm).toLocaleString('pt-BR') : '-'
  ]);

  exportarTabelaParaExcel({
    nomeArquivo: 'cadastros_veiculos_rfid',
    cabecalhos,
    linhas
  });
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
// CÁLCULO DAS 5 OPÇÕES OFICIAIS, TEMPO E FORMATAÇÃO
// ====================================================================
function calcularValorTempoReal(entradaMs, saidaMs) {
  const diffMs = Math.max(0, saidaMs - entradaMs);
  const totalMinutos = Math.max(1, Math.ceil(diffMs / 60000));

  const t = Estado.tabelaPrecos || {};
  const isencaoMinutos = Number(t.isencaoMinutos ?? 15);
  const valor30min = Number(t.valor30min ?? 5.0);
  const valor1Hora = Number(t.valor1Hora ?? 10.0);
  const valorHoraAdicional = Number(t.valorHoraAdicional ?? 5.0);
  const valorDiaria = Number(t.valorDiaria ?? 40.0);
  const limiteDiariaMin = (Number(t.limiteHorasDiaria ?? 8)) * 60;

  // 1. Isenção
  if (totalMinutos <= isencaoMinutos) {
    return {
      valorTotal: 0.00,
      detalhes: `Dentro do período de isenção gratuita (${isencaoMinutos} min)`
    };
  }

  // 5. Diária (limite de horas atingido)
  if (totalMinutos >= limiteDiariaMin) {
    return {
      valorTotal: valorDiaria,
      detalhes: `Tarifa Diária máxima aplicada (acima de ${t.limiteHorasDiaria || 8}h)`
    };
  }

  // 2. Até 30 minutos
  if (totalMinutos <= 30) {
    return {
      valorTotal: valor30min,
      detalhes: `Permanência de até 30 minutos (R$ ${valor30min.toFixed(2)})`
    };
  }

  // 3. Até 1 hora
  if (totalMinutos <= 60) {
    return {
      valorTotal: valor1Hora,
      detalhes: `Permanência de até 1 hora (R$ ${valor1Hora.toFixed(2)})`
    };
  }

  // 4. Hora adicional
  const excedenteMin = totalMinutos - 60;
  const horasExtras = Math.ceil(excedenteMin / 60);
  let valor = valor1Hora + (horasExtras * valorHoraAdicional);
  let detalhes = `1ª Hora (R$ ${valor1Hora.toFixed(2)}) + ${horasExtras}h adic. (R$ ${(horasExtras * valorHoraAdicional).toFixed(2)})`;

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
