import json
import asyncio
import math
from channels.generic.websocket import AsyncWebsocketConsumer
from .engine import GameRoom
from .collision import object_collides

ACTIVE_ROOMS = {}

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
#  3D ProtoTank Consumer — server-authoritative 60 TPS physics
#
#  Physics model:
#   • Non-linear acceleration: fast from 0→10 km/h, progressively
#     harder to reach 65 km/h   (power-curve by exponent)
#   • Speed-dependent turning: slow pivot on the spot, easy at speed
#   • Active braking: pressing opposite direction applies a strong
#     brake force (separate from passive friction)
#   • Passive friction when no key: decelerates over ~2 sec
#
#  World:  X, Z ∈ [-110, 90]
#  TPS:    60
# ─────────────────────────────────────────────────────────────────

TPS = 60
DT  = 1.0 / TPS   # seconds per tick


def _norm(a: float) -> float:
    """Normalise angle to (-π, π]."""
    a %= 2 * math.pi
    if a > math.pi:
        a -= 2 * math.pi
    return a


# ── Scene obstacles (must mirror the Angular scene) ───────────────

_OBSTACLES: dict = {
    'obstacle-1': {'id': 'obstacle-1',
                   'position': [0.0, 0.5, 5.0],
                   'rotation': [0.0, 0.0, 0.0],
                   'size':     [2.0, 1.0, 2.0]},
    'obstacle-2': {'id': 'obstacle-2',
                   'position': [4.0, 0.5, 2.0],
                   'rotation': [0.0, 0.0, 0.0],
                   'size':     [2.0, 1.0, 2.0]},
}

_TANK_SIZE = [1.6, 0.7, 2.4]   # bounding box (XYZ)

# ── Physics parameters ────────────────────────────────────────────

# Speed caps in units/tick  (u/s × DT = u/tick)
MAX_V_FWD  = 65.0  / 3.6 * DT   # 65 km/h → ~0.3009 u/tick
MAX_V_BWD  = 20.0  / 3.6 * DT   # 20 km/h → ~0.0926 u/tick

# Non-linear acceleration:
#   raw accel per tick = ACCEL_BASE × (1 - (v/v_max))^ACCEL_EXP
#   ACCEL_BASE tunes overall rate; ACCEL_EXP > 0 → fast start, slow top
ACCEL_BASE_FWD = 0.00095  # u/tick²  (tuned for 0→65 in ~12 sec)
ACCEL_BASE_BWD = 0.00080  # u/tick²  (tuned for 0→20 in ~7 sec)
ACCEL_EXP      = 0.55     # exponent; 0 = linear, 1 = full taper

# Friction (passive deceleration when no key pressed)
FRICTION = 0.0018   # u/tick²  → stops from 65 km/h in ~167 ticks ≈ 2.8 s

# Active brake force (pressing W while reversing or S while going fwd)
BRAKE_FORCE = 0.0065   # u/tick²  → stops from 65 km/h in ~46 ticks ≈ 0.77 s

# Turret
TURRET_SPD = 0.03   # rad/tick

# Speed-dependent turning:
#   angle_per_tick = lerp(TURN_SLOW, TURN_FAST, speed_ratio^TURN_EXP)
TURN_SLOW = 0.018   # rad/tick  at rest  (≈ 1.0°/tick)
TURN_FAST = 0.042   # rad/tick  at max   (≈ 2.4°/tick)
TURN_EXP  = 0.6     # < 1 → gain turn speed quickly at low speed

# World
WORLD_MIN = -110.0
WORLD_MAX  =  90.0


class ProtoTankConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        await self.accept()
        self.pos    = [0.0, 0.35, 0.0]
        self.rot_y  = 0.0
        self.rot_v  = 0.0        # angular velocity
        self.vel_x  = 0.0        # 2D velocity vector
        self.vel_z  = 0.0
        self.turr_y = 0.0
        self.at_wall = False

        self.inp = {
            'forward': False, 'backward': False,
            'hullRotateLeft': False, 'hullRotateRight': False,
            'turretLeft': False, 'turretRight': False,
        }

        self._running   = True
        self._loop_task = asyncio.create_task(self._game_loop())

    async def disconnect(self, close_code):
        self._running = False
        self._loop_task.cancel()

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, ValueError):
            return

        t = data.get('type')
        if t == 'input':
            for key in self.inp:
                if key in data:
                    self.inp[key] = bool(data[key])
        elif t == 'ping':
            await self.send(text_data=json.dumps({
                'type': 'pong',
                'client_time': data.get('client_time', 0),
            }))

    # ── 60 TPS game loop ──────────────────────────────────────────

    async def _game_loop(self):
        loop      = asyncio.get_event_loop()
        next_tick = loop.time()
        tick_counter = 0

        while self._running:
            self._tick()
            tick_counter += 1
            
            if tick_counter % 3 == 0:
                speed = math.hypot(self.vel_x, self.vel_z)
                speed_kmh = speed / DT * 3.6  # convert u/tick → km/h

                try:
                    # Flat array: [x, z, rot_y, turr_y, speed_kmh, at_wall]
                    await self.send(text_data=json.dumps([
                        round(self.pos[0], 3),
                        round(self.pos[2], 3),
                        round(self.rot_y, 4),
                        round(self.turr_y, 4),
                        round(speed_kmh, 1),
                        1 if self.at_wall else 0
                    ]))
                except Exception:
                    # Socket might have closed unexpectedly
                    break

            next_tick += DT
            sleep_time = next_tick - loop.time()
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            else:
                # Loop is lagging, skip up to speed but don't sleep
                if sleep_time < -1.0: # severe lag (> 1s)
                    next_tick = loop.time()

    # ── Physics tick ──────────────────────────────────────────────

    def _tick(self):
        inp = self.inp
        fwd = inp['forward']
        bwd = inp['backward']
        speed = math.hypot(self.vel_x, self.vel_z)

        # ── Speed-dependent turning with inertia ───────────────────
        speed_ratio = min(speed / MAX_V_FWD, 1.0)
        turn_rate   = TURN_SLOW + (TURN_FAST - TURN_SLOW) * (speed_ratio ** TURN_EXP)

        # Acceleration of the turn (how fast it reaches the max turn_rate)
        # Slower at low speeds to simulate track weight
        rot_accel = turn_rate * 0.15

        if inp['hullRotateLeft']:
            self.rot_v += rot_accel
        elif inp['hullRotateRight']:
            self.rot_v -= rot_accel
        else:
            # Friction for angular velocity when keys are released
            self.rot_v *= 0.82
            if abs(self.rot_v) < 0.0001:
                self.rot_v = 0.0

        # Cap the angular velocity to the maximum turn rate
        self.rot_v = max(-turn_rate, min(turn_rate, self.rot_v))

        # Apply angular velocity to rotation
        self.rot_y += self.rot_v
        self.rot_y = _norm(self.rot_y)

        # ── Turret ─────────────────────────────────────────────────
        if inp['turretLeft']:
            self.turr_y += TURRET_SPD
        if inp['turretRight']:
            self.turr_y -= TURRET_SPD
        self.turr_y = _norm(self.turr_y)

        # ── 2D DRIFT PHYSICS ───────────────────────────────────────
        heading_x = math.sin(self.rot_y)
        heading_z = math.cos(self.rot_y)

        # 1. Component vectors (Forward and Lateral)
        v_fwd = self.vel_x * heading_x + self.vel_z * heading_z
        v_lat = self.vel_x * heading_z - self.vel_z * heading_x  # right is positive

        # 2. Longitudinal forces
        if fwd and not bwd:
            if v_fwd >= 0:
                taper = max(0.0, 1.0 - (v_fwd / MAX_V_FWD)) ** ACCEL_EXP
                v_fwd += ACCEL_BASE_FWD * taper
                v_fwd = min(v_fwd, MAX_V_FWD)
            else:
                v_fwd += BRAKE_FORCE
                if v_fwd > 0: v_fwd = 0.0
        elif bwd and not fwd:
            if v_fwd <= 0:
                taper = max(0.0, 1.0 - (abs(v_fwd) / MAX_V_BWD)) ** ACCEL_EXP
                v_fwd -= ACCEL_BASE_BWD * taper
                v_fwd = max(v_fwd, -MAX_V_BWD)
            else:
                v_fwd -= BRAKE_FORCE
                if v_fwd < 0: v_fwd = 0.0
        else:
            if v_fwd > 0:
                v_fwd = max(0.0, v_fwd - FRICTION)
            elif v_fwd < 0:
                v_fwd = min(0.0, v_fwd + FRICTION)

        # 3. Lateral grip (track friction & drift)
        # Normally removes sideways slip. But if moving fast and turning sharply,
        # we reduce grip so the tank slides outwards (drifts).
        drift_factor = 0.82
        if speed_ratio > 0.45 and abs(self.rot_v) > turn_rate * 0.4:
            # Dynamic loss of traction -> drifting "как по маслу"
            drift_factor = 0.96

        v_lat *= drift_factor

        # 4. Reconstruct absolute velocity
        self.vel_x = v_fwd * heading_x + v_lat * heading_z
        self.vel_z = v_fwd * heading_z - v_lat * heading_x

        # ── Position update ────────────────────────────────────────
        if speed > 1e-7:
            prev_x, prev_z = self.pos[0], self.pos[2]

            self.pos[0] += self.vel_x
            self.pos[2] += self.vel_z

            # AABB obstacle collision
            tank_candidate = {
                'id':       'player',
                'position': self.pos[:],
                'rotation': [0.0, self.rot_y, 0.0],
                'size':     _TANK_SIZE,
            }
            if object_collides(tank_candidate, _OBSTACLES, ignore_id='player'):
                self.pos[0] = prev_x
                self.pos[2] = prev_z
                self.vel_x  = 0.0
                self.vel_z  = 0.0

        # ── World boundary ─────────────────────────────────────────
        hw_x = _TANK_SIZE[0] / 2
        hw_z = _TANK_SIZE[2] / 2
        lo, hi = WORLD_MIN, WORLD_MAX

        cx = max(lo + hw_x, min(hi - hw_x, self.pos[0]))
        cz = max(lo + hw_z, min(hi - hw_z, self.pos[2]))
        self.at_wall = (cx != self.pos[0] or cz != self.pos[2])

        if self.at_wall:
            self.pos[0] = cx
            self.pos[2] = cz
            self.vel_x *= 0.1   # wall stop
            self.vel_z *= 0.1
