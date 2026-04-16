import json
from channels.generic.websocket import AsyncWebsocketConsumer
from .engine import GameRoom

ACTIVE_ROOMS = {}

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lobby_id = self.scope['url_route']['kwargs']['lobby_id']
        self.lobby_group_name = f'game_{self.lobby_id}'
        self.player_id = None

        if self.lobby_id not in ACTIVE_ROOMS:
            ACTIVE_ROOMS[self.lobby_id] = GameRoom(self.lobby_id, self.channel_layer)

        # Join lobby group
        await self.channel_layer.group_add(
            self.lobby_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        if self.player_id:
            room = ACTIVE_ROOMS.get(self.lobby_id)
            if room:
                await room.remove_player(self.player_id)
                # Cleanup room if empty
                if not room.players:
                    room.stop()
                    del ACTIVE_ROOMS[self.lobby_id]
            
        # Leave lobby group
        await self.channel_layer.group_discard(
            self.lobby_group_name,
            self.channel_name
        )

    # Receive message from WebSocket
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        event_type = text_data_json.get('type')
        room = ACTIVE_ROOMS.get(self.lobby_id)
        if not room: return

        if event_type == 'join':
            self.player_id = text_data_json.get('id')
            await room.add_player(self.player_id)
        elif event_type in ['input', 'mouse']:
            if self.player_id:
                await room.handle_input(self.player_id, text_data_json)

    # Receive message from lobby group (dispatched by engine.py)
    async def game_message(self, event):
        message = event['message']
        await self.send(text_data=json.dumps(message))
