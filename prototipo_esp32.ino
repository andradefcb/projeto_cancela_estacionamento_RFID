/******************************************************************************/
/*  Projeto PEX 2° Período: Sistema de Estacionamento Inteligente com RFID    */
/*  VERSÃO ESPECIAL: ESP32 (NodeMCU / DOIT ESP32 DevKit v1)                  */
/*  Componentes: ESP32, MFRC522 (RFID), Servo Motor (ESP32Servo),             */
/*               Sensor Ultrassônico HC-SR04, LEDs Indicadores e Buzzer       */
/******************************************************************************/

#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

// ====================================================================
// MAPEAMENTO DE PINOS DO ESP32 (30 ou 38 pinos)
// ====================================================================

// --- LEITOR RFID RC522 (Barramento SPI Padrão VSPI do ESP32) ---
// ATENÇÃO: Alimente o RC522 no pino 3V3 do ESP32 (NUNCA NO 5V!)
#define SS_PIN       5   // Pino SDA (SS) do RC522
#define RST_PIN      22  // Pino RST do RC522
// Demais pinos do RC522 conectados no SPI padrão:
// SCK  -> GPIO 18
// MISO -> GPIO 19
// MOSI -> GPIO 23

// --- ATUADORES E SENSORES ---
#define PINO_SERVO     13  // Pino de sinal PWM do Servo Motor da Cancela
#define PINO_TRIG      25  // Pino TRIG do sensor ultrassônico HC-SR04
#define PINO_ECHO      26  // Pino ECHO do sensor ultrassônico HC-SR04
#define PINO_LED_VERDE 2   // LED Verde: Cancela aberta (Pode usar LED onboard no GPIO 2)
#define PINO_LED_VERM  4   // LED Vermelho: Cancela fechada / Pare
#define PINO_BUZZER    27  // Buzzer ativo ou passivo (feedback sonoro)

// --- CONFIGURAÇÃO DOS ÂNGULOS DO SERVO ---
const int ANGULO_FECHADO = 0;   // Cancela abaixada (fechada)
const int ANGULO_ABERTO  = 90;  // Cancela levantada (aberta)
const int DISTANCIA_DETECCAO = 15; // Distância em cm para detectar passagem do veículo

// --- OBJETOS ---
MFRC522 rfid(SS_PIN, RST_PIN);
Servo servoCancela;

// --- VARIÁVEIS DE CONTROLE ---
bool cancelaAberta = false;
unsigned long tempoAbertura = 0;
const unsigned long TEMPO_MAXIMO_ABERTA = 7000; // Tempo máximo de cancela aberta (7s)
String ultimoUidLido = "";
unsigned long tempoUltimaLeitura = 0;
const unsigned long INTERVALO_LEITURA_RFID = 2500; // Evita leitura repetida do mesmo cartão em 2.5s

// ====================================================================
// CONFIGURAÇÃO INICIAL (SETUP)
// ====================================================================
void setup() {
  // Inicialização Serial a 115200 baud (padrão mais rápido para ESP32)
  // ou 9600 para manter compatibilidade direta com o Web Serial
  Serial.begin(9600);
  delay(1000);

  // Inicializa barramento SPI para o ESP32 (SCK=18, MISO=19, MOSI=23, SS=5)
  SPI.begin(18, 19, 23, SS_PIN);
  rfid.PCD_Init();

  // Configuração dos pinos de entrada e saída
  pinMode(PINO_TRIG, OUTPUT);
  pinMode(PINO_ECHO, INPUT);
  pinMode(PINO_LED_VERDE, OUTPUT);
  pinMode(PINO_LED_VERM, OUTPUT);
  pinMode(PINO_BUZZER, OUTPUT);

  // Alocação de temporizadores de hardware para o Servo no ESP32
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  servoCancela.setPeriodHertz(50); // Servo padrão analógico SG90 roda em 50Hz
  servoCancela.attach(PINO_SERVO, 500, 2400); // Faixa de pulso segura (500us a 2400us)

  // Inicia com cancela fechada
  fecharCancela();

  // Feedback sonoro de inicialização
  tocarBip(150);

  Serial.println(F("ESP32_SMARTPARK_PRONTO"));
  Serial.println(F("Aguardando aproximacao de cartao RFID..."));
}

// ====================================================================
// LOOP PRINCIPAL
// ====================================================================
void loop() {
  // 1. Processa comandos recebidos do computador / site via Serial (OPEN, CLOSE, DENIED)
  verificarComandosSerial();

  // 2. Realiza leitura do leitor RFID MFRC522
  verificarLeituraRFID();

  // 3. Gerencia fechamento inteligente da cancela após passagem do veículo
  gerenciarFechamentoCancela();

  delay(40);
}

// ====================================================================
// LEITURA DO CARTÃO RFID (MFRC522)
// ====================================================================
void verificarLeituraRFID() {
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Formata o UID lido em Hexadecimal maiúsculo (ex: A1B2C3D4)
  String uidAtual = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      uidAtual += "0";
    }
    uidAtual += String(rfid.uid.uidByte[i], HEX);
  }
  uidAtual.toUpperCase();

  // Filtro de repetição rápida
  unsigned long agora = millis();
  if (uidAtual == ultimoUidLido && (agora - tempoUltimaLeitura < INTERVALO_LEITURA_RFID)) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  ultimoUidLido = uidAtual;
  tempoUltimaLeitura = agora;

  // Bip sonoro rápido de leitura confirmada
  tocarBip(80);

  // Envia pela porta Serial para o Sistema Web
  // Formato: "RFID:123456"
  Serial.print("RFID:");
  Serial.println(uidAtual);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ====================================================================
// PROCESSAMENTO DE COMANDOS ENVIADOS PELO SISTEMA WEB VIA SERIAL
// ====================================================================
void verificarComandosSerial() {
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    comando.toUpperCase();

    if (comando == "OPEN" || comando == "ABRIR") {
      abrirCancela();
      Serial.println(F("STATUS:CANCELA_ABERTA"));
    } else if (comando == "CLOSE" || comando == "FECHAR") {
      fecharCancela();
      Serial.println(F("STATUS:CANCELA_FECHADA"));
    } else if (comando == "DENIED" || comando == "RECUSADO") {
      notificarAcessoNegado();
      Serial.println(F("STATUS:ACESSO_NEGADO"));
    }
  }
}

// ====================================================================
// CONTROLE DA CANCELA (SERVO, SENSOR ULTRASSÔNICO E LEDS)
// ====================================================================
void abrirCancela() {
  servoCancela.write(ANGULO_ABERTO);
  digitalWrite(PINO_LED_VERDE, HIGH);
  digitalWrite(PINO_LED_VERM, LOW);
  cancelaAberta = true;
  tempoAbertura = millis();
  tocarBip(120);
}

void fecharCancela() {
  servoCancela.write(ANGULO_FECHADO);
  digitalWrite(PINO_LED_VERDE, LOW);
  digitalWrite(PINO_LED_VERM, HIGH);
  cancelaAberta = false;
}

void gerenciarFechamentoCancela() {
  if (!cancelaAberta) return;

  unsigned long tempoPassado = millis() - tempoAbertura;
  int distancia = lerDistanciaUltrassom();

  // Fecha após tempo limite de segurança (7 segundos)
  if (tempoPassado >= TEMPO_MAXIMO_ABERTA) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_TEMPO"));
    return;
  }

  // Fecha automaticamente quando o carro se afastar do sensor ultrassônico
  if (tempoPassado > 2500 && distancia > DISTANCIA_DETECCAO) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_PASSAGEM"));
  }
}

// Medição ultrassônica em centímetros (HC-SR04)
int lerDistanciaUltrassom() {
  digitalWrite(PINO_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PINO_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PINO_TRIG, LOW);

  long duracao = pulseIn(PINO_ECHO, HIGH, 25000); // Timeout 25ms
  if (duracao == 0) return 999;
  return duracao / 58;
}

void notificarAcessoNegado() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(PINO_LED_VERM, LOW);
    digitalWrite(PINO_BUZZER, HIGH);
    delay(100);
    digitalWrite(PINO_LED_VERM, HIGH);
    digitalWrite(PINO_BUZZER, LOW);
    delay(100);
  }
}

void tocarBip(int duracaoMs) {
  digitalWrite(PINO_BUZZER, HIGH);
  delay(duracaoMs);
  digitalWrite(PINO_BUZZER, LOW);
}
