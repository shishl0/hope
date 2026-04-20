import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class ArenaMesh {
    readonly mash: THREE.Group;

    private readonly loader = new FBXLoader();
    private loadedModel?: THREE.Object3D;

    constructor(
        private readonly modelPath = '/3d_Models/arena-1.fbx',
        position = new THREE.Vector3(0, 0, 0),
        scale = new THREE.Vector3(1, 1, 1),
    ) {
        this.mash = new THREE.Group();
        this.mash.position.copy(position);
        this.mash.scale.copy(scale);
        this.loadModel();
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    dispose(): void {
        this.mash.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                this.disposeMaterial(object.material);
            }
        });
    }

    private loadModel(): void {
        this.loader.load(
            this.modelPath,
            model => {
                this.loadedModel = model;
                this.prepareModel(model);
                this.mash.add(model);
            },
            undefined,
            error => {
                console.error(`Could not load arena model: ${this.modelPath}`, error);
            },
        );
    }

    private prepareModel(model: THREE.Object3D): void {
        model.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.castShadow = false;
                object.receiveShadow = true;
            }
        });
    }

    private disposeMaterial(material: THREE.Material | THREE.Material[]): void {
        if (Array.isArray(material)) {
            material.forEach(item => item.dispose());
            return;
        }

        material.dispose();
    }
}
