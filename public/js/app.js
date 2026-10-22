/**
 * Sistema de Estacionamento Inteligente com RFID - SmartPark RFID
 * Projeto PEX 2° Período
 */

// Estado Global da Aplicação
const Estado = {
  veiculos: [],
  sessoesAtivas: [],
  historico: [],
  tabelaPrecos: {
    toleranciaMinutos: 15,
    primeiraHora: 10.0,
    horaAdicional: 5.0,
    fracao15min: 2.0,
    valorDiaria: 50.0,
    limiteHorasDiaria: 8,
    modoCobranca: 'hora_fracao'
  },
  ultimoRfidLido: '',
  sessaoSelecionadaId: null,
  metodoPagamento: 'pix',
  intervaloCronometro: null
};

// ====================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  configurarNavegacaoAbas();
  configurarEventosForms();
  configurarEventosPagamento();
  configurarSimulador();
  configurarSSE();
  configurarOuvinteSerialRFID();

  // Carrega dados iniciais
  carregarStatusDashboard();
  carregarTabelaPrecos();
  carregarVeiculos();
  carregarSessoesAtivas();
  carregarHistorico();

  // Inicia loop de atualização de cronômetro (a cada 1 segundo)
  iniciarLoopCronometro();
});

// ====================================================================
// NAVEGAÇÃO ENTRE ABAS
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

      // Atualizações sob demanda ao trocar de aba
      if (targetId === 'tab-patio') carregarSessoesAtivas();
      if (targetId === 'tab-pagamento') atualizarSelectSessaoPagamento();
      if (targetId === 'tab-veiculos') carregarVeiculos();
      if (targetId === 'tab-historico') carregarHistorico();
    });
  });

  // Atalho do Dashboard para novo veículo
  const btnNovoVeiculo = document.getElementById('btn-novo-veiculo-atalho');
  if (btnNovoVeiculo) {
    btnNovoVeiculo.addEventListener('click', () => {
      mudarAba('tab-veiculos');
      document.getElementById('cad-rfid').focus();
    });
  }

  // Botões de atualizar manuais
  document.getElementById('btn-atualizar-patio')?.addEventListener('click', carregarSessoesAtivas);
  document.getElementById('btn-atualizar-historico')?.addEventListener('click', carregarHistorico);
}

function mudarAba(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

// ====================================================================
// SERVER-SENT EVENTS (SSE) E SINCRONIZAÇÃO EM TEMPO REAL
// ====================================================================
function configurarSSE() {
  try {
    const evtSource = new EventSource('/api/eventos');

    evtSource.addEventListener('entrada_registrada', (e) => {
      const dados = JSON.parse(e.data);
      mostrarToast(`Entrada: ${dados.veiculo.placa} (${dados.veiculo.nome})!`, 'info');
      carregarSessoesAtivas();
      carregarStatusDashboard();
    });

    evtSource.addEventListener('pagamento_concluido', (e) => {
      const dados = JSON.parse(e.data);
      carregarSessoesAtivas();
      carregarHistorico();
      carregarStatusDashboard();
    });

    evtSource.addEventListener('veiculo_cadastrado', () => {
      carregarVeiculos();
      carregarStatusDashboard();
    });

    evtSource.addEventListener('tabela_atualizada', (e) => {
      Estado.tabelaPrecos = JSON.parse(e.data);
      atualizarCamposTabelaPrecos();
    });
  } catch (err) {
    console.warn('SSE indisponível, operando via polling local:', err);
  }
}

// ====================================================================
// PROCESSAMENTO DE LEITURA RFID (ARDUINO / USB / SIMULADOR)
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

  // Se o usuário estiver na tela de cadastro e o campo estiver vazio ou em foco
  const inputCadRfid = document.getElementById('cad-rfid');
  if (document.getElementById('tab-veiculos').classList.contains('active')) {
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
      // RFID NÃO CADASTRADO
      arduinoSerial.enviarComando('DENIED');
      mostrarToast(dados.mensagem, 'warning');

      if (confirm(`Tag RFID ${rfid} não cadastrada no sistema!\n\nDeseja cadastrar agora para associar ao titular e veículo?`)) {
        mudarAba('tab-veiculos');
        inputCadRfid.value = rfid;
        document.getElementById('cad-nome').focus();
      }
      return;
    }

    if (dados.acao === 'ENTRADA_REGISTRADA') {
      // ENTRADA LIBERADA COM SUCESSO!
      // Envia comando para abrir a cancela no Arduino
      arduinoSerial.enviarComando('OPEN');
      mostrarToast(`✅ Entrada autorizada: ${dados.veiculo.placa} - Temporizador iniciado!`, 'success');

      carregarSessoesAtivas();
      carregarStatusDashboard();
      mudarAba('tab-patio');
      return;
    }

    if (dados.acao === 'JA_ESTACIONADO') {
      // VEÍCULO JÁ ESTÁ NO ESTACIONAMENTO -> VAI PARA PAGAMENTO!
      mostrarToast(`Veículo ${dados.veiculo.placa} já no pátio! Abrindo tela de Pagamento...`, 'info');
      mudarAba('tab-pagamento');
      selecionarSessaoParaPagamento(dados.sessao.id);
      return;
    }
  } catch (err) {
    console.error('Erro ao processar RFID:', err);
    mostrarToast('Erro ao comunicar com o servidor.', 'danger');
  }
}

// ====================================================================
// CARREGAMENTO DE DADOS (API)
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
  document.getElementById('tab-tolerancia').value = t.toleranciaMinutos;
  document.getElementById('tab-primeira-hora').value = Number(t.primeiraHora).toFixed(2);
  document.getElementById('tab-modo-cobranca').value = t.modoCobranca || 'hora_fracao';
  document.getElementById('tab-fracao-15min').value = Number(t.fracao15min).toFixed(2);
  document.getElementById('tab-hora-adicional').value = Number(t.horaAdicional).toFixed(2);
  document.getElementById('tab-valor-diaria').value = Number(t.valorDiaria).toFixed(2);
  document.getElementById('tab-limite-diaria').value = t.limiteHorasDiaria;

  // Atualiza pré-visualização explicativa
  document.getElementById('prev-tolerancia').innerText = t.toleranciaMinutos;
  document.getElementById('prev-primeira-hora').innerText = Number(t.primeiraHora).toFixed(2);
  document.getElementById('prev-limite-diaria').innerText = t.limiteHorasDiaria;
  document.getElementById('prev-diaria').innerText = Number(t.valorDiaria).toFixed(2);
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
            <p><i class="fa-brands fa-whatsapp"></i> ${s.veiculo.contato}</p>
            <p><i class="fa-regular fa-clock"></i> Entrada: ${new Date(s.entrada).toLocaleTimeString()}</p>
          </div>
        </div>

        <div>
          <!-- Caixa do Temporizador Dinâmico -->
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

// Loop contínuo que atualiza os cronômetros e valores a cada segundo
function iniciarLoopCronometro() {
  if (Estado.intervaloCronometro) clearInterval(Estado.intervaloCronometro);

  Estado.intervaloCronometro = setInterval(() => {
    const agora = Date.now();

    // 1. Atualiza os cards no pátio
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

    // 2. Se a tela de Pagamento estiver com uma sessão ativa aberta, atualiza o cronômetro do pagamento
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
  }, 1000);
}

// ====================================================================
// FUNCIONALIDADE DO SITE: TELA DE PAGAMENTO
// ====================================================================
function configurarEventosPagamento() {
  const selectSessao = document.getElementById('select-sessao-pagamento');
  selectSessao?.addEventListener('change', (e) => {
    selecionarSessaoParaPagamento(e.target.value);
  });

  // Métodos de Pagamento (PIX, Cartão, Dinheiro)
  const methodOptions = document.querySelectorAll('.method-option');
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

  // Cálculo de troco ao digitar valor recebido
  const inputDinheiro = document.getElementById('input-dinheiro-recebido');
  inputDinheiro?.addEventListener('input', () => {
    const valorAtual = obterValorTotalAtual();
    atualizarCalculoTroco(valorAtual);
  });

  // Recalcula se o operador aplicar desconto ou acréscimo
  document.getElementById('input-desconto')?.addEventListener('input', () => {
    recalcularTelaPagamento();
  });
  document.getElementById('input-acrescimo')?.addEventListener('input', () => {
    recalcularTelaPagamento();
  });

  // BOTÃO PRINCIPAL: FINALIZAR TEMPORIZADOR E REALIZAR PAGAMENTO
  const btnFinalizar = document.getElementById('btn-finalizar-pagamento');
  btnFinalizar?.addEventListener('click', async () => {
    await finalizarPagamento();
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

  // Preenche dados do veículo
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

// Finalização da Sessão, Parada do Temporizador e Registro do Pagamento
async function finalizarPagamento() {
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
    btnFinalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando Pagamento...';

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

    // 1. Envia comando ao Arduino para abrir a cancela de saída!
    arduinoSerial.enviarComando('OPEN');

    // 2. Mostra mensagem de sucesso
    mostrarToast('✅ Pagamento registrado com sucesso! Cancela liberada.', 'success');

    // 3. Abre o comprovante de pagamento / recibo
    abrirModalRecibo(resposta.comprovante);

    // 4. Limpa a seleção e atualiza dados
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
// CADASTRO DE VEÍCULOS / ASSOCIAÇÃO RFID
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

    try {
      const res = await fetch('/api/veiculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid, nome, placa, contato, cpf })
      });
      const dados = await res.json();

      if (!dados.sucesso) {
        mostrarToast(dados.mensagem, 'danger');
        return;
      }

      mostrarToast('Veículo e RFID cadastrados com sucesso!', 'success');
      formVeiculo.reset();
      carregarVeiculos();
    } catch (err) {
      console.error('Erro ao cadastrar:', err);
      mostrarToast('Erro ao salvar veículo.', 'danger');
    }
  });

  // Botão capturar RFID lido
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
  });

  // Busca de veículos
  document.getElementById('busca-veiculo')?.addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    const filtrados = Estado.veiculos.filter(v =>
      v.nome.toLowerCase().includes(termo) ||
      v.placa.toLowerCase().includes(termo) ||
      v.cpf.toLowerCase().includes(termo) ||
      v.rfid.toLowerCase().includes(termo)
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

  // Máscaras de digitação simples para facilitar uso
  aplicarMascarasInputs();
}

function renderizarTabelaVeiculos(lista) {
  const tbody = document.getElementById('tabela-veiculos-body');
  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum veículo encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(v => `
    <tr>
      <td><span class="rfid-tag-badge">${v.rfid}</span></td>
      <td><span class="car-badge" style="font-size: 0.85rem; padding: 0.2rem 0.5rem;">${v.placa}</span></td>
      <td><strong>${v.nome}</strong></td>
      <td>${v.cpf}</td>
      <td>${v.contato}</td>
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
  if (!confirm(`Deseja realmente remover o veículo cadastrado sob a tag RFID ${rfid}?`)) return;

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
// RENDERIZAÇÃO: HISTÓRICO DE SAÍDAS
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
  const s = Estado.historico.find(h => h.id === sessaoId);
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
// SIMULADOR DE RFID (TESTES SEM HARDWARE)
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
// UTILITÁRIOS: CÁLCULOS E FORMATAÇÃO
// ====================================================================
function calcularValorTempoReal(entradaMs, saidaMs) {
  const diffMs = Math.max(0, saidaMs - entradaMs);
  const totalMinutos = Math.max(1, Math.ceil(diffMs / 60000));

  const t = Estado.tabelaPrecos || {};
  const tolerancia = Number(t.toleranciaMinutos) || 15;
  const primeiraHora = Number(t.primeiraHora) || 10.0;
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

// Fechar modais ao clicar no fundo
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

// Funções de formatação de máscaras
function aplicarMascarasInputs() {
  const inputPlaca = document.getElementById('cad-placa');
  inputPlaca?.addEventListener('input', (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length > 7) v = v.slice(0, 7);
    e.target.value = v;
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

