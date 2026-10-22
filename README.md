# SmartPark RFID - Sistema de Estacionamento Inteligente (PEX 2° Período)

Sistema completo de controle e automação de estacionamento integrando **Arduino** com leitor **RFID MFRC522**, cancela automatizada (Servo Motor), sensor ultrassônico e uma **Aplicação Web moderna** com banco de dados, contagem de tempo cronometrada em tempo real, cálculo tarifário por tabela de preços e tela de pagamento.

---

## 📋 Funcionalidades Principais

1. **Leitura e Associação RFID**:
   - Leitura de tags/cartões RFID via leitor **MFRC522** conectado ao Arduino ou leitor USB.
   - Associação de cada RFID ao **Nome do Titular**, **Placa do Carro**, **Número de Contato (WhatsApp)** e **CPF do Titular**.
2. **Registro de Entrada & Temporizador em Tempo Real**:
   - Ao aproximar a tag RFID cadastrada na entrada, a cancela é aberta e o **cronômetro inicia automaticamente**.
   - No pátio virtual da aplicação Web, cada veículo conta com um cronômetro ao vivo (`HH:MM:SS`) e cálculo dinâmico do valor acumulado.
3. **Tela de Pagamento (Conforme Solicitado)**:
   - Seleção do veículo por aproximação da tag RFID ou seleção na lista.
   - **Finalização do temporizador** no segundo exato da saída.
   - Cálculo automático do valor com base na **Tabela de Preços configurável** (Tolerância gratuita, 1ª Hora, Frações de 15 minutos / Horas adicionais e Diária).
   - Suporte a múltiplas formas de pagamento: **PIX** (com QR Code), **Cartão de Crédito**, **Cartão de Débito** e **Dinheiro** (com cálculo automático de troco).
   - Confirmação do pagamento que envia sinal de **abertura da cancela** para saída do veículo e gera o **Comprovante / Recibo** pronto para impressão.
4. **Comunicação Web Serial Direta**:
   - O sistema conecta-se ao Arduino diretamente pelo navegador (Google Chrome / Edge) com um clique, sem necessidade de drivers adicionais.
   - Inclui **Simulador de Leitura RFID** para testes rápidos mesmo sem a placa física plugada.

---

## 🛠️ Estrutura do Projeto

```
Projeto PEX 2° Período/
│
├── prototipo.ino                          # Código principal do Arduino com RFID + Cancela + Sensor
├── arduino/
│   ├── prototipo_estacionamento/
│   │   └── prototipo_estacionamento.ino   # Cópia para compilação organizada na Arduino IDE
│   └── ligacoes_e_componentes.md          # Diagrama e guia de pinagem completo
│
├── server.js                              # Servidor Node.js Express com SSE e API REST
├── database.json                          # Banco de dados persistente (veículos, sessões e tabela)
├── package.json                           # Configuração e dependências do projeto
│
├── public/                                # Interface Web (Frontend)
│   ├── index.html                         # Estrutura HTML das telas (Pátio, Pagamento, Cadastro, Tabela)
│   ├── css/
│   │   └── style.css                      # Estilo moderno, responsivo e regras para impressão
│   └── js/
│       ├── app.js                         # Lógica do sistema, timers em tempo real e regras de negócio
│       └── serial.js                      # Conexão USB via Web Serial API
│
├── iniciar_sistema.bat                    # Script para inicializar o sistema com 1 clique no Windows
└── README.md                              # Documentação do projeto
```

---

## 🔌 Pinagem e Circuito no Arduino Uno

| Componente | Pino no Módulo | Pino no Arduino Uno | Observações |
| :--- | :--- | :---: | :--- |
| **Leitor RFID RC522** | **3.3V** | **3.3V** | ⚠️ **NÃO** ligar no 5V! |
| | **RST** | **Pino 9** | Reset do módulo |
| | **GND** | **GND** | Terra |
| | **MISO** | **Pino 12** | SPI MISO |
| | **MOSI** | **Pino 11** | SPI MOSI |
| | **SCK** | **Pino 13** | SPI Clock |
| | **SDA / SS** | **Pino 10** | Slave Select |
| **Servo Motor** | Sinal (Laranja/Amarelo) | **Pino 6** | Controle da cancela |
| **Sensor Ultrassônico**| **TRIG** | **Pino 3** | Disparo de pulso |
| | **ECHO** | **Pino 2** | Retorno de eco |
| **LED Verde** | Ânodo (+) | **Pino 7** | Acesso liberado (com resistor 220Ω) |
| **LED Vermelho** | Ânodo (+) | **Pino 8** | Cancela fechada / Pare (com resistor 220Ω) |
| **Buzzer Ativo** | Positivo (+) | **Pino 5** | Bip de leitura RFID e alerta |

---

## 🚀 Como Executar o Sistema

### 1. Gravando o Código no Arduino
1. Abra a **Arduino IDE**.
2. Instale a biblioteca **MFRC522** em: `Sketch -> Incluir Biblioteca -> Gerenciar Bibliotecas...` buscando por `MFRC522`.
3. Abra o arquivo [prototipo.ino](file:///c:/Users/andra/OneDrive/Documentos/Arduino/Projeto%20PEX%202°%20Período/prototipo.ino).
4. Selecione a sua placa (Arduino Uno ou Nano) e a porta COM em **Ferramentas**.
5. Clique em **Carregar (Upload)**.

### 2. Iniciando a Aplicação Web
Você pode inicializar de duas maneiras:

#### Opção A (Recomendada - 1 Clique):
- Dê um duplo-clique no arquivo **`iniciar_sistema.bat`**.
- O servidor será iniciado e seu navegador abrirá automaticamente em `http://localhost:3000`.

#### Opção B (Via Terminal):
```bash
npm start
```
Acesse no navegador: **`http://localhost:3000`**

---

## 💳 Como Usar a Tela de Pagamento

1. O veículo entra no estacionamento ao aproximar a tag RFID (ou simulada): o temporizador começa a contar.
2. Na aba **Pátio em Tempo Real**, você pode acompanhar os segundos correndo e o valor acumulado de cada vaga.
3. Para finalizar a estadia do veículo, clique no botão **"Finalizar & Pagar"** ou acesse a aba **"Pagamento"**:
   - Aproxime o cartão RFID do titular ou selecione o carro na lista.
   - O temporizador congela a contagem no momento exato e a memória de cálculo é exibida com base na Tabela de Preços configurada.
   - Selecione a forma de pagamento (**PIX**, **Cartão** ou **Dinheiro**).
   - Clique em **"Finalizar Temporizador & Pagar"**:
     - O sistema registra a saída com status **PAGO**.
     - Um comando `OPEN` é enviado pela porta serial para o Arduino abrir a cancela.
     - O **Comprovante de Estacionamento** é gerado com opção de impressão direta.
