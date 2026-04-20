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

    // Sky/ground ambient fill — deep sky blue top, warm earthy bottom
    scene.add(this.createHemisphereLight(0x9dc8e8, 0x4a3728, 1.2));

    // Main sun — bright warm directional with high-res shadows
    this.sunLight = this.createDirectionalLight(0xfff5e0, 3.5, new THREE.Vector3(50, 80, 40));
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width  = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near   = 0.5;
    this.sunLight.shadow.camera.far    = 300;
    this.sunLight.shadow.camera.left   = -80;
    this.sunLight.shadow.camera.right  =  80;
    this.sunLight.shadow.camera.top    =  80;
    this.sunLight.shadow.camera.bottom = -80;
    this.sunLight.shadow.bias = -0.0003;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Warm fill light from the opposite side — softens harsh shadows
    const fillLight = this.createDirectionalLight(0xffe4b0, 1.0, new THREE.Vector3(-40, 30, -30));
    scene.add(fillLight);

    // Cool rim/back light for depth and silhouette separation
    const rimLight = this.createDirectionalLight(0x9bc8ff, 0.6, new THREE.Vector3(-10, 10, -50));
    scene.add(rimLight);

    // Subtle ambient so no surface is completely black
    scene.add(this.createAmbientLight(0xffffff, 0.18));
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
