import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root',
})
export class LightService {
  private sunLight!: THREE.DirectionalLight;
  
  createDirectionalLight(color: number, intensity: number, position: THREE.Vector3): THREE.DirectionalLight {
    const directionalLight = new THREE.DirectionalLight(color, intensity);
    directionalLight.position.copy(position);
    return directionalLight;
  }

  createPointLight(color: number, intensity: number, position: THREE.Vector3): THREE.PointLight {
    const pointLight = new THREE.PointLight(color, intensity);
    pointLight.position.copy(position);
    return pointLight;
  }

  createAmbientLight(color: number, intensity: number): THREE.AmbientLight {
    return new THREE.AmbientLight(color, intensity);
  }

  createSpotLight(color: number, intensity: number, position: THREE.Vector3, target: THREE.Vector3): THREE.SpotLight {
    const spotLight = new THREE.SpotLight(color, intensity);
    spotLight.position.copy(position);
    spotLight.target.position.copy(target);
    return spotLight;
  }

  createHemisphereLight(skyColor: number, groundColor: number, intensity: number): THREE.HemisphereLight {
    return new THREE.HemisphereLight(skyColor, groundColor, intensity);
  }

  createRectAreaLight(color: number, intensity: number, width: number, height: number, position: THREE.Vector3): THREE.RectAreaLight {
    const rectAreaLight = new THREE.RectAreaLight(color, intensity, width, height);
    rectAreaLight.position.copy(position);
    return rectAreaLight;
  }

  createDirectionalLightHelper(light: THREE.DirectionalLight, size: number): THREE.DirectionalLightHelper {
    return new THREE.DirectionalLightHelper(light, size);
  }

  createPointLightHelper(light: THREE.PointLight, size: number): THREE.PointLightHelper {
    return new THREE.PointLightHelper(light, size);
  }

  createSpotLightHelper(light: THREE.SpotLight): THREE.SpotLightHelper {
    return new THREE.SpotLightHelper(light);
  }

  createHemisphereLightHelper(light: THREE.HemisphereLight, size: number): THREE.HemisphereLightHelper {
    return new THREE.HemisphereLightHelper(light, size);
  } 

  createSunLight(scene: THREE.Scene): void {
    // Sky/ground ambient fill — deep golden sky top, warm earthy bottom
    scene.add(this.createHemisphereLight(0xfff5e0, 0x4a3728, 1.5));

    // Main sun — very bright warm golden directional
    this.sunLight = this.createDirectionalLight(0xffe4b0, 4.0, new THREE.Vector3(60, 90, 50));
    this.sunLight.target.position.set(-10, 0, -10); // Targeted at world center
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width  = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near   = 0.5;
    this.sunLight.shadow.camera.far    = 400;
    this.sunLight.shadow.camera.left   = -150;
    this.sunLight.shadow.camera.right  =  150;
    this.sunLight.shadow.camera.top    =  150;
    this.sunLight.shadow.camera.bottom = -150;
    this.sunLight.shadow.bias = -0.0005;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    const backFill = this.createDirectionalLight(0xffe4b0, 1.0, new THREE.Vector3(-10, 5, -10));
    const sideFill = this.createDirectionalLight(0xffcc88, 1.5, new THREE.Vector3(15, 8, 5));
    scene.add(backFill, sideFill);

    // Cool rim light for depth
    const rimLight = this.createDirectionalLight(0x88ccff, 0.8, new THREE.Vector3(-10, 10, -50));
    scene.add(rimLight);

    scene.add(this.createAmbientLight(0xffffff, 0.2));
  }

  updateSunLightPosition(position: THREE.Vector3): void {
    if (this.sunLight) {
      this.sunLight.position.copy(position);
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before updating its position.');
    }
  }

  setSunLightIntensity(intensity: number): void {
    if (this.sunLight) {
      this.sunLight.intensity = intensity;
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its intensity.');
    }
  }

  setSunLightColor(color: number): void {
    if (this.sunLight) {
      this.sunLight.color.setHex(color);
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its color.');
    } 
  }

  setSunLightDirection(direction: THREE.Vector3): void {
    if (this.sunLight) {
      this.sunLight.position.copy(direction);
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its direction.');
    } 
  }

  setSunLightShadowProperties(mapSize: { width: number; height: number }, cameraSettings: { near: number; far: number; left: number; right: number; top: number; bottom: number }): void {
    if (this.sunLight) {
      this.sunLight.shadow.mapSize.width = mapSize.width; 
      this.sunLight.shadow.mapSize.height = mapSize.height;
      this.sunLight.shadow.camera.near = cameraSettings.near;
      this.sunLight.shadow.camera.far = cameraSettings.far;
      this.sunLight.shadow.camera.left = cameraSettings.left;
      this.sunLight.shadow.camera.right = cameraSettings.right;
      this.sunLight.shadow.camera.top = cameraSettings.top;
      this.sunLight.shadow.camera.bottom = cameraSettings.bottom;
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its shadow properties.');
    }
  
  }

  setSunLightCastShadow(castShadow: boolean): void {
    if (this.sunLight) {
      this.sunLight.castShadow = castShadow;
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its shadow casting property.');
    } 
  }

  setSunLightShadowMapSize(width: number, height: number): void {
    if (this.sunLight) {
      this.sunLight.shadow.mapSize.width = width;
      this.sunLight.shadow.mapSize.height = height;
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its shadow map size.');
    } 
  }

  setSunLightShadowCameraSettings(near: number, far: number, left: number, right: number, top: number, bottom: number): void {
    if (this.sunLight) {
      this.sunLight.shadow.camera.near = near;
      this.sunLight.shadow.camera.far = far;
      this.sunLight.shadow.camera.left = left;
      this.sunLight.shadow.camera.right = right;
      this.sunLight.shadow.camera.top = top;
      this.sunLight.shadow.camera.bottom = bottom;
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its shadow camera settings.');
    } 
  }

  setSunlighttarget(target: THREE.Vector3): void {
    if (this.sunLight) {
      this.sunLight.target.position.copy(target);
    } else {
      console.warn('Sun light not initialized yet. Call createSunLight() before setting its target.');
    } 
  }

}
