import json
import asyncio
import math
import random
from channels.generic.websocket import AsyncWebsocketConsumer
from .engine import GameRoom
from .collision import object_collides

ACTIVE_ROOMS = {}
PROTO_ROOMS = {}

# ─────────────────────────────────────────────────────────────────
#  2D Multiplayer Consumer (unchanged)
# ─────────────────────────────────────────────────────────────────

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lobby_id = self.scope['url_route']['kwargs']['lobby_id']
        self.lobby_group_name = f'game_{self.lobby_id}'
        self.player_id = None
        if self.lobby_id not in ACTIVE_ROOMS:
            ACTIVE_ROOMS[self.lobby_id] = GameRoom(self.lobby_id, self.channel_layer)
        await self.channel_layer.group_add(self.lobby_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.player_id:
            room = ACTIVE_ROOMS.get(self.lobby_id)
            if room:
                await room.remove_player(self.player_id)
                if not room.players:
                    room.stop()
                    del ACTIVE_ROOMS[self.lobby_id]
        await self.channel_layer.group_discard(self.lobby_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        event_type = data.get('type')
        room = ACTIVE_ROOMS.get(self.lobby_id)
        if not room:
            return
        if event_type == 'join':
            self.player_id = data.get('id')
            await room.add_player(self.player_id)
        elif event_type in ['input', 'mouse']:
            if self.player_id:
                await room.handle_input(self.player_id, data)

    async def game_message(self, event):
        await self.send(text_data=json.dumps(event['message']))


# ─────────────────────────────────────────────────────────────────
#  3D ProtoTank Multiplayer
# ─────────────────────────────────────────────────────────────────

TPS = 20
DT  = 1.0 / TPS   # seconds per tick

def _norm(a: float) -> float:
    """Normalise angle to (-π, π]."""
    a %= 2 * math.pi
    if a > math.pi:
        a -= 2 * math.pi
    return a

def _get_obb_corners(pos_x, pos_z, rot_y, width, length):
    w, l = width / 2.0, length / 2.0
    c, s = math.cos(rot_y), math.sin(rot_y)
    return [
        (pos_x + w*c - l*s, pos_z + w*s + l*c),
        (pos_x - w*c - l*s, pos_z - w*s + l*c),
        (pos_x - w*c + l*s, pos_z - w*s - l*c),
        (pos_x + w*c + l*s, pos_z + w*s - l*c)
    ]

def _get_axes(corners):
    axes = []
    for i in range(len(corners)):
        p1 = corners[i]
        p2 = corners[(i + 1) % len(corners)]
        edge = (p2[0] - p1[0], p2[1] - p1[1])
        normal = (-edge[1], edge[0])
        length = math.hypot(normal[0], normal[1])
        if length > 0.0001:
            axes.append((normal[0] / length, normal[1] / length))
    return axes

def _sat_overlap_mtv(corners_a, corners_b):
    overlap = float('inf')
    mtv = None
    axes = _get_axes(corners_a) + _get_axes(corners_b)
    
    for axis in axes:
        min_a = min_b = float('inf')
        max_a = max_b = float('-inf')
        for p in corners_a:
            dot = p[0] * axis[0] + p[1] * axis[1]
            min_a = min(min_a, dot); max_a = max(max_a, dot)
        for p in corners_b:
            dot = p[0] * axis[0] + p[1] * axis[1]
            min_b = min(min_b, dot); max_b = max(max_b, dot)
            
        if max_a < min_b or max_b < min_a:
            return False, None
            
        o = min(max_a - min_b, max_b - min_a)
        if o < overlap:
            overlap = o
            cx_a = sum(p[0] for p in corners_a) / 4
            cz_a = sum(p[1] for p in corners_a) / 4
            cx_b = sum(p[0] for p in corners_b) / 4
            cz_b = sum(p[1] for p in corners_b) / 4
            dx, dz = cx_a - cx_b, cz_a - cz_b
            if (dx * axis[0] + dz * axis[1]) < 0:
                mtv = (-axis[0] * o, -axis[1] * o)
            else:
                mtv = (axis[0] * o, axis[1] * o)
                
    return True, mtv
_TANK_CONFIGS = {
    't34': {'size': [3.4, 0.7, 7.0]},
    'pz4': {'size': [3.0, 0.7, 7.0]},
}
_DEFAULT_TANK_SIZE = [2.5, 0.7, 5.0]

MAX_V_FWD  = 85.0  / 3.6 * DT
MAX_V_BWD  = 30.0  / 3.6 * DT
ACCEL_BASE_FWD = 0.0042
ACCEL_BASE_BWD = 0.0036
ACCEL_EXP      = 0.55
FRICTION = 0.0054
BRAKE_FORCE = 0.0195
TURRET_SPD = 0.035
TURN_SLOW = 0.065
TURN_FAST = 0.140
TURN_EXP  = 0.6
PROTO_BULLET_SPEED = 12.0
WORLD_MIN = -110.0
WORLD_MAX  =  90.0


class ProtoTankRoom:
    def __init__(self, room_id, channel_layer):
        self.room_id = room_id
        self.channel_layer = channel_layer
        self.group_name = f'prototank_{room_id}'
        
        self.players = {}  # channel_name -> state
        self.bullets = []  # [bx, bz, vx, vz, owner_channel]
        
        self.game_mode = 'ffa' # can be 'ffa' or 'team'
        
        self._running = True
        self._loop_task = asyncio.create_task(self._game_loop())

    async def add_player(self, channel_name):
        self.players[channel_name] = {
            'id': channel_name,  # Unique ID for front-end tracking
            'pos': [0.0, 0.35, 0.0],
            'rot_y': 0.0,
            'rot_v': 0.0,
            'vel_x': 0.0, 'vel_z': 0.0,
            'turr_y': 0.0,
            'hp': 100,
            'is_dead': False,
            'respawn_timer': 0.0,
            'tank_type': 't34',
            'at_wall': False,
            'reload_timer': 0.0,
            'inp': {
                'forward': False, 'backward': False,
                'hullRotateLeft': False, 'hullRotateRight': False,
                'turretLeft': False, 'turretRight': False,
                'fire': False,
            },
            'team': None,
            'color': random.randint(0, 0xffffff)
        }
        self._assign_team_and_spawn(channel_name)

    async def remove_player(self, channel_name):
        if channel_name in self.players:
            del self.players[channel_name]
        
        if not self.players:
            self.stop()

    def stop(self):
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()

    def update_input(self, channel_name, data):
        if channel_name in self.players:
            for key in self.players[channel_name]['inp']:
                if key in data:
                    self.players[channel_name]['inp'][key] = bool(data[key])

    def update_tank_type(self, channel_name, tank_type):
        if channel_name in self.players and tank_type in _TANK_CONFIGS:
            self.players[channel_name]['tank_type'] = tank_type

    def change_mode(self, mode):
        if mode in ['ffa', 'team']:
            self.game_mode = mode
            for p_id in self.players:
                self.players[p_id]['hp'] = 100
                self.players[p_id]['is_dead'] = False
                self._assign_team_and_spawn(p_id)

    def _assign_team_and_spawn(self, p_id):
        p = self.players[p_id]
        if self.game_mode == 'team':
            # Count teams
            r_count = sum(1 for pl in self.players.values() if pl['team'] == 'red')
            b_count = sum(1 for pl in self.players.values() if pl['team'] == 'blue')
            if r_count <= b_count and r_count < 5:
                p['team'] = 'red'
            elif b_count < 5:
                p['team'] = 'blue'
            else:
                p['team'] = 'red' # fallback
        else:
            p['team'] = None
        
        self._spawn_player(p)

    def _spawn_player(self, p):
        # find safe spot
        p['vel_x'] = 0.0
        p['vel_z'] = 0.0
        p['rot_v'] = 0.0
        
        for _ in range(50): # max attempts
            if self.game_mode == 'team':
                if p['team'] == 'red':
                    # Bottom-Left corner
                    px = -40 + random.random() * 10
                    pz = -40 + random.random() * 10
                    py_rot = math.pi / 4 # 45 deg, facing center
                else:
                    # Top-Right corner
                    px = 30 + random.random() * 10
                    pz = 30 + random.random() * 10
                    py_rot = -3 * math.pi / 4 # -135 deg, facing center
            else:
                px = (random.random() - 0.5) * 80
                pz = (random.random() - 0.5) * 80
                py_rot = random.random() * math.pi * 2
            
            # Distance check against all alive players to avoid overlap
            collides = False
            for other_id, other_p in self.players.items():
                if other_id != p['id'] and not other_p['is_dead']:
                    dx = px - other_p['pos'][0]
                    dz = pz - other_p['pos'][2]
                    if math.hypot(dx, dz) < 6.0: # ~6 meter safe zone
                        collides = True
                        break
            
            if not collides:
                p['pos'] = [px, 0.35, pz]
                p['rot_y'] = py_rot
                p['turr_y'] = 0.0
                return
        
        # fallback if crowded
        p['pos'] = [0, 0.35, 0]
        p['rot_y'] = 0.0

    async def _game_loop(self):
        loop = asyncio.get_event_loop()
        next_tick = loop.time()

        while self._running:
            self._tick()
            
            # Pack payload
            flat_players = []
            for p_id, p in self.players.items():
                speed = math.hypot(p['vel_x'], p['vel_z'])
                speed_kmh = speed / DT * 3.6
                flat_players.append({
                    'id': p_id,
                    'x': round(p['pos'][0], 3),
                    'z': round(p['pos'][2], 3),
                    'ry': round(p['rot_y'], 4),
                    'ty': round(p['turr_y'], 4),
                    'skin': p['tank_type'],
                    'hp': p['hp'],
                    'dead': 1 if p['is_dead'] else 0,
                    'sp': round(speed_kmh, 1),
                    'w': 1 if p['at_wall'] else 0,
                    'rld': round(p['reload_timer'], 1),
                    'c': p['color']
                })

            # Bullets payload now includes vx, vz for client-side extrapolation!
            flat_bullets = [[round(b[0], 2), round(b[1], 2), round(b[2], 2), round(b[3], 2)] for b in self.bullets]

            payload = {
                'type': 'game_message',
                'message': [flat_players, flat_bullets]
            }
            
            try:
                await self.channel_layer.group_send(self.group_name, payload)
            except Exception:
                pass

            next_tick += DT
            sleep_time = next_tick - loop.time()
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            else:
                if sleep_time < -1.0:
                    next_tick = loop.time()

    def _tick(self):
        alive_bullets = []
        for b in self.bullets:
            bx, bz, vx, vz, owner = b
            hit = False
            
            # Sub-step 6 times to prevent bullets from tunneling through tanks/walls at high speeds
            for _step in range(6):
                bx += vx / 6.0
                bz += vz / 6.0

                if not (WORLD_MIN <= bx <= WORLD_MAX and WORLD_MIN <= bz <= WORLD_MAX):
                    hit = True
                    break
                
                if hit: break

                # Hit check against tanks (OBB 2D ignoring Height/Y)
                for p_id, p in self.players.items():
                    if p_id == owner:
                        continue
                    px, pz = p['pos'][0], p['pos'][2]
                    
                    dx = bx - px
                    dz = bz - pz
                    
                    # Transform bullet relative position by inverse of tank rotation
                    rot = p['rot_y']
                    cos_r, sin_r = math.cos(rot), math.sin(rot)
                    local_x = dx * cos_r - dz * sin_r
                    local_z = dx * sin_r + dz * cos_r

                    t_size = _TANK_CONFIGS.get(p['tank_type'], {}).get('size', _DEFAULT_TANK_SIZE)
                    hw_x, hw_z = t_size[0]/2, t_size[2]/2
                    if -hw_x <= local_x <= hw_x and -hw_z <= local_z <= hw_z:
                        if not p['is_dead']:
                            hit = True
                            p['hp'] -= 25
                            if p['hp'] <= 0:
                                p['is_dead'] = True
                                p['hp'] = 0
                                p['vel_x'] = 0.0
                                p['vel_z'] = 0.0
                                p['respawn_timer'] = 5.0
                        break
                
                if hit: break

            if not hit:
                alive_bullets.append([bx, bz, vx, vz, owner])

        self.bullets = alive_bullets

        # Process each player
        for p_id, p in self.players.items():
            if p['is_dead']:
                p['respawn_timer'] -= DT
                if p['respawn_timer'] <= 0:
                    p['is_dead'] = False
                    p['hp'] = 100
                    self._spawn_player(p)
                continue

            inp = p['inp']
            fwd, bwd = inp['forward'], inp['backward']
            speed = math.hypot(p['vel_x'], p['vel_z'])

            speed_ratio = min(speed / MAX_V_FWD, 1.0)
            turn_rate   = TURN_SLOW + (TURN_FAST - TURN_SLOW) * (speed_ratio ** TURN_EXP)
            rot_accel = turn_rate * 0.15

            if inp['hullRotateLeft']:
                p['rot_v'] += rot_accel
            elif inp['hullRotateRight']:
                p['rot_v'] -= rot_accel
            else:
                p['rot_v'] *= 0.82
                if abs(p['rot_v']) < 0.0001:
                    p['rot_v'] = 0.0

            p['rot_v'] = max(-turn_rate, min(turn_rate, p['rot_v']))
            p['rot_y'] = _norm(p['rot_y'] + p['rot_v'])

            if inp['turretLeft']:
                p['turr_y'] += TURRET_SPD
            if inp['turretRight']:
                p['turr_y'] -= TURRET_SPD
            p['turr_y'] = _norm(p['turr_y'])

            heading_x, heading_z = math.sin(p['rot_y']), math.cos(p['rot_y'])
            v_fwd = p['vel_x'] * heading_x + p['vel_z'] * heading_z
            v_lat = p['vel_x'] * heading_z - p['vel_z'] * heading_x

            if fwd and not bwd:
                if v_fwd >= 0:
                    taper = max(0.0, 1.0 - (v_fwd / MAX_V_FWD)) ** ACCEL_EXP
                    v_fwd = min(v_fwd + ACCEL_BASE_FWD * taper, MAX_V_FWD)
                else:
                    v_fwd = min(0.0, v_fwd + BRAKE_FORCE)
            elif bwd and not fwd:
                if v_fwd <= 0:
                    taper = max(0.0, 1.0 - (abs(v_fwd) / MAX_V_BWD)) ** ACCEL_EXP
                    v_fwd = max(v_fwd - ACCEL_BASE_BWD * taper, -MAX_V_BWD)
                else:
                    v_fwd = max(0.0, v_fwd - BRAKE_FORCE)
            else:
                if v_fwd > 0: v_fwd = max(0.0, v_fwd - FRICTION)
                elif v_fwd < 0: v_fwd = min(0.0, v_fwd + FRICTION)

            drift_factor = 0.82
            if speed_ratio > 0.45 and abs(p['rot_v']) > turn_rate * 0.4:
                drift_factor = 0.96
            v_lat *= drift_factor

            p['vel_x'] = v_fwd * heading_x + v_lat * heading_z
            p['vel_z'] = v_fwd * heading_z - v_lat * heading_x

            if speed > 1e-7:
                prev_x, prev_z = p['pos'][0], p['pos'][2]
                p['pos'][0] += p['vel_x']
                p['pos'][2] += p['vel_z']

                tank_candidate = {
                    'id': p_id,
                    'position': p['pos'][:],
                    'rotation': [0.0, p['rot_y'], 0.0],
                    'size': _TANK_CONFIGS.get(p['tank_type'], {}).get('size', _DEFAULT_TANK_SIZE),
                }
                
                # Check walls
                t_size = tank_candidate['size']
                hw_x, hw_z = t_size[0] / 2, t_size[2] / 2
                lo, hi = WORLD_MIN, WORLD_MAX
                cx = max(lo + hw_x, min(hi - hw_x, p['pos'][0]))
                cz = max(lo + hw_z, min(hi - hw_z, p['pos'][2]))
                p['at_wall'] = (cx != p['pos'][0] or cz != p['pos'][2])

                if p['at_wall']:
                    p['pos'][0], p['pos'][2] = cx, cz
                    p['vel_x'] *= 0.1
                    p['vel_z'] *= 0.1

                # Tank-to-Tank Collisions (Simple 2D Circle Approximation)
                # Use combined radius 3.5m.
                tank_collided = False
                for other_id, other_p in self.players.items():
                    if other_id != p_id and not other_p['is_dead']:
                        dx = p['pos'][0] - other_p['pos'][0]
                        dz = p['pos'][2] - other_p['pos'][2]
                        if math.hypot(dx, dz) < 3.5:
                            tank_collided = True
                            break
                if tank_collided:
                    p['pos'][0], p['pos'][2] = prev_x, prev_z
                    p['vel_x'], p['vel_z'] = 0.0, 0.0

            # Fire Mechanics Setup
            if p['reload_timer'] > 0:
                p['reload_timer'] = max(0.0, p['reload_timer'] - DT)

            if inp['fire'] and p['reload_timer'] == 0:
                p['reload_timer'] = 7.0
                # Use WORLD rotation of the turret (tank hull + local turret)
                world_turr = p['rot_y'] + p['turr_y']
                bx = p['pos'][0] + math.sin(world_turr) * 1.5
                bz = p['pos'][2] + math.cos(world_turr) * 1.5
                vx = math.sin(world_turr) * PROTO_BULLET_SPEED
                vz = math.cos(world_turr) * PROTO_BULLET_SPEED
                self.bullets.append([bx, bz, vx, vz, p_id])


class ProtoTankConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lobby_id = self.scope['url_route']['kwargs']['session_id']
        self.group_name = f'prototank_{self.lobby_id}'
        self.player_id = self.channel_name
        
        if self.lobby_id not in PROTO_ROOMS:
            PROTO_ROOMS[self.lobby_id] = ProtoTankRoom(self.lobby_id, self.channel_layer)
        
        room = PROTO_ROOMS[self.lobby_id]
        await room.add_player(self.player_id)
        
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send ID to the client
        await self.send(text_data=json.dumps({'type': 'init', 'id': self.player_id}))

    async def disconnect(self, close_code):
        room = PROTO_ROOMS.get(self.lobby_id)
        if room:
            await room.remove_player(self.player_id)
            if not room.players:
                del PROTO_ROOMS[self.lobby_id]
        
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, ValueError):
            return

        t = data.get('type')
        room = PROTO_ROOMS.get(self.lobby_id)

        if not room:
            return

        if t == 'input':
            room.update_input(self.player_id, data)
        elif t == 'change_tank':
            room.update_tank_type(self.player_id, data.get('tank_type'))
        elif t == 'change_mode':
            room.change_mode(data.get('mode'))
        elif t == 'ping':
            await self.send(text_data=json.dumps({
                'type': 'pong',
                'client_time': data.get('client_time', 0),
            }))

    async def game_message(self, event):
        await self.send(text_data=json.dumps(event['message']))
