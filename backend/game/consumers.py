import json
from channels.generic.websocket import AsyncWebsocketConsumer

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lobby_id = self.scope['url_route']['kwargs']['lobby_id']
        self.lobby_group_name = f'game_{self.lobby_id}'
        self.player_id = None

        # Join lobby group
        await self.channel_layer.group_add(
            self.lobby_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        # Broadcast leave event
        if self.player_id:
            await self.channel_layer.group_send(
                self.lobby_group_name,
                {
                    'type': 'game_message',
                    'message': {
                        'type': 'leave',
                        'id': self.player_id
                    }
                }
            )
            
        # Leave lobby group
        await self.channel_layer.group_discard(
            self.lobby_group_name,
            self.channel_name
        )

    # Receive message from WebSocket
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        event_type = text_data_json.get('type')
        
        if 'id' in text_data_json and not self.player_id:
            self.player_id = text_data_json.get('id')

        # Send message to lobby group
        await self.channel_layer.group_send(
            self.lobby_group_name,
            {
                'type': 'game_message',
                'message': text_data_json
            }
        )


    # Receive message from lobby group
    async def game_message(self, event):
        message = event['message']

        # Send message to WebSocket
        await self.send(text_data=json.dumps(message))
