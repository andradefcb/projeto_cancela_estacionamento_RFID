# 📘 Guia de Integração da API do PIX & Liberação de Ticket
### Projeto SmartPark RFID - PEX 2° Período

Este documento explica detalhadamente onde e como o sistema realiza a cobrança via PIX, como funciona a **liberação do ticket apenas após o pagamento**, e o passo a passo para conectar gateways de pagamento reais (Mercado Pago, EFI Bank/Gerencianet, Asaas, etc.).

---

## 1. Onde fica a integração no código?

A integração com o PIX está centralizada em dois arquivos principais:

### 📁 Arquivo 1: `pixService.js` (Serviço Especializado de PIX)
Localização: [`pixService.js`](file:///c:/Users/andra/OneDrive/Documentos/Arduino/Projeto%20PEX%202°%20Período/pixService.js)

Este arquivo é responsável por:
1. **Gerar o payload oficial do Banco Central (BR Code / EMV QRCPS-MPM)** com CRC16 válido.
2. **Gerar o SVG do QR Code visual** renderizado instantaneamente na tela do cliente e na guarita.
3. **Gerar o código PIX Copia-e-Cola** para que o cliente copie e cole no app do seu banco (Nubank, Inter, Itaú, BB, etc.).
4. **Configurações de Gateways de Pagamento Reais**: Contém o objeto `CONFIG_GATEWAY` com suporte pronto para Mercado Pago e EFI Bank.

### 📁 Arquivo 2: `server.js` (Rotas e Webhooks)
Localização: [`server.js`](file:///c:/Users/andra/OneDrive/Documentos/Arduino/Projeto%20PEX%202°%20Período/server.js)

Rotas responsáveis pelo PIX:
- `POST /api/pagamento/pix/gerar` (Linhas ~290-330): Recebe o `sessaoId`, calcula o valor do estacionamento com base na Tabela de Preços e gera o QR Code e chave Copia-e-Cola.
- `POST /api/pix/webhook` (Linhas ~340-390): **Ponto de entrada para confirmação automática do PIX** emitida pelo banco ou gateway quando o cliente paga.
- `POST /api/pagamento/finalizar` (Linhas ~395-460): Rota de finalização que valida o pagamento exclusivamente por PIX, bloqueia saídas sem pagamento e emite o comprovante/ticket.

---

## 2. Como Funciona a Liberação do Ticket Apenas Após o Pagamento

O sistema adota a seguinte trava de segurança:
1. **Enquanto não houver pagamento**:
   - O ticket/recibo **não existe no banco de dados**.
   - O botão de impressão e o cupom fiscal/comprovante permanecem **bloqueados**.
   - A cancela de saída do Arduino permanece **fechada** (`CLOSED`).
2. **Ao receber a confirmação de pagamento PIX**:
   - O backend valida a quitação do valor total.
   - O backend move a sessão de `sessoesAtivas` para `sessoes` (histórico finalizado) marcando `pago: true`.
   - Gera o número de comprovante oficial (`REC-XXXXX`).
   - Dispara o evento SSE `pagamento_concluido` para atualizar todas as telas conectadas.
   - Envia o comando serial `OPEN` para o Arduino abrir a cancela do pátio.
   - Retorna o objeto `comprovante` que **desbloqueia o modal do ticket** na tela para visualização e impressão.

---

## 3. Passo a Passo: Como Conectar uma API de PIX Real

### Opção A: Mercado Pago (Mais simples para testes e produção)

1. Obtenha seu **Access Token de Produção** ou **Teste** no painel do [Mercado Pago Developers](https://www.mercadopago.com.br/developers).
2. No arquivo [`pixService.js`](file:///c:/Users/andra/OneDrive/Documentos/Arduino/Projeto%20PEX%202°%20Período/pixService.js), preencha suas credenciais:
   ```javascript
   const CONFIG_GATEWAY = {
     provedor: 'mercadopago', // altere para 'mercadopago'
     mercadopago: {
       accessToken: 'APP_USR-SEU-ACCESS-TOKEN-AQUI',
       notificationUrl: 'https://seu-dominio.com/api/pix/webhook'
     }
   };
   ```
3. Na função `criarPixMercadoPago(sessao, valorTotal)` em `pixService.js`, basta descomentar o envio:
   ```javascript
   const res = await fetch('https://api.mercadopago.com/v1/payments', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${CONFIG_GATEWAY.mercadopago.accessToken}`,
       'X-Idempotency-Key': sessao.id + '-' + Date.now()
     },
     body: JSON.stringify({
       transaction_amount: Number(valorTotal.toFixed(2)),
       description: `Estacionamento SmartPark - Veiculo ${sessao.veiculo.placa}`,
       payment_method_id: 'pix',
       notification_url: CONFIG_GATEWAY.mercadopago.notificationUrl,
       payer: {
         email: 'cliente@estacionamento.com',
         first_name: sessao.veiculo.nome,
         identification: {
           type: 'CPF',
           number: sessao.veiculo.cpf.replace(/\D/g, '')
         }
       }
     })
   });
   const data = await res.json();
   return {
     copiaECola: data.point_of_interaction.transaction_data.qr_code,
     qrCodeBase64: data.point_of_interaction.transaction_data.qr_code_base64,
     idTransacao: data.id
   };
   ```

---

### Opção B: EFI Bank / Gerencianet (API Pix Oficial do Banco Central)

1. Baixe o **Certificado Digital `.p12`** e copie as credenciais `Client_Id` e `Client_Secret` no portal da [EFI Bank](https://sejaefi.com.br).
2. Configure em `pixService.js`:
   ```javascript
   const CONFIG_GATEWAY = {
     provedor: 'efibank',
     efibank: {
       clientId: 'Client_Id_xxx',
       clientSecret: 'Client_Secret_xxx',
       chavePix: 'sua-chave-pix@cadastrada.com',
       certificadoCaminho: './certs/producao.p12'
     }
   };
   ```
3. A EFI criará uma cobrança imediata via endpoint `PUT /v2/cob/:txid` e devolverá o `location` com o QR Code oficial.

---

## 4. Como Configurar o Webhook de Liberação Automática

Quando o cliente paga pelo aplicativo do banco, o banco notifica a URL configurada:

- **Endpoint no Servidor**: `POST /api/pix/webhook`
- Quando receber a notificação com `status: "approved"` ou `pix: [{ ... }]`:
  1. O backend busca a sessão pendente correspondente.
  2. Finaliza a cobrança automaticamente.
  3. Dispara a abertura da cancela (`OPEN`) no Arduino.
  4. Envia o comprovante para o navegador via Server-Sent Events (SSE).

> **Dica para Testes Locais com Webhook:**
> Se o servidor estiver rodando no seu computador (localhost:3000), utilize ferramentas como **ngrok** ou **localtunnel** para expor uma URL pública e testar o recebimento dos webhooks do banco:
> ```bash
> npx ngrok http 3000
> ```
> Use a URL gerada (ex: `https://xxxx.ngrok-free.app/api/pix/webhook`) como sua URL de notificação no portal do gateway.

---

## 5. Resumo das Regras da Tabela de Preços

O cálculo segue rigorosamente as **5 opções oficiais**:
1. **Isenção (em minutos)**: Tolerância inicial gratuita (ex: 15 min $\rightarrow$ R$ 0,00).
2. **Até 30 minutos**: Cobrança do valor fixo de 30 min (ex: R$ 5,00).
3. **Até 1 hora**: Cobrança do valor fixo de 1 hora (ex: R$ 10,00).
4. **Hora Adicional**: Acréscimo por hora que exceder os primeiros 60 minutos (ex: R$ 5,00/h).
5. **Diária**: Teto aplicado quando a estadia atinge o limite de horas (ex: 8 horas $\rightarrow$ R$ 40,00).
