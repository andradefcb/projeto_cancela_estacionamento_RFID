/**
 * Módulo de Integração PIX - SmartPark RFID
 * Projeto PEX 2° Período
 *
 * Responsável por:
 * 1. Gerar cobranças PIX dinâmicas com QR Code e código "Pix Copia e Cola" (Padrão BR Code EMV).
 * 2. Receber e processar confirmações de pagamento (Webhook oficial de APIs bancárias:
 *    Mercado Pago, EFI Bank / Gerencianet, Banco Inter, Asaas, etc.).
 * 3. Liberar o ticket fiscal/comprovante e acionar a cancela SOMENTE após a confirmação do pagamento.
 */

// ====================================================================
// CONFIGURAÇÕES DA API DO PIX
// (Aqui você insere as credenciais do seu gateway bancário)
// ====================================================================
const CONFIG_PIX = {
  // Provider atual: 'manual' (chave estática), 'mercadopago', 'efi_gerencianet', 'inter', 'asaas'
  provider: process.env.PIX_PROVIDER || 'manual',

  // Dados da Chave PIX Padrão
  chave: process.env.PIX_CHAVE || 'pex-estacionamento-2026@arduino.org',
  tipoChave: 'EMAIL', // CPF, CNPJ, TELEFONE, EMAIL, ALEATORIA
  beneficiario: 'SmartPark Estacionamento PEX',
  cidade: 'MANAUS',

  // Credenciais para APIs Reais (preencher quando for usar produção)
  mercadopago: {
    accessToken: process.env.MP_ACCESS_TOKEN || 'SEU_ACCESS_TOKEN_MERCADO_PAGO'
  },
  efi_gerencianet: {
    clientId: process.env.EFI_CLIENT_ID || 'SEU_CLIENT_ID_EFI',
    clientSecret: process.env.EFI_CLIENT_SECRET || 'SEU_CLIENT_SECRET_EFI',
    certificado: process.env.EFI_CERTIFICADO_PATH || './certificado.p12'
  }
};

/**
 * Gera o payload oficial do Pix Copia e Cola (BR Code)
 * baseado no padrão do Banco Central (EMV QRCPS-MPM).
 */
function gerarPayloadPixCopiaECola({ chave, beneficiario, cidade, valor, txid = 'SMARTPARK' }) {
  const formatField = (id, value) => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  };

  const valorStr = Number(valor).toFixed(2);
  const txidFormatado = txid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'SMARTPARK';

  // 00: Payload Format Indicator (01)
  let payload = formatField('00', '01');

  // 26: Merchant Account Information - Pix
  const gui = formatField('00', 'br.gov.bcb.pix');
  const key = formatField('01', chave);
  payload += formatField('26', gui + key);

  // 52: Merchant Category Code (0000)
  payload += formatField('52', '0000');

  // 53: Transaction Currency (986 = BRL)
  payload += formatField('53', '986');

  // 54: Transaction Amount
  if (Number(valor) > 0) {
    payload += formatField('54', valorStr);
  }

  // 58: Country Code (BR)
  payload += formatField('58', 'BR');

  // 59: Merchant Name
  const nomeBeneficiario = (beneficiario || 'SmartPark').slice(0, 25);
  payload += formatField('59', nomeBeneficiario);

  // 60: Merchant City
  const cidadeBeneficiario = (cidade || 'MANAUS').slice(0, 15);
  payload += formatField('60', cidadeBeneficiario);

  // 62: Additional Data Field (txid)
  const txidField = formatField('05', txidFormatado);
  payload += formatField('62', txidField);

  // 63: CRC16 Checksum
  payload += '6304';
  const crc = calcularCRC16(payload);
  return payload + crc;
}

// Algoritmo CRC16-CCITT (Polinômio 0x1021)
function calcularCRC16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera dados da cobrança PIX para uma sessão
 */
function gerarCobrancaPix(params = {}) {
  const sessaoId = params.sessaoId || 'SES-001';
  const valor = Number(params.valor || 0);
  const placa = params.placa || '';
  const titular = params.titular || '';

  const txid = 'TX' + String(sessaoId).replace(/[^0-9]/g, '').slice(-15);
  const copiaECola = gerarPayloadPixCopiaECola({
    chave: CONFIG_PIX.chave,
    beneficiario: CONFIG_PIX.beneficiario,
    cidade: CONFIG_PIX.cidade,
    valor,
    txid
  });

  return {
    txid,
    sessaoId,
    valor,
    placa,
    titular,
    chave: CONFIG_PIX.chave,
    beneficiario: CONFIG_PIX.beneficiario,
    cidade: CONFIG_PIX.cidade,
    copiaECola,
    status: 'AGUARDANDO_PAGAMENTO',
    criadoEm: new Date().toISOString()
  };
}

module.exports = {
  CONFIG_PIX,
  gerarPayloadPixCopiaECola,
  gerarCobrancaPix
};
