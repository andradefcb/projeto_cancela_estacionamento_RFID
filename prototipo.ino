/******************************************************************************/
/*        Projeto: Protótipo Sensor com Servo (Cancela Automática)            */
/******************************************************************************/

#include <Servo.h>  // Biblioteca para controlar o servo motor

// Distância (cm) abaixo da qual o servo abre
const int distancia_deteccao = 15;

// Ângulos do servo
const int ANGULO_FECHADO = 0;
const int ANGULO_ABERTO  = 90;

// Pinos do sensor
const int TRIG = 3;
const int ECHO = 2;

// Demais componentes
const int ledGreen = 7;
const int ledRed   = 8;
const int pinoServo = 10;

Servo servo;               // Objeto do servo
bool aberto = false;       // Guarda o estado atual (evita comandos repetidos)

void setup() {
  Serial.begin(9600);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  pinMode(ledGreen, OUTPUT);
  pinMode(ledRed, OUTPUT);

  servo.attach(pinoServo);       // Liga o servo ao pino 10
  servo.write(ANGULO_FECHADO);   // Começa fechado
}

void loop() {
  int distancia = sensor_morcego(TRIG, ECHO);

  if (distancia <= distancia_deteccao) {
    // Objeto detectado: abre
    Serial.print("Detectado: ");
    Serial.print(distancia);
    Serial.println("cm");
    digitalWrite(ledGreen, LOW);
    digitalWrite(ledRed, HIGH);

    if (!aberto) {                 // Só move se ainda não estiver aberto
      servo.write(ANGULO_ABERTO);
      aberto = true;
    }
  } else {
    // Nada na frente: fecha
    Serial.print("Livre: ");
    Serial.print(distancia);
    Serial.println("cm");
    digitalWrite(ledGreen, HIGH);
    digitalWrite(ledRed, LOW);

    if (aberto) {                  // Só move se ainda estiver aberto
      servo.write(ANGULO_FECHADO);
      aberto = false;
    }
  }
  delay(100);
}

// Mede a distância em cm (retorna 999 se não houver eco)
int sensor_morcego(int pinotrig, int pinoecho) {
  digitalWrite(pinotrig, LOW);
  delayMicroseconds(2);
  digitalWrite(pinotrig, HIGH);
  delayMicroseconds(10);
  digitalWrite(pinotrig, LOW);

  long duracao = pulseIn(pinoecho, HIGH, 30000);  // Timeout de 30 ms
  if (duracao == 0) {
    return 999;
  }
  return duracao / 58;
}