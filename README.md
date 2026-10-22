# SmartPark RFID - Sistema de Estacionamento Inteligente (PEX 2° Período)

Sistema completo de controle e automação de estacionamento integrando **Arduino** com leitor **RFID MFRC522**, cancela automatizada (Servo Motor), sensor ultrassônico e uma **Aplicação Web moderna** com banco de dados, sistema de **Cargos e Login (Admin vs Cliente)**, contagem de tempo cronometrada em tempo real, cálculo tarifário por tabela de preços e portal de pagamento do cliente.

---

## 👥 Sistema de Cargos e Login

O sistema conta com dois perfis de acesso:

### 1. Perfil Administrador (Guarita / Gerência)
- **Credenciais Padrão:**
  - **Login:** `admin`
  - **Senha:** `123`
- **Acesso Total:**
  - **Métricas do Topo:** Faturamento do dia, carros atualmente no pátio, total de veículos cadastrados e saídas pagas hoje.
  - **Pátio em Tempo Real:** Monitoramento de todos os veículos estacionados com cronômetro ao vivo (`HH:MM:SS`) e valor parcial acumulado.
  - **Tela de Pagamento (Guarita):** Consulta qualquer estadia por RFID, finaliza o tempo e processa pagamentos via PIX, Cartão ou Dinheiro (com cálculo automático de troco).
  - **Cadastro de Veículos & RFID:** Associação de cada tag com Titular, Placa, Contato, CPF e definição de **Login e Senha** para o cliente acessar seu portal.
  - **Tabela de Preços:** Configuração de tolerância gratuita, valor da 1ª hora, frações de 15 min, diária e modo de cobrança.
  - **Histórico Geral:** Auditoria de todas as estadias pagas e reimpressão de cupons fiscais.

---

### 2. Perfil Cliente / Proprietário do Veículo
Cada veículo cadastrado possui credenciais próprias para acessar o seu **Portal do Motorista**:
- **Credenciais de Exemplo Cadastradas:**
  - **Login:** `BRA2E19` (ou CPF: `123.456.789-00`) | **Senha:** `123` *(Carlos Eduardo da Silva)*
  - **Login:** `RIO1A23` (ou CPF: `987.654.321-11`) | **Senha:** `123` *(Mariana Ferreira Santos)*
  - **Login:** `SPX9F44` (ou CPF: `456.789.123-22`) | **Senha:** `123` *(Lucas Gabriel de Oliveira)*
- **Funcionalidades do Portal do Cliente:**
  - **Acompanhamento ao Vivo:** Cronômetro em tempo real do tempo exato que o seu veículo está estacionado.
  - **Cálculo Automático:** Exibição do valor a pagar de acordo com a tabela de preços do estacionamento.
  - **Pagamento Online do Próprio Veículo:**
    - **PIX Instantâneo** com QR Code gerado, Chave Pix e botão de *Copiar Código Pix Copia-e-Cola*.
    - **Cartão de Crédito**.
  - **Botão "Pagar Agora e Liberar Cancela":**
    - Finaliza o temporizador da sua estadia.
    - Aciona a abertura da cancela no Arduino para você sair.
    - Emite o Recibo / Comprovante fiscal digital na tela.
  - **Histórico Pessoal:** Lista de todas as visitas anteriores do seu veículo com acesso aos recibos.

---

## 🛠️ Estrutura do Projeto

```
Projeto PEX 2° Período/
│
├── prototipo.ino                          # Firmware Arduino (RFID RC522, Servo Cancela, Ultrassônico, LEDs e Buzzer)
├── server.js                              # Servidor Node.js Express (Autenticação, API REST e Server-Sent Events)
├── database.json                          # Banco de dados persistente (usuários, veículos e sessões)
├── package.json                           # Dependências (Express, CORS)
│
├── public/                                # Frontend Completo
│   ├── index.html                         # Tela de Login, Portal do Cliente, Painel Admin e Modais
│   ├── css/style.css                      # Estilo moderno, responsivo e folhas de estilo para cupons
│   └── js/
│       ├── app.js                         # Lógica do temporizador ao vivo, autenticação e pagamentos
│       └── serial.js                      # Conexão USB direta via Web Serial API
│
├── iniciar_sistema.bat                    # Inicializador com 1 clique para Windows
└── README.md                              # Documentação completa
```

---

## 🔌 Pinagem no Arduino Uno

| Componente | Pino no Módulo | Pino no Arduino | Observações |
| :--- | :--- | :---: | :--- |
| **Leitor RFID RC522** | **3.3V** | **3.3V** | ⚠️ **NÃO** ligar no 5V! |
| | **RST** | **Pino 9** | Reset do RFID |
| | **GND** | **GND** | Terra |
| | **MISO** | **Pino 12** | Barramento SPI |
| | **MOSI** | **Pino 11** | Barramento SPI |
| | **SCK** | **Pino 13** | Barramento SPI Clock |
| | **SDA / SS** | **Pino 10** | Slave Select |
| **Servo Motor** | Sinal | **Pino 6** | Controle da cancela |
| **Ultrassônico HC-SR04** | **TRIG** | **Pino 3** | Emissão de pulso |
| | **ECHO** | **Pino 2** | Leitura de eco |
| **LED Verde** | Ânodo (+) | **Pino 7** | Cancela aberta (com resistor 220Ω) |
| **LED Vermelho** | Ânodo (+) | **Pino 8** | Cancela fechada (com resistor 220Ω) |
| **Buzzer Ativo** | Positivo (+) | **Pino 5** | Bips de leitura e alerta |

---

## 🚀 Como Executar o Sistema

### 1. Iniciar a Aplicação Web
- Dê um duplo-clique no arquivo **`iniciar_sistema.bat`** (ou execute `npm start` no terminal).
- Acesse no navegador: **`http://localhost:3000`**

### 2. Como Testar
- Na tela de login inicial, você pode utilizar os botões de atalho:
  * **Demo Admin:** Entra no painel da guarita com credenciais `admin` / `123`.
  * **Demo Cliente:** Entra no portal do motorista com credenciais `BRA2E19` / `123`.
- No topo da página, use o botão **"Simular RFID"** para simular aproximação de cartões ou conecte o Arduino físico via USB pelo botão **"Conectar Arduino"**.
