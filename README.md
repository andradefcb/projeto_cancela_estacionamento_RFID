# Protótipo de Cancela Automática com Sensor Ultrassônico e Servo

Protótipo em Arduino que simula uma cancela automática: quando um objeto é detectado a menos de 15 cm do sensor ultrassônico, o servo motor abre a cancela e o LED vermelho acende. Sem nenhum objeto por perto, a cancela fecha e o LED verde acende.

## Como funciona

1. O sensor ultrassônico mede a distância a cada 100 ms.
2. Se a distância for **menor ou igual a 15 cm**, o servo vai para **90°** (aberto), o LED vermelho acende e o verde apaga.
3. Caso contrário, o servo volta para **0°** (fechado), o LED verde acende e o vermelho apaga.
4. O servo só recebe comando quando o estado muda, graças à variável `aberto`, o que evita comandos repetidos.
5. Se o sensor não receber eco dentro de 30 ms, a função retorna `999`, e o sistema entende como "livre".
6. As leituras são enviadas pelo Monitor Serial (9600 baud).

## Componentes

- 1x Arduino (Uno, Nano ou compatível)
- 1x Sensor ultrassônico (HC-SR04 ou similar)
- 1x Servo motor (ex.: SG90)
- 1x LED verde
- 1x LED vermelho
- 2x Resistores para os LEDs
- Protoboard e jumpers

## Ligações (pinagem)

| Componente         | Pino do Arduino |
|--------------------|-----------------|
| Sensor TRIG        | 3               |
| Sensor ECHO        | 2               |
| LED verde          | 7               |
| LED vermelho       | 8               |
| Servo (sinal)      | 10              |

> Alimente o sensor e o servo com 5V e GND. Cada LED deve ter um resistor em série.

## Parâmetros configuráveis

No início do código é possível ajustar:

```cpp
const int distancia_deteccao = 15;  // Distância (cm) para abrir a cancela
const int ANGULO_FECHADO = 0;       // Ângulo do servo com a cancela fechada
const int ANGULO_ABERTO  = 90;      // Ângulo do servo com a cancela aberta
```

## Como usar

1. Monte o circuito conforme a tabela de ligações.
2. Abra o arquivo `prototipo.ino` na Arduino IDE.
3. Selecione a placa e a porta corretas em **Ferramentas**.
4. Faça o upload do código.
5. Abra o Monitor Serial em **9600 baud** para acompanhar as leituras:

```
Livre: 42cm
Detectado: 12cm
```

## Estrutura do projeto

```
.
├── prototipo.ino   # Código principal do protótipo
└── README.md
```

## Funções principais

- `setup()`: configura os pinos, inicia a serial e deixa o servo na posição fechada.
- `loop()`: lê a distância, controla LEDs e servo conforme a detecção.
- `sensor_morcego(trig, echo)`: dispara o pulso ultrassônico e retorna a distância em cm (`duração / 58`), ou `999` se não houver eco.

## Dependências

- Biblioteca [`Servo`](https://www.arduino.cc/reference/en/libraries/servo/) (já inclusa na Arduino IDE)

## Possíveis melhorias

- Adicionar um atraso antes de fechar a cancela, para evitar que ela feche enquanto o objeto ainda está passando.
- Incluir um buzzer como alerta sonoro.
- Usar média de várias leituras para reduzir ruídos do sensor.
