import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export interface GameState {
  players: { [id: string]: any };
  bullets: any[];
  map: { w: number; h: number };
}

@Injectable({
  providedIn: 'root',
})
export class GameWebsocketService {
  private socket: WebSocket | null = null;
  private stateSubject = new Subject<GameState>();
  state$ = this.stateSubject.asObservable();

  private connectionStatusSubject = new BehaviorSubject<boolean>(false);
  connectionStatus$ = this.connectionStatusSubject.asObservable();

  private myId: string = 'player_' + Math.floor(Math.random() * 10000);
  private lobbyId: string = 'testlobby1';
  private reconnectInterval: number = 2000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;

  constructor() {}

  connect(lobbyId: string = 'testlobby1'): void {
    this.lobbyId = lobbyId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = '127.0.0.1:8001'; // User is running backend on 8001
    const url = `${protocol}//${host}/ws/game/${this.lobbyId}/`;

    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('WebSocket connected');
      this.connectionStatusSubject.next(true);
      this.reconnectAttempts = 0;
      this.send({ type: 'join', id: this.myId });
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'tick') {
        this.stateSubject.next(data);
      } else if (data.type === 'pong') {
        // Handle ping/pong if needed
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket disconnected');
      this.connectionStatusSubject.next(false);
      this.attemptReconnect();
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(this.lobbyId), this.reconnectInterval);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  send(data: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  sendInput(action: string, state: boolean): void {
    this.send({ type: 'input', action, state });
  }

  sendMouse(mouseX: number, mouseY: number, isFiring: boolean): void {
    this.send({ type: 'mouse', mouseX, mouseY, isFiring });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  getMyId(): string {
    return this.myId;
  }
}
