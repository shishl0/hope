import { Injectable, OnDestroy } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { ProtoTankMoveResponseDto } from './player-state-dto';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WsStats {
  ping: number;    // ms round-trip
  tps: number;     // server ticks received per second
  connected: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProtoTankWsService implements OnDestroy {
  private socket: WebSocket | null = null;
  private sessionId = 'session1';
  private readonly wsUrl = `ws://127.0.0.1:8001/ws/proto-tank/${this.sessionId}/`;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelay = 2000;
  private readonly maxAttempts = 20;
  private attempts = 0;
  private destroyed = false;

  // ── Public streams ──────────────────────────────────────────
  readonly state$  = new Subject<any[]>();
  readonly status$ = new BehaviorSubject<WsStatus>('disconnected');
  readonly stats$  = new BehaviorSubject<WsStats>({ ping: 0, tps: 0, connected: false });
  readonly myId$   = new BehaviorSubject<string>('');

  // ── Ping tracking ───────────────────────────────────────────
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingSentAt = 0;
  private lastPing = 0;

  // ── TPS tracking ────────────────────────────────────────────
  private ticksThisSecond = 0;
  private tpsInterval: ReturnType<typeof setInterval> | null = null;
  private lastTps = 0;

  // ─────────────────────────────────────────────────────────────

  connect(): void {
    this.destroyed = false;
    if (this.destroyed) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.status$.next(this.attempts === 0 ? 'connecting' : 'reconnecting');
    this.socket = new WebSocket(this.wsUrl);

    this.socket.onopen = () => {
      this.attempts = 0;
      this.status$.next('connected');
      this.stats$.next({ ping: 0, tps: 0, connected: true });
      this._startPingLoop();
      this._startTpsCounter();
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (Array.isArray(data)) {
          this.ticksThisSecond++;
          this.state$.next(data);
        } else if (data.type === 'init') {
          this.myId$.next(data.id);
        } else if (data.type === 'pong') {
          this.lastPing = Date.now() - this.pingSentAt;
          this._emitStats();
        }
      } catch { /* ignore */ }
    };

    this.socket.onclose = () => {
      this.status$.next('disconnected');
      this._stopLoops();
      this._scheduleReconnect();
    };

    this.socket.onerror = () => { /* onclose fires next */ };
  }

  /** Send current key-state snapshot to server. */
  sendInput(input: {
    forward: boolean; backward: boolean;
    hullRotateLeft: boolean; hullRotateRight: boolean;
    turretLeft: boolean; turretRight: boolean;
    fire: boolean;
  }): void {
    this._send({ type: 'input', ...input });
  }

  disconnect(): void {
    this.destroyed = true;
    this._stopLoops();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.stats$.next({ ping: 0, tps: 0, connected: false });
  }

  ngOnDestroy(): void { this.disconnect(); }

  // ── Internal ────────────────────────────────────────────────

  private _send(data: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private _startPingLoop(): void {
    this.pingInterval = setInterval(() => {
      this.pingSentAt = Date.now();
      this._send({ type: 'ping', client_time: this.pingSentAt });
    }, 1000);
  }

  private _startTpsCounter(): void {
    this.ticksThisSecond = 0;
    this.tpsInterval = setInterval(() => {
      this.lastTps = this.ticksThisSecond;
      this.ticksThisSecond = 0;
      this._emitStats();
    }, 1000);
  }

  private _stopLoops(): void {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.tpsInterval)  { clearInterval(this.tpsInterval);  this.tpsInterval  = null; }
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || this.attempts >= this.maxAttempts) return;
    this.reconnectTimer = setTimeout(() => {
      this.attempts++;
      this.connect();
    }, this.reconnectDelay);
  }

  private _emitStats(): void {
    this.stats$.next({
      ping:      this.lastPing,
      tps:       this.lastTps,
      connected: this.socket?.readyState === WebSocket.OPEN,
    });
  }
}
