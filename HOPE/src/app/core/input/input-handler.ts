import { Injectable } from '@angular/core';
import { BulletInput, PlayerInput, ProtoTankInput } from './player-input';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InputHandler {

  private inputState: PlayerInput = {
    forward: false,
    backward: false,
    rotateLeft: false,
    rotateRight: false,
    turretLeft: false,
    turretRight: false,
    fire: false,
    timestamp: Date.now(),
  };

  private inputStateSubject = new BehaviorSubject<PlayerInput>({ ...this.inputState });
  inputState$ = this.inputStateSubject.asObservable();

  private protoTankInputStateSubject = new BehaviorSubject<ProtoTankInput>(this.createProtoTankInput());
  protoTankInputState$ = this.protoTankInputStateSubject.asObservable();

  private bulletInputState: BulletInput = {
    fire: false,
    timestamp: Date.now(),
  };
  private bulletInputStateSubject = new BehaviorSubject<BulletInput>({ ...this.bulletInputState });
  bulletInputState$ = this.bulletInputStateSubject.asObservable();
  private bulletFireRequested = false;

  startListening(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  stopListening(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
  }

  private handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 0 && !this.inputState.fire) { // Left click
      this.inputState.fire = true;
      this.notifyChanges();
    }
  }

  private handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0 && this.inputState.fire) {
      this.inputState.fire = false;
      this.notifyChanges();
    }
  }

  private notifyChanges(): void {
    this.inputState.timestamp = Date.now();
    this.inputStateSubject.next({ ...this.inputState });
    this.protoTankInputStateSubject.next(this.createProtoTankInput());
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    let change = false;

    switch (event.code) {
      case 'KeyW':
        if (!this.inputState.forward) {
          this.inputState.forward = true;
          change = true;
        }
        break;
      case 'KeyS':
        if (!this.inputState.backward) {
          this.inputState.backward = true;
          change = true;
        }
        break;
      case 'KeyA':
        if (!this.inputState.rotateLeft) {
          this.inputState.rotateLeft = true;
          change = true;
        }
        break;
      case 'KeyD':
        if (!this.inputState.rotateRight) {
          this.inputState.rotateRight = true;
          change = true;
        }
        break;
      case 'KeyU':
        if (!this.inputState.turretLeft) {
          this.inputState.turretLeft = true;
          change = true;
        }
        break;
      case 'KeyI':
        if (!this.inputState.turretRight) {
          this.inputState.turretRight = true;
          change = true;
        }
        break;
      case 'Space':
        if (!this.inputState.fire) {
          this.inputState.fire = true;
          change = true;
        }
        event.preventDefault();
        break;
    }

    if (change) {
      this.notifyChanges();
    }

  }

  private handleKeyUp = (event: KeyboardEvent): void => {
    let change = false;

    switch (event.code) {
      case 'KeyW':
        if (this.inputState.forward) {
          this.inputState.forward = false;
          change = true;
        }
        break;
      case 'KeyS':
        if (this.inputState.backward) {
          this.inputState.backward = false;
          change = true;
        }
        break;
      case 'KeyA':
        if (this.inputState.rotateLeft) {
          this.inputState.rotateLeft = false;
          change = true;
        }
        break;
      case 'KeyD':
        if (this.inputState.rotateRight) {
          this.inputState.rotateRight = false;
          change = true;
        }
        break;
      case 'KeyU':
        if (this.inputState.turretLeft) {
          this.inputState.turretLeft = false;
          change = true;
        }
        break;
      case 'KeyI':
        if (this.inputState.turretRight) {
          this.inputState.turretRight = false;
          change = true;
        }
        break;
      case 'Space':
        if (this.inputState.fire) {
          this.inputState.fire = false;
          change = true;
        }
        event.preventDefault();
        break;
    }

    if (change) {
      this.notifyChanges();
    }

  }

  getSnapshot(): PlayerInput {
    return { ...this.inputState };
  }

  getInputObservable() {
    return this.inputState$;
  }

  getProtoTankSnapshot(): ProtoTankInput {
    return this.createProtoTankInput();
  }

  getProtoTankInputObservable() {
    return this.protoTankInputState$;
  }

  getBulletSnapshot(): BulletInput {
    return { ...this.bulletInputState };
  }

  getBulletInputObservable() {
    return this.bulletInputState$;
  }

  consumeBulletFireRequest(): boolean {
    const shouldFire = this.bulletFireRequested;
    this.bulletFireRequested = false;
    return shouldFire;
  }

  private createProtoTankInput(): ProtoTankInput {
    return {
      forward: this.inputState.forward,
      backward: this.inputState.backward,
      hullRotateLeft: this.inputState.rotateLeft,
      hullRotateRight: this.inputState.rotateRight,
      turretLeft: this.inputState.turretLeft,
      turretRight: this.inputState.turretRight,
      fire: this.inputState.fire,
      timestamp: this.inputState.timestamp,
    };
  }

}
