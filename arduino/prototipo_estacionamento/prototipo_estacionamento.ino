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
#define PINO_SERVO    6   // Pino de sinal do Servo Motor
#define PINO_TRIG     3   // Pino TRIG do sensor ultrassônico HC-SR04
#define PINO_ECHO     2   // Pino ECHO do sensor ultrassônico HC-SR04
#define PINO_LED_VERDE 7  // LED Verde: Cancela aberta / Entrada liberada
#define PINO_LED_VERM  8  // LED Vermelho: Cancela fechada / Pare
#define PINO_BUZZER    5  // Buzzer (opcional, para feedback sonoro)

// --- CONFIGURAÇÃO DOS ÂNGULOS DO SERVO ---
const int ANGULO_FECHADO = 0;   // Cancela abaixada (fechada)
const int ANGULO_ABERTO  = 90;  // Cancela levantada (aberta)
const int DISTANCIA_DETECCAO = 15; // Distância em cm para detectar passagem do veículo

// --- OBJETOS ---
MFRC522 rfid(SS_PIN, RST_PIN);
Servo servoCancela;

// --- VARIÁVEIS DE ESTADO ---
bool cancelaAberta = false;
unsigned long tempoAbertura = 0;
const unsigned long TEMPO_MAXIMO_ABERTA = 7000; // Tempo máximo de cancela aberta (7s)
String ultimoUidLido = "";
unsigned long tempoUltimaLeitura = 0;
const unsigned long INTERVALO_LEITURA_RFID = 2500; // Evita leitura repetida em 2.5s

void setup() {
  Serial.begin(9600);
  while (!Serial && millis() < 3000); // Aguarda porta serial caso necessário

  // Inicializa barramento SPI e Leitor RFID
  SPI.begin();
  rfid.PCD_Init();

  // Configuração dos pinos
  pinMode(PINO_TRIG, OUTPUT);
  pinMode(PINO_ECHO, INPUT);
  pinMode(PINO_LED_VERDE, OUTPUT);
  pinMode(PINO_LED_VERM, OUTPUT);
  pinMode(PINO_BUZZER, OUTPUT);

  // Inicializa o servo
  servoCancela.attach(PINO_SERVO);
  fecharCancela();

  // Sinal sonoro e visual de inicialização concluída
  digitalWrite(PINO_BUZZER, HIGH);
  delay(100);
  digitalWrite(PINO_BUZZER, LOW);

  Serial.println(F("SISTEMA_PRONTO"));
  Serial.println(F("Aguardando aproximacao de cartao RFID..."));
}

void loop() {
  // 1. Processa comandos recebidos do computador / site via Serial
  verificarComandosSerial();

  // 2. Realiza leitura do leitor RFID
  verificarLeituraRFID();

  // 3. Gerenciamento do fechamento automático da cancela após abertura
  gerenciarFechamentoCancela();

  delay(50);
}

// ====================================================================
// FUNÇÕES DO LEITOR RFID
// ====================================================================
void verificarLeituraRFID() {
  // Verifica se há um novo cartão presente
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  // Lê os dados do cartão
  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Formata o UID do cartão em Hexadecimal (ex: A1B2C3D4)
  String uidAtual = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      uidAtual += "0";
    }
    uidAtual += String(rfid.uid.uidByte[i], HEX);
  }
  uidAtual.toUpperCase();

  // Filtro de repetição para não reenviar o mesmo cartão imediatamente
  unsigned long agora = millis();
  if (uidAtual == ultimoUidLido && (agora - tempoUltimaLeitura < INTERVALO_LEITURA_RFID)) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  ultimoUidLido = uidAtual;
  tempoUltimaLeitura = agora;

  // Bip sonoro rápido de confirmação de leitura
  tocarBip(80);

  // Envia formato padronizado para o sistema web / backend
  Serial.print("RFID:");
  Serial.println(uidAtual);

  // Finaliza a comunicação com a tag atual
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ====================================================================
// PROCESSAMENTO DE COMANDOS DA SERIAL (VINDO DO SITE)
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
    } else if (comando == "PING") {
      Serial.println(F("PONG"));
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

  // Fecha se o tempo limite estourou (7 segundos)
  if (tempoPassado >= TEMPO_MAXIMO_ABERTA) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_TEMPO"));
    return;
  }

  // Fecha de forma inteligente se o veículo já passou (após pelo menos 2s aberto e pista livre)
  if (tempoPassado > 2500 && distancia > DISTANCIA_DETECCAO) {
    fecharCancela();
    Serial.println(F("EVENTO:CANCELA_FECHADA_PASSAGEM"));
  }
}

// Mede distância com sensor ultrassônico HC-SR04 em cm
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

// Feedback de acesso negado
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

