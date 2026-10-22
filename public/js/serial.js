/**
 * Módulo de Comunicação Web Serial API para Arduino
 * Permite que o navegador se comunique diretamente com a placa Arduino via USB.
 */

class ArduinoSerialController {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readableStreamClosed = null;
    this.writableStreamClosed = null;
    this.conectado = false;
    this.buffer = '';

    // Elemento visual do status no topo da página
    this.badgeEl = null;
    this.textEl = null;
  }

  init() {
    this.badgeEl = document.getElementById('arduino-status-badge');
    this.textEl = document.getElementById('arduino-status-text');

    if (this.badgeEl) {
      this.badgeEl.addEventListener('click', () => {
        if (!this.conectado) {
          this.conectar();
        } else {
          if (confirm('Deseja desconectar a placa Arduino?')) {
            this.desconectar();
          }
        }
      });
    }

    // Verifica se o navegador suporta Web Serial API
    if (!('serial' in navigator)) {
      if (this.textEl) {
        this.textEl.innerText = 'Serial não suportada';
      }
      console.warn('Web Serial API não é suportada por este navegador. Use Google Chrome ou Microsoft Edge.');
    }
  }

  async conectar() {
    if (!('serial' in navigator)) {
      alert('Seu navegador não suporta Web Serial API. Para conectar o Arduino via USB, utilize o Google Chrome ou Microsoft Edge.\n\nVocê também pode utilizar o botão "Simular Leitura RFID" para realizar todos os testes!');
      return;
    }

    try {
      // Solicita seleção da porta COM do Arduino
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 9600 });

      this.conectado = true;
      this.atualizarStatusUI(true, 'Arduino Conectado');
      window.mostrarToast && window.mostrarToast('Arduino conectado com sucesso à porta USB!', 'success');

      // Configura escritor para enviar comandos à cancela
      const textEncoder = new TextEncoderStream();
      this.writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

      // Inicia escuta contínua de dados recebidos
      this.lerDadosSerial();
    } catch (err) {
      console.error('Falha ao conectar com o Arduino:', err);
      this.atualizarStatusUI(false, 'Conectar Arduino');
      if (err.name !== 'NotFoundError') {
        alert('Erro ao conectar com a porta Serial: ' + err.message);
      }
    }
  }

  async lerDadosSerial() {
    const textDecoder = new TextDecoderStream();
    this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value) {
          this.processarTextoRecebido(value);
        }
      }
    } catch (err) {
      console.warn('Erro durante leitura serial:', err);
    } finally {
      this.reader.releaseLock();
      this.desconectar();
    }
  }

  processarTextoRecebido(texto) {
    this.buffer += texto;
    const linhas = this.buffer.split('\n');

    // Mantém a última linha incompleta no buffer
    this.buffer = linhas.pop();

    for (let linha of linhas) {
      linha = linha.trim();
      if (!linha) continue;

      console.log('[Arduino Serial]:', linha);

      // 1. Detecção de Código RFID (formato "RFID:A1B2C3D4")
      if (linha.startsWith('RFID:')) {
        const rfidCode = linha.replace('RFID:', '').trim().toUpperCase();
        console.log('>>> Cartão RFID Detectado:', rfidCode);

        // Dispara evento global no navegador
        window.dispatchEvent(new CustomEvent('rfid-lido', {
          detail: { rfid: rfidCode, origem: 'arduino' }
        }));
      }

      // 2. Notificações de Status do Arduino (Cancela)
      if (linha.startsWith('STATUS:') || linha.startsWith('EVENTO:')) {
        window.dispatchEvent(new CustomEvent('arduino-status', {
          detail: { status: linha }
        }));
      }
    }
  }

  async enviarComando(comando) {
    if (!this.conectado || !this.writer) {
      console.log('[Simulação Serial] Comando enviado para placa:', comando.trim());
      return false;
    }

    try {
      const cmdFormatado = comando.trim() + '\n';
      await this.writer.write(cmdFormatado);
      console.log('[Serial Enviado]:', cmdFormatado.trim());
      return true;
    } catch (err) {
      console.error('Erro ao enviar comando para Arduino:', err);
      return false;
    }
  }

  async desconectar() {
    try {
      this.conectado = false;
      if (this.reader) {
        await this.reader.cancel();
      }
      if (this.writer) {
        await this.writer.close();
      }
      if (this.port) {
        await this.port.close();
      }
    } catch (err) {
      console.warn('Erro ao fechar conexão serial:', err);
    } finally {
      this.port = null;
      this.reader = null;
      this.writer = null;
      this.atualizarStatusUI(false, 'Conectar Arduino');
      window.mostrarToast && window.mostrarToast('Arduino desconectado.', 'info');
    }
  }

  atualizarStatusUI(conectado, texto) {
    if (!this.badgeEl) return;
    if (conectado) {
      this.badgeEl.className = 'arduino-badge connected';
    } else {
      this.badgeEl.className = 'arduino-badge disconnected';
    }
    if (this.textEl) {
      this.textEl.innerText = texto;
    }
  }
}

// Instância global
const arduinoSerial = new ArduinoSerialController();
document.addEventListener('DOMContentLoaded', () => {
  arduinoSerial.init();
});

