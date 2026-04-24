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
from .logic import ProtoTankRoom
from .collision import object_collides

ACTIVE_ROOMS = {}
PROTO_ROOMS = {}

def remove_proto_room(room_id):
    if room_id in PROTO_ROOMS:
        del PROTO_ROOMS[room_id]

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
# ProtoTankRoom logic moved to logic.py


class ProtoTankConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Get session_id from URL
        self.session_id = self.scope['url_route']['kwargs'].get('session_id', 'global')
        self.lobby_id = self.session_id # for internal reference
        self.group_name = f'prototank_{self.session_id}'
        self.player_id = self.channel_name
        
        # Try to get token from query string
        query_string = self.scope.get('query_string', b'').decode('utf-8')
        params = dict(x.split('=', 1) for x in query_string.split('&') if '=' in x)
        token = params.get('token')

        # Authenticate via token
        self.user = await self._get_user_from_token(token)

        if self.lobby_id not in PROTO_ROOMS:
            room = ProtoTankRoom(self.lobby_id, self.channel_layer)
            room.cleanup_callback = remove_proto_room
            PROTO_ROOMS[self.lobby_id] = room
        
        room = PROTO_ROOMS[self.lobby_id]
        
        # Get player info from DB (this gets the correct nickname and tank config)
        player_info = await self._get_player_info()
        nickname = player_info.get('nickname', f'Player_{random.randint(100, 999)}')
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
            'nickname': profile.nickname if profile else f'Guest_{random.randint(100, 999)}',
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
        elif t == 'ping': 
            await self.send(text_data=json.dumps({'type': 'pong', 'client_time': data.get('client_time', 0)}))
            if self.user:
                await self._update_last_seen()

    @database_sync_to_async
    def _update_last_seen(self):
        from django.utils import timezone
        PlayerProfile.objects.filter(user=self.user).update(lastSeenAt=timezone.now())

    async def game_message(self, event):
        await self.send(text_data=json.dumps(event['message']))
