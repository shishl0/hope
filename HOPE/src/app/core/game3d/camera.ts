import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root',
})
export class CameraService {

  private camera!: THREE.PerspectiveCamera;
  private followOffset: THREE.Vector3 = new THREE.Vector3(0, 5, -10);
  private turretFollowHeight = 5;
  private turretFollowDistance = 10;
  private lerpAlpha: number = 0.1;

  init(aspect: number): THREE.PerspectiveCamera {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 2000);
    this.camera.position.set(0, 1.5, 2.1);
    this.camera.rotateX(-0.3); // Slightly tilt the camera downwards
    return this.camera;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  setFollowOffset(offset: THREE.Vector3): void {
    // This method can be used to set an offset for the camera to follow a target
    this.followOffset.add(offset);
  }

  setLerpAlpha(alpha: number): void {
    // This method can be used to set the alpha value for smooth camera transitions
    this.lerpAlpha = alpha;
  }

  follow(targetPosition: THREE.Vector3): void {
    if (!this.camera) {
      console.warn('Camera not initialized yet. Call init() before following a target.');
      return;
    }

    // Calculate the desired camera position based on the target position and follow offset
    const desiredPosition = new THREE.Vector3().addVectors(targetPosition, this.followOffset);

    // Smoothly interpolate the camera's current position towards the desired position
    this.camera.position.lerp(desiredPosition, this.lerpAlpha);

    // Optionally, you can also make the camera look at the target
    this.camera.lookAt(targetPosition);

  }

  followTurretPivot(turretPosition: THREE.Vector3, turretYaw: number): void {
    if (!this.camera) {
      console.warn('Camera not initialized yet. Call init() before following a turret.');
      return;
    }

    const backwardFromTurret = new THREE.Vector3(
      -Math.sin(turretYaw) * this.turretFollowDistance,
      this.turretFollowHeight,
      -Math.cos(turretYaw) * this.turretFollowDistance,
    );
    const desiredPosition = new THREE.Vector3().addVectors(turretPosition, backwardFromTurret);
    const lookTarget = turretPosition.clone();
    lookTarget.y += 0.4;

    this.camera.position.lerp(desiredPosition, this.lerpAlpha);
    this.camera.lookAt(lookTarget);
  }

  onResize ( aspect: number ): void {
    if (this.camera) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    } else {
      console.warn('Camera not initialized yet. Call init() before resizing.');
    }
  }
}
