import asyncio
import time
import math
import random

TPS = 30
TICK_INTERVAL = 1.0 / TPS
MAP_WIDTH = 2000
MAP_HEIGHT = 2000
TANK_RADIUS = 15
BULLET_SIZE = 5

MAX_SPEED_FWD = 150
MAX_SPEED_BWD = 75
HULL_ROTATION_SPEED = 2.0
TURRET_ROTATION_SPEED = 1.5

def normalize_angle(angle):
    """Normalize angle to [-pi, pi]"""
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle

class GameRoom:
    def __init__(self, lobby_id, channel_layer):
        self.lobby_id = lobby_id
        self.channel_layer = channel_layer
        self.group_name = f'game_{self.lobby_id}'
        self.players = {}  # { player_id: dict_of_state }
        self.bullets = []
        self.is_running = True
        self.loop_task = asyncio.create_task(self.game_loop())

    async def add_player(self, player_id):
        self.players[player_id] = {
            'x': random.uniform(50, MAP_WIDTH - 50),
            'y': random.uniform(50, MAP_HEIGHT - 50),
            'hull_angle': 0.0,
            'turret_angle': 0.0,
            'color': f"hsl({random.uniform(0, 360)}, 80%, 50%)",
            'hp': 500,
            'maxHp': 500,
            'isDead': False,
            'isSafe': True,
            'respawnTimer': 0,
            'inputs': {'up': False, 'down': False, 'left': False, 'right': False},
            'mouseX': 0,
            'mouseY': 0,
            'isFiring': False,
            'lastShootTime': 0
        }

    async def remove_player(self, player_id):
        if player_id in self.players:
            del self.players[player_id]

    async def handle_input(self, player_id, data):
        if player_id not in self.players:
            return
        
        p = self.players[player_id]
        if data['type'] == 'input':
            action = data['action']
            state = data['state']
            if action in p['inputs']:
                p['inputs'][action] = state
        elif data['type'] == 'mouse':
            p['isFiring'] = data['isFiring']
            p['mouseX'] = data['mouseX']
            p['mouseY'] = data['mouseY']
        elif data['type'] == 'ping':
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'game_message',
                    'message': {'type': 'pong', 'id': player_id, 'client_time': data.get('time')}
                }
            )

    def check_circle_collision(self, c1, c2):
        # c = {x, y, r}
        dist_sq = (c1['x'] - c2['x'])**2 + (c1['y'] - c2['y'])**2
        rad_sq = (c1['r'] + c2['r'])**2
        return dist_sq < rad_sq

    def check_aabb_circle_collision(self, rect, circle):
        # rect = {x, y, w, h} (center), circle = {x, y, r}
        rx = rect['x'] - rect['w']/2
        ry = rect['y'] - rect['h']/2
        
        testX = circle['x']
        testY = circle['y']
        
        if circle['x'] < rx: testX = rx
        elif circle['x'] > rx + rect['w']: testX = rx + rect['w']
        
        if circle['y'] < ry: testY = ry
        elif circle['y'] > ry + rect['h']: testY = ry + rect['h']
        
        distX = circle['x'] - testX
        distY = circle['y'] - testY
        distance = math.sqrt((distX*distX) + (distY*distY))
        
        return distance <= circle['r']

    async def game_loop(self):
        last_time = time.time()
        
        while self.is_running:
            current_time = time.time()
            dt = current_time - last_time
            last_time = current_time
            
            # 1. Update players
            for pid, p in self.players.items():
                if p['isDead']:
                    p['respawnTimer'] -= dt
                    if p['respawnTimer'] <= 0:
                        p['isDead'] = False
                        p['isSafe'] = True
                        p['hp'] = p['maxHp']
                        p['x'] = random.uniform(50, MAP_WIDTH - 50)
                        p['y'] = random.uniform(50, MAP_HEIGHT - 50)
                        p['inputs'] = {'up': False, 'down': False, 'left': False, 'right': False}
                    continue

                moved = False

                # Hull Rotation
                if p['inputs']['left']:
                    p['hull_angle'] -= HULL_ROTATION_SPEED * dt
                    moved = True
                if p['inputs']['right']:
                    p['hull_angle'] += HULL_ROTATION_SPEED * dt
                    moved = True
                
                # Normalize hull angle
                p['hull_angle'] = normalize_angle(p['hull_angle'])

                # Movement Fwd/Bwd
                new_x, new_y = p['x'], p['y']
                if p['inputs']['up']:
                    new_x += math.cos(p['hull_angle']) * MAX_SPEED_FWD * dt
                    new_y += math.sin(p['hull_angle']) * MAX_SPEED_FWD * dt
                    moved = True
                if p['inputs']['down']:
                    new_x -= math.cos(p['hull_angle']) * MAX_SPEED_BWD * dt
                    new_y -= math.sin(p['hull_angle']) * MAX_SPEED_BWD * dt
                    moved = True

                if moved and p['isSafe']:
                    p['isSafe'] = False

                # Map bounds collision
                new_x = max(TANK_RADIUS, min(MAP_WIDTH - TANK_RADIUS, new_x))
                new_y = max(TANK_RADIUS, min(MAP_HEIGHT - TANK_RADIUS, new_y))

                # Tank vs Tank collision
                circle_me = {'x': new_x, 'y': new_y, 'r': TANK_RADIUS}
                collision = False
                for other_id, other_p in self.players.items():
                    if pid == other_id or other_p['isDead']: continue
                    circle_other = {'x': other_p['x'], 'y': other_p['y'], 'r': TANK_RADIUS}
                    if self.check_circle_collision(circle_me, circle_other):
                        collision = True
                        break
                
                if not collision:
                    p['x'] = new_x
                    p['y'] = new_y

                # Turret Rotation
                target_angle = math.atan2(p['mouseY'] - p['y'], p['mouseX'] - p['x'])
                angle_diff = normalize_angle(target_angle - p['turret_angle'])
                # Move towards target angle
                rot_step = TURRET_ROTATION_SPEED * dt
                if abs(angle_diff) <= rot_step:
                    p['turret_angle'] = target_angle
                else:
                    p['turret_angle'] += math.copysign(rot_step, angle_diff)
                p['turret_angle'] = normalize_angle(p['turret_angle'])

                # Shooting
                if p['isFiring'] and current_time - p['lastShootTime'] > 0.1: # 100ms interval
                    p['lastShootTime'] = current_time
                    p['isSafe'] = False
                    
                    vx = math.cos(p['turret_angle']) * 600
                    vy = math.sin(p['turret_angle']) * 600
                    
                    # Spawn bullet slightly ahead of tank center
                    bx = p['x'] + math.cos(p['turret_angle']) * TANK_RADIUS
                    by = p['y'] + math.sin(p['turret_angle']) * TANK_RADIUS

                    self.bullets.append({
                        'id': f"{pid}_{current_time}",
                        'owner_id': pid,
                        'x': bx,
                        'y': by,
                        'vx': vx,
                        'vy': vy
                    })

            # 2. Update bullets
            alive_bullets = []
            for b in self.bullets:
                b['x'] += b['vx'] * dt
                b['y'] += b['vy'] * dt

                if b['x'] < 0 or b['x'] > MAP_WIDTH or b['y'] < 0 or b['y'] > MAP_HEIGHT:
                    continue # despawn

                hit = False
                bullet_rect = {'x': b['x'], 'y': b['y'], 'w': BULLET_SIZE, 'h': BULLET_SIZE}
                
                for pid, p in self.players.items():
                    if p['isDead'] or p['isSafe'] or b['owner_id'] == pid:
                        continue
                    
                    player_circle = {'x': p['x'], 'y': p['y'], 'r': TANK_RADIUS}
                    if self.check_aabb_circle_collision(bullet_rect, player_circle):
                        hit = True
                        p['hp'] -= 100
                        if p['hp'] <= 0:
                            p['hp'] = 0
                            p['isDead'] = True
                            p['respawnTimer'] = 3.0
                            p['inputs'] = {'up': False, 'down': False, 'left': False, 'right': False}
                            p['isFiring'] = False
                        break
                
                if not hit:
                    alive_bullets.append(b)
            
            self.bullets = alive_bullets

            # 3. Broadcast state
            state = {
                'type': 'tick',
                'players': { pid: {k: v for k, v in p.items() if k not in ['inputs', 'lastShootTime']} for pid, p in self.players.items() },
                'bullets': self.bullets,
                'map': {'w': MAP_WIDTH, 'h': MAP_HEIGHT}
            }
            
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'game_message',
                    'message': state
                }
            )

            elapsed = time.time() - current_time
            await asyncio.sleep(max(0, TICK_INTERVAL - elapsed))

    def stop(self):
        self.is_running = False
        if self.loop_task:
            self.loop_task.cancel()
