export interface Vector3Dto {
    x: number;
    y: number;
    z: number;
}

export interface CollisionObjectDto {
    id: string;
    position: Vector3Dto;
    rotation: Vector3Dto;
    size: Vector3Dto;
}

export interface MoveRequestDto {
    forward: boolean;
    backward: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    player: CollisionObjectDto;
    obstacles: CollisionObjectDto[];
}

export interface MoveResponseDto {
    position: Vector3Dto;
    rotation: Vector3Dto;
    collided: boolean;
}
