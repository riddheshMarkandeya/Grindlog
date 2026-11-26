import http from 'node:http';
import { EventEmitter } from 'node:events';

export interface MatchEndedEvent {
  guid: string;
  sessionKey: string | null;
}

export class GrindlogSSEClient extends EventEmitter {
  private url: string;
  private req: http.ClientRequest | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  constructor(url: string = 'http://127.0.0.1:49100/api/events') {
    super();
    this.url = url;
  }

  public start(): void {
    this.connect();
  }

  public stop(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.req) {
      this.req.destroy();
      this.req = null;
    }
    this.isConnected = false;
  }

  private connect(): void {
    try {
      this.req = http.get(this.url, { headers: { Accept: 'text/event-stream' } }, res => {
        if (res.statusCode !== 200) {
          this.scheduleReconnect();
          return;
        }

        this.isConnected = true;
        this.emit('connected');

        let buffer = '';
        let currentEvent = 'message';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
              // Heartbeat comment
              continue;
            }

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim();
            } else if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const data = JSON.parse(dataStr);
                this.handleEvent(currentEvent, data);
              } catch (e) {
                // Non-JSON or malformed data
              }
              currentEvent = 'message';
            }
          }
        });

        res.on('end', () => {
          this.isConnected = false;
          this.emit('disconnected');
          this.scheduleReconnect();
        });

        res.on('error', () => {
          this.isConnected = false;
          this.scheduleReconnect();
        });
      });

      this.req.on('error', () => {
        this.isConnected = false;
        this.scheduleReconnect();
      });
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private handleEvent(eventName: string, data: any): void {
    if (eventName === 'match_ended') {
      const matchEndedData: MatchEndedEvent = {
        guid: data.guid,
        sessionKey: data.sessionKey || null,
      };
      this.emit('match_ended', matchEndedData);
    } else {
      this.emit(eventName, data);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  }
}
