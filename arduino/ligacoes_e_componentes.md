# Guia de Ligações e Componentes - Sistema de Estacionamento RFID (PEX)

Este documento descreve as conexões elétricas e a pinagem utilizada no protótipo de cancela de estacionamento com leitor RFID **MFRC522**, Servo Motor, Sensor Ultrassônico **HC-SR04**, LEDs indicadores e Buzzer.

---

## 1. Lista de Componentes

| Quantidade | Componente | Descrição / Modelo |
| :---: | :--- | :--- |
| **1x** | Arduino Uno ou Nano | Placa controladora principal |
| **1x** | Módulo Leitor RFID RC522 | Leitura de tags e cartões RFID 13.56MHz (com pinos SPI) |
| **1x** | Servo Motor SG90 (ou similar) | Acionamento da haste da cancela |
| **1x** | Sensor Ultrassônico HC-SR04 | Detecção de presença/passagem do veículo |
| **1x** | LED Verde (5mm) | Indicador visual de passagem liberada |
| **1x** | LED Vermelho (5mm) | Indicador visual de cancela fechada / acesso negado |
| **2x** | Resistores de 220Ω ou 330Ω | Limitadores de corrente para os LEDs |
| **1x** | Buzzer Ativo (5V) | Emissão de bips de confirmação e alerta (opcional) |
| **1x** | Protoboard e Jumpers | Barramento de ligação M/M e M/F |

---

## 2. Pinagem Completa no Arduino Uno

### A. Leitor RFID RC522 (Comunicação SPI)
> **ATENÇÃO:** O pino **3.3V** deve ser ligado **exclusivamente na saída 3.3V do Arduino**. Ligar em 5V pode queimar o chip do leitor!

| Pino no Módulo RC522 | Pino no Arduino Uno | Observações |
| :--- | :---: | :--- |
| **VCC / 3.3V** | **3.3V** | **NUNCA** ligar nos 5V! |
| **RST** | **Pino 9** | Reset do módulo |
| **GND** | **GND** | Terra comum |
| **MISO** | **Pino 12** | Barramento SPI (Master In Slave Out) |
| **MOSI** | **Pino 11** | Barramento SPI (Master Out Slave In) |
| **SCK** | **Pino 13** | Barramento SPI (Clock) |
| **SDA / SS** | **Pino 10** | Slave Select do leitor RFID |
| **IRQ** | *Não conectado* | Deixar livre |

---

### B. Servo Motor (Cancela)

| Fio do Servo Motor | Pino no Arduino Uno |
| :--- | :---: |
| Marrom / Preto | **GND** |
| Vermelho | **5V** |
| Amarelo / Laranja (Sinal) | **Pino 6** |

---

### C. Sensor Ultrassônico HC-SR04

| Pino do Sensor | Pino no Arduino Uno |
| :--- | :---: |
| **VCC** | **5V** |
| **TRIG** | **Pino 3** |
| **ECHO** | **Pino 2** |
| **GND** | **GND** |

---

### D. Sinalização (LEDs e Buzzer)

| Componente | Conexão Positiva (+) | Conexão Negativa (-) |
| :--- | :---: | :---: |
| **LED Verde** | **Pino 7** (com resistor 220Ω) | **GND** |
| **LED Vermelho** | **Pino 8** (com resistor 220Ω) | **GND** |
| **Buzzer Ativo** | **Pino 5** | **GND** |

---

## 3. Instalação da Biblioteca RFID na Arduino IDE

Para compilar o código do Arduino:
1. Abra a **Arduino IDE**.
2. Vá em **Sketch -> Incluir Biblioteca -> Gerenciar Bibliotecas...** (ou `Ctrl + Shift + I`).
3. No campo de busca, digite: `MFRC522`.
4. Procure pela biblioteca **MFRC522 by GithubCommunity** (ou *MFRC522 by Miguel Balboa*).
5. Clique em **Instalar**.
6. A biblioteca `Servo.h` e `SPI.h` já vêm instaladas por padrão na Arduino IDE.

---

## 4. Comunicação Serial com o Sistema Web

O Arduino e a aplicação Web conversam através da porta USB (Baudrate: **9600**):

- **Mensagens enviadas pelo Arduino:**
  - `RFID:<UID>` (ex: `RFID:3A78F21B`) -> Enviado sempre que uma tag é aproximada.
  - `STATUS:CANCELA_ABERTA` -> Informa que a cancela subiu.
  - `STATUS:CANCELA_FECHADA` -> Informa que a cancela desceu.

- **Comandos aceitos pelo Arduino:**
  - `OPEN` -> Aciona a cancela (sobe o servo para 90°, acende LED verde e apaga vermelho).
  - `CLOSE` -> Abaixa a cancela (servo em 0°, acende LED vermelho).
  - `DENIED` -> Pisca o LED vermelho e toca alerta sonoro de acesso negado.

