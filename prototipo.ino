/******************************************************************************/
/*  Projeto PEX 2° Período: Sistema de Estacionamento Inteligente com RFID    */
/*  Componentes: Arduino Uno, MFRC522 (RFID), Servo Motor (Cancela),          */
/*               Sensor Ultrassônico HC-SR04, LEDs Indicadores e Buzzer       */
/******************************************************************************/

#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>

// --- PINAGEM DO LEITOR RFID RC522 (SPI) ---
#define SS_PIN   10   // Pino SDA do RC522
#define RST_PIN  9    // Pino RST do RC522

// --- DEMAIS PINOS DO CIRCUITO ---
#define PINO_SERVO    6   // Pino de sinal do Servo Motor (Cancela)
#define PINO_TRIG     3   // Pino TRIG do sensor ultrassônico HC-SR04
#define PINO_ECHO     2   // Pino ECHO do sensor ultrassônico HC-SR04
#define PINO_LED_VERDE 7  // LED Verde: Cancela aberta / Entrada liberada
#define PINO_LED_VERM  8  // LED Vermelho: Cancela fechada / Pare
#define PINO_BUZZER    5  // Buzzer (feedback sonoro de leitura)

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

void setup() {
  Serial.begin(9600);
  while (!Serial && millis() < 3000);

  // Inicializa barramento SPI e Leitor RFID RC522
  SPI.begin();
  rfid.PCD_Init();

  // Configuração dos pinos de entrada e saída
  pinMode(PINO_TRIG, OUTPUT);
  pinMode(PINO_ECHO, INPUT);
  pinMode(PINO_LED_VERDE, OUTPUT);
  pinMode(PINO_LED_VERM, OUTPUT);
  pinMode(PINO_BUZZER, OUTPUT);

  // Inicializa o servo motor na posição fechada
  servoCancela.attach(PINO_SERVO);
  fecharCancela();

  // Bip de inicialização
  tocarBip(100);

  Serial.println(F("SISTEMA_PRONTO"));
  Serial.println(F("Aguardando aproximacao de cartao RFID..."));
}

void loop() {
  // 1. Processa comandos recebidos do computador / site via Serial
  verificarComandosSerial();

  // 2. Realiza leitura do leitor RFID MFRC522
  verificarLeituraRFID();

  // 3. Gerencia fechamento inteligente da cancela
  gerenciarFechamentoCancela();

  delay(50);
}

// ====================================================================
// LEITURA DO CARTÃO RFID
// ====================================================================
void verificarLeituraRFID() {
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Formata o UID lido em Hexadecimal (ex: A1B2C3D4)
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
  Serial.print("RFID:");
  Serial.println(uidAtual);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ====================================================================
// PROCESSAMENTO DE COMANDOS ENVIADOS PELO SITE
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
  tocarBip(150);
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

  // Fecha após tempo limite seguro (7 segundos)
  if (tempoPassado >= TEMPO_MAXIMO_ABERTA) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_TEMPO"));
    return;
  }

  // Fecha de forma inteligente quando o carro passar pelo sensor ultrassônico
  if (tempoPassado > 2500 && distancia > DISTANCIA_DETECCAO) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_PASSAGEM"));
  }
}

// Medição ultrassônica em cm
int lerDistanciaUltrassom() {
  digitalWrite(PINO_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PINO_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PINO_TRIG, LOW);

  long duracao = pulseIn(PINO_ECHO, HIGH, 25000);
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
