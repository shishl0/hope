import json
import asyncio
import math
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

_OBSTACLES: dict = {
    'obstacle-1': {'id': 'obstacle-1', 'position': [0.0, 0.5, 5.0],  'rotation': [0.0, 0.0, 0.0], 'size': [2.0, 1.0, 2.0]},
    'obstacle-2': {'id': 'obstacle-2', 'position': [4.0, 0.5, 2.0],  'rotation': [0.0, 0.0, 0.0], 'size': [2.0, 1.0, 2.0]},
}

_TANK_SIZE = [1.6, 0.7, 2.4]

MAX_V_FWD  = 85.0  / 3.6 * DT
MAX_V_BWD  = 30.0  / 3.6 * DT
ACCEL_BASE_FWD = 0.0042
ACCEL_BASE_BWD = 0.0036
ACCEL_EXP      = 0.55
FRICTION = 0.0054
BRAKE_FORCE = 0.0195
TURRET_SPD = 0.12
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
            'at_wall': False,
            'reload_timer': 0.0,
            'inp': {
                'forward': False, 'backward': False,
                'hullRotateLeft': False, 'hullRotateRight': False,
                'turretLeft': False, 'turretRight': False,
                'fire': False,
            }
        }

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
                    'sp': round(speed_kmh, 1),
                    'w': 1 if p['at_wall'] else 0,
                    'rld': round(p['reload_timer'], 1)
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
                
                # Hit check against obstacles
                for obs in _OBSTACLES.values():
                    ox, oz = obs['position'][0], obs['position'][2]
                    rx, rz = obs['size'][0]/2, obs['size'][2]/2
                    if ox-rx <= bx <= ox+rx and oz-rz <= bz <= oz+rz:
                        hit = True
                        break
                
                if hit: break

                # Hit check against tanks
                for p_id, p in self.players.items():
                    if p_id == owner:
                        continue
                    px, pz = p['pos'][0], p['pos'][2]
                    hw_x, hw_z = _TANK_SIZE[0]/2, _TANK_SIZE[2]/2
                    if px-hw_x <= bx <= px+hw_x and pz-hw_z <= bz <= pz+hw_z:
                        hit = True
                        break
                
                if hit: break

            if not hit:
                alive_bullets.append([bx, bz, vx, vz, owner])

        self.bullets = alive_bullets

        # Process each player
        for p_id, p in self.players.items():
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
                    'size': _TANK_SIZE,
                }
                
                # Check walls
                hw_x, hw_z = _TANK_SIZE[0] / 2, _TANK_SIZE[2] / 2
                lo, hi = WORLD_MIN, WORLD_MAX
                cx = max(lo + hw_x, min(hi - hw_x, p['pos'][0]))
                cz = max(lo + hw_z, min(hi - hw_z, p['pos'][2]))
                p['at_wall'] = (cx != p['pos'][0] or cz != p['pos'][2])

                if p['at_wall']:
                    p['pos'][0], p['pos'][2] = cx, cz
                    p['vel_x'] *= 0.1
                    p['vel_z'] *= 0.1

                # Obstacle collisions
                if object_collides(tank_candidate, _OBSTACLES, ignore_id=p_id):
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
        elif t == 'ping':
            await self.send(text_data=json.dumps({
                'type': 'pong',
                'client_time': data.get('client_time', 0),
            }))

    async def game_message(self, event):
        await self.send(text_data=json.dumps(event['message']))
