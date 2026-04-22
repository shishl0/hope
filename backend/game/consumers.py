import json
import asyncio
import math
import random
import time
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth.models import User
from .models import PlayerProfile, LobbyPlayer
from .engine import GameRoom
from .collision import object_collides

ACTIVE_ROOMS = {}
PROTO_ROOMS = {}

# ─────────────────────────────────────────────────────────────────
#  2D Multiplayer Consumer
# ─────────────────────────────────────────────────────────────────

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # We simulate multiple lobbies, but all join the same global room in-memory
        # Extract lobby_id from URL or default to global
        self.lobby_id = self.scope['url_route']['kwargs'].get('lobby_id', 'global')
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
                # Keep the global room alive even if empty for simulation
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
DT  = 1.0 / TPS

def _norm(a: float) -> float:
    a %= 2 * math.pi
    if a > math.pi:
        a -= 2 * math.pi
    return a

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
        self.players = {}
        self.bullets = []
        self.game_mode = 'team'
        self._running = True
        self._last_active = time.time()
        self.game_timer = 540.0 # 9 minutes
        self.team_scores = {'red': 0, 'blue': 0}
        self.match_state = 'playing'
        self.winner = None
        self.restart_timer = 0
        self._loop_task = asyncio.create_task(self._game_loop())

    async def add_player(self, channel_name, nickname=None, tank_type='t34', side='allies'):
        self.players[channel_name] = {
            'id': channel_name,
            'nickname': nickname or f'Player_{random.randint(100, 999)}',
            'pos': [0.0, 0.35, 0.0],
            'rot_y': 0.0,
            'rot_v': 0.0,
            'vel_x': 0.0, 'vel_z': 0.0,
            'turr_y': 0.0,
            'hp': 100,
            'is_dead': False,
            'respawn_timer': 0.0,
            'tank_type': tank_type,
            'at_wall': False,
            'reload_timer': 0.0,
            'inp': {
                'forward': False, 'backward': False,
                'hullRotateLeft': False, 'hullRotateRight': False,
                'turretLeft': False, 'turretRight': False,
                'fire': False,
            },
            'team': 'red' if side == 'allies' else 'blue',
            'color': 0xffffff,
            'kills': 0,
            'deaths': 0,
        }
        self._assign_team_and_spawn(channel_name)

    async def remove_player(self, channel_name):
        if channel_name in self.players:
            del self.players[channel_name]

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
            # Identify spawn zone based on team
            z_range = (-90, -70) if p['team'] == 'red' else (70, 90)
            rot_y = 0.0 if p['team'] == 'red' else math.pi
            
            # Find a safe spot in the team zone
            for _ in range(50):
                px = random.uniform(-40, 40)
                pz = random.uniform(*z_range)
                collides = False
                for other_id, other_p in self.players.items():
                    if other_id != p_id and not other_p['is_dead']:
                        if math.hypot(px - other_p['pos'][0], pz - other_p['pos'][2]) < 8.0:
                            collides = True; break
                if not collides:
                    p['pos'] = [px, 0.35, pz]
                    p['rot_y'] = rot_y
                    p['vel_x'] = 0.0; p['vel_z'] = 0.0
                    return
            # Fallback
            p['pos'] = [0, 0.35, z_range[0]]
            p['rot_y'] = rot_y
        else:
            p['team'] = 'ffa'
            p['color'] = random.randint(0, 0xffffff)
            for _ in range(50):
                px = random.uniform(-90, 90)
                pz = random.uniform(-90, 90)
                collides = False
                for other_id, other_p in self.players.items():
                    if other_id != p_id and not other_p['is_dead']:
                        if math.hypot(px - other_p['pos'][0], pz - other_p['pos'][2]) < 8.0:
                            collides = True; break
                if not collides:
                    p['pos'] = [px, 0.35, pz]
                    p['rot_y'] = random.uniform(0, math.pi * 2)
                    p['vel_x'] = 0.0; p['vel_z'] = 0.0
                    return
            p['pos'] = [0, 0.35, 0]
            p['rot_y'] = 0.0
        p['vel_x'] = 0.0; p['vel_z'] = 0.0
        
    def _is_empty(self):
        return len(self.players) == 0

    def _cleanup_check(self):
        """Shutdown room if empty for more than 30 seconds"""
        if self._is_empty():
            if time.time() - self._last_active > 30:
                self.stop()
                return True
        else:
            self._last_active = time.time()
        return False

    def _get_tank_corners(self, p):
        t_size = _TANK_CONFIGS.get(p['tank_type'], {}).get('size', _DEFAULT_TANK_SIZE)
        hw, hl = t_size[0] / 2, t_size[2] / 2
        rot = p['rot_y']
        cos_r, sin_r = math.cos(rot), math.sin(rot)
        
        corners = []
        # Local corners: (±hw, ±hl)
        for sx, sz in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            # Transform local to world:
            # x = lx * cos + lz * sin
            # z = -lx * sin + lz * cos
            lx, lz = sx * hw, sz * hl
            dx = lx * cos_r + lz * sin_r
            dz = -lx * sin_r + lz * cos_r
            corners.append([p['pos'][0] + dx, p['pos'][2] + dz])
        return corners

    def _check_tank_collision_sat(self, p1, p2, corners1=None, corners2=None):
        if corners1 is None: corners1 = self._get_tank_corners(p1)
        if corners2 is None: corners2 = self._get_tank_corners(p2)
        
        rot1, rot2 = p1['rot_y'], p2['rot_y']
        # 4 axes to check: longitudinal and transverse for both tanks
        axes = [
            [math.cos(rot1), -math.sin(rot1)],
            [math.sin(rot1), math.cos(rot1)],
            [math.cos(rot2), -math.sin(rot2)],
            [math.sin(rot2), math.cos(rot2)],
        ]
        
        for axis in axes:
            min1, max1 = float('inf'), float('-inf')
            for c in corners1:
                proj = c[0] * axis[0] + c[1] * axis[1]
                min1, max1 = min(min1, proj), max(max1, proj)
            
            min2, max2 = float('inf'), float('-inf')
            for c in corners2:
                proj = c[0] * axis[0] + c[1] * axis[1]
                min2, max2 = min(min2, proj), max(max2, proj)
                
            if max1 < min2 or max2 < min1:
                return False # Found a separating axis, no collision
        return True

    @database_sync_to_async
    def _save_match_stats(self, winner_team):
        from .models import PlayerProfile, Match, MatchPlayerStats, Lobby
        from django.utils import timezone
        
        # Create the Match record
        lobby_obj = Lobby.objects.filter(id=int(self.room_id)).first() if self.room_id.isdigit() else None
        match = Match.objects.create(
            lobby=lobby_obj,
            winner_team=winner_team,
            finished_at=timezone.now()
        )
        
        for p in self.players.values():
            nickname = p.get('nickname')
            if nickname:
                profile = PlayerProfile.objects.filter(nickname=nickname).first()
                if profile:
                    # Update global stats
                    profile.totalKills += p.get('kills', 0)
                    profile.totalDeaths += p.get('deaths', 0)
                    if p.get('team') == winner_team:
                        profile.wins += 1
                    elif winner_team and winner_team != 'draw' and p.get('team') in ['red', 'blue']:
                        profile.losses += 1
                    profile.save(update_fields=['totalKills', 'totalDeaths', 'wins', 'losses'])
                    
                    # Create per-match record
                    MatchPlayerStats.objects.create(
                        match=match,
                        player=profile,
                        kills=p.get('kills', 0),
                        deaths=p.get('deaths', 0)
                    )

    async def _game_loop(self):
        loop = asyncio.get_event_loop()
        next_tick = loop.time()
        while self._running:
            try:
                # Check for room inactivity
                if self._cleanup_check():
                    if self.room_id in PROTO_ROOMS:
                        del PROTO_ROOMS[self.room_id]
                    break

                if self.match_state == 'playing':
                    if self.game_timer > 0:
                        self.game_timer -= DT
                    else:
                        self.game_timer = 0
                        self.match_state = 'finished'
                        self.restart_timer = 10.0
                        red_sc = self.team_scores.get('red', 0)
                        blue_sc = self.team_scores.get('blue', 0)
                        if red_sc > blue_sc: self.winner = 'red'
                        elif blue_sc > red_sc: self.winner = 'blue'
                        else: self.winner = 'draw'
                        await self._save_match_stats(self.winner)
                    
                    self._tick()
                elif self.match_state == 'finished':
                    self.restart_timer -= DT
                    if self.restart_timer <= 0:
                        self.game_timer = 540.0
                        self.match_state = 'playing'
                        self.team_scores = {'red': 0, 'blue': 0}
                        self.bullets = []
                        for p_id, p in self.players.items():
                            p['hp'] = 100
                            p['is_dead'] = False
                            p['kills'] = 0
                            p['deaths'] = 0
                            p['inp'] = {'forward': False, 'backward': False, 'left': False, 'right': False, 'fire': False, 'turretLeft': False, 'turretRight': False, 'hullRotateLeft': False, 'hullRotateRight': False}
                            self._assign_team_and_spawn(p_id)
                
                # Iterate over a copy to avoid RuntimeError: dictionary changed size during iteration
                player_items = list(self.players.items())
                flat_players = []
                for p_id, p in player_items:
                    speed = math.hypot(p['vel_x'], p['vel_z'])
                    speed_kmh = speed / DT * 3.6
                    flat_players.append({
                        'id': p_id,
                        'nick': p['nickname'],
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
                        'c': p['color'],
                        'k': p['kills'],
                        'd': p['deaths'],
                        'tm': p['team']
                    })
                
                flat_bullets = [[round(b[0], 2), round(b[1], 2), round(b[2], 2), round(b[3], 2)] for b in self.bullets]
                payload = {
                    'type': 'game_message', 
                    'message': [
                        flat_players, 
                        flat_bullets, 
                        {
                            'timer': int(self.game_timer),
                            'score': self.team_scores,
                            'match_state': self.match_state,
                            'winner': self.winner,
                            'restart_timer': int(self.restart_timer)
                        }
                    ]
                }
                
                await self.channel_layer.group_send(self.group_name, payload)
                
            except Exception as e:
                print(f"[Room {self.room_id}] Loop Error: {e}")
                # Optional: import traceback; traceback.print_exc()

            next_tick += DT
            sleep_time = next_tick - loop.time()
            if sleep_time > 0: 
                await asyncio.sleep(sleep_time)
            else:
                if sleep_time < -1.0: 
                    next_tick = loop.time()

    def _tick(self):
        # Cache corners for all tanks once per tick to optimize SAT
        tank_corners = {p_id: self._get_tank_corners(p) for p_id, p in self.players.items() if not p['is_dead']}

        alive_bullets = []
        for b in self.bullets:
            bx, bz, vx, vz, owner = b
            hit = False
            for _step in range(6):
                bx += vx / 6.0
                bz += vz / 6.0
                if not (WORLD_MIN <= bx <= WORLD_MAX and WORLD_MIN <= bz <= WORLD_MAX):
                    hit = True; break
                for p_id, p in self.players.items():
                    if p_id == owner or p['is_dead']: continue
                    
                    if self.game_mode == 'team' and owner in self.players:
                        if p['team'] == self.players[owner]['team']:
                            continue
                    
                    # Use cached corners for collision check
                    p_corners = tank_corners.get(p_id)
                    if not p_corners: continue
                    
                    dx, dz = bx - p['pos'][0], bz - p['pos'][2]
                    rot = p['rot_y']
                    cos_r, sin_r = math.cos(rot), math.sin(rot)
                    local_x = dx * cos_r - dz * sin_r
                    local_z = dx * sin_r + dz * cos_r
                    t_size = _TANK_CONFIGS.get(p['tank_type'], {}).get('size', _DEFAULT_TANK_SIZE)
                    hw_x, hw_z = t_size[0]/2, t_size[2]/2
                    if -hw_x <= local_x <= hw_x and -hw_z <= local_z <= hw_z:
                        # Hit!
                        p['hp'] -= 25
                        hit = True
                        if p['hp'] <= 0:
                            p['is_dead'] = True
                            p['hp'] = 0
                            p['deaths'] += 1
                            p['respawn_timer'] = 5.0
                            # Score for killer
                            if owner in self.players:
                                killer = self.players[owner]
                                killer['kills'] += 1
                                if self.game_mode == 'team':
                                    self.team_scores[killer['team']] += 1
                        break
                if hit: break
            if not hit: alive_bullets.append([bx, bz, vx, vz, owner])
        self.bullets = alive_bullets

        for p_id, p in self.players.items():
            if p['is_dead']:
                p['respawn_timer'] -= DT
                if p['respawn_timer'] <= 0:
                    p['is_dead'] = False
                    p['hp'] = 100
                    self._assign_team_and_spawn(p_id)
                continue
            inp = p['inp']
            fwd, bwd = inp['forward'], inp['backward']
            speed = math.hypot(p['vel_x'], p['vel_z'])
            speed_ratio = min(speed / MAX_V_FWD, 1.0)
            turn_rate = TURN_SLOW + (TURN_FAST - TURN_SLOW) * (speed_ratio ** TURN_EXP)
            rot_accel = turn_rate * 0.15
            if inp['hullRotateLeft']: p['rot_v'] += rot_accel
            elif inp['hullRotateRight']: p['rot_v'] -= rot_accel
            else: p['rot_v'] *= 0.82
            p['rot_v'] = max(-turn_rate, min(turn_rate, p['rot_v']))
            p['rot_y'] = _norm(p['rot_y'] + p['rot_v'])
            if inp['turretLeft']: p['turr_y'] += TURRET_SPD
            if inp['turretRight']: p['turr_y'] -= TURRET_SPD
            p['turr_y'] = _norm(p['turr_y'])
            hx, hz = math.sin(p['rot_y']), math.cos(p['rot_y'])
            vf, vl = p['vel_x']*hx + p['vel_z']*hz, p['vel_x']*hz - p['vel_z']*hx
            if fwd and not bwd:
                if vf >= 0: vf = min(vf + ACCEL_BASE_FWD * (max(0.0, 1.0-(vf/MAX_V_FWD))**ACCEL_EXP), MAX_V_FWD)
                else: vf = min(0.0, vf + BRAKE_FORCE)
            elif bwd and not fwd:
                if vf <= 0: vf = max(vf - ACCEL_BASE_BWD * (max(0.0, 1.0-(abs(vf)/MAX_V_BWD))**ACCEL_EXP), -MAX_V_BWD)
                else: vf = max(0.0, vf - BRAKE_FORCE)
            else:
                if vf > 0: vf = max(0.0, vf - FRICTION)
                elif vf < 0: vf = min(0.0, vf + FRICTION)
            vl *= 0.82 if speed_ratio <= 0.45 else 0.96
            p['vel_x'], p['vel_z'] = vf*hx + vl*hz, vf*hz - vl*hx
            if speed > 1e-7:
                px, pz = p['pos'][0], p['pos'][2]
                p['pos'][0] += p['vel_x']; p['pos'][2] += p['vel_z']
                t_size = _TANK_CONFIGS.get(p['tank_type'], {}).get('size', _DEFAULT_TANK_SIZE)
                hw_x, hw_z = t_size[0]/2, t_size[2]/2
                cx = max(WORLD_MIN + hw_x, min(WORLD_MAX - hw_x, p['pos'][0]))
                cz = max(WORLD_MIN + hw_z, min(WORLD_MAX - hw_z, p['pos'][2]))
                p['at_wall'] = (cx != p['pos'][0] or cz != p['pos'][2])
                if p['at_wall']: p['pos'][0], p['pos'][2] = cx, cz
                tank_collided = False
                for oid, op in self.players.items():
                    if oid != p_id and not op['is_dead']:
                        # Fast circular pre-check
                        dist = math.hypot(p['pos'][0]-op['pos'][0], p['pos'][2]-op['pos'][2])
                        if dist < 9.0: 
                            # Use fresh corners for the moving player (p) and cached for others
                            if self._check_tank_collision_sat(p, op, corners1=self._get_tank_corners(p), corners2=tank_corners.get(oid)):
                                tank_collided = True; break
                if tank_collided: p['pos'][0], p['pos'][2], p['vel_x'], p['vel_z'] = px, pz, 0, 0
            if p['reload_timer'] > 0: p['reload_timer'] = max(0.0, p['reload_timer'] - DT)
            if inp['fire'] and p['reload_timer'] == 0:
                p['reload_timer'] = 7.0
                wt = p['rot_y'] + p['turr_y']
                bx, bz = p['pos'][0] + math.sin(wt)*1.5, p['pos'][2] + math.cos(wt)*1.5
                self.bullets.append([bx, bz, math.sin(wt)*PROTO_BULLET_SPEED, math.cos(wt)*PROTO_BULLET_SPEED, p_id])


class ProtoTankConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Get session_id from URL
        self.session_id = self.scope['url_route']['kwargs'].get('session_id', 'global')
        self.lobby_id = self.session_id # for internal reference
        self.group_name = f'prototank_{self.session_id}'
        self.player_id = self.channel_name
        
        # Try to get nickname and token from query string
        query_string = self.scope.get('query_string', b'').decode('utf-8')
        params = dict(x.split('=') for x in query_string.split('&') if '=' in x)
        nickname = params.get('nick')
        token = params.get('token')

        # Authenticate via token if provided
        self.user = await self._get_user_from_token(token)

        if self.lobby_id not in PROTO_ROOMS:
            PROTO_ROOMS[self.lobby_id] = ProtoTankRoom(self.lobby_id, self.channel_layer)
        
        room = PROTO_ROOMS[self.lobby_id]
        
        # Get player info from DB
        player_info = await self._get_player_info()
        tank_type = player_info.get('tank_type', 't34')
        side = player_info.get('side', 'allies')

        # Prevent duplicate tanks for the same account
        if nickname:
            for old_id, p in list(room.players.items()):
                if p.get('nickname') == nickname:
                    await room.remove_player(old_id)

        await room.add_player(self.player_id, nickname=nickname, tank_type=tank_type, side=side)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({'type': 'init', 'id': self.player_id}))

    @database_sync_to_async
    def _get_user_from_token(self, token):
        if not token:
            return None
        try:
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            return User.objects.get(id=user_id)
        except Exception:
            return None

    @database_sync_to_async
    def _get_player_info(self):
        user = self.user
        if not user:
            return {'tank_type': 't34', 'side': 'allies'}
        
        profile = PlayerProfile.objects.select_related('selectedTank').filter(user=user).first()
        membership = LobbyPlayer.objects.filter(lobby_id=self.lobby_id, player=profile).first()
        
        tank_key = 't34'
        if profile and profile.selectedTank:
            name = profile.selectedTank.name.lower()
            if 'pz' in name or 'panzer' in name:
                tank_key = 'pz4'
        
        return {
            'tank_type': tank_key,
            'side': membership.side if membership else 'allies'
        }

    async def disconnect(self, close_code):
        room = PROTO_ROOMS.get(self.lobby_id)
        if room:
            await room.remove_player(self.player_id)
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try: data = json.loads(text_data)
        except: return
        t = data.get('type')
        room = PROTO_ROOMS.get(self.lobby_id)
        if not room: return
        if t == 'input': room.update_input(self.player_id, data)
        elif t == 'change_tank': room.update_tank_type(self.player_id, data.get('tank_type'))
        elif t == 'change_mode': room.change_mode(data.get('mode'))
        elif t == 'ping': await self.send(text_data=json.dumps({'type': 'pong', 'client_time': data.get('client_time', 0)}))

    async def game_message(self, event):
        await self.send(text_data=json.dumps(event['message']))
