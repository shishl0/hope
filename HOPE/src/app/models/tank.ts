export interface TankStats {
  moveSpeed: number;
  maxHP: number;
  reloadSpeed: number;
  rotationSpeed: number;
  turretRotationSpeed: number;
  bulletSpeed: number;
  bulletDamage: number;
}

export interface Tank {
  id: number;
  name: string;
  side: string;
  description: string;
  bodyModelKey: string;
  turretModelKey: string;
  bulletModelKey: string;
  stats: TankStats;
}
