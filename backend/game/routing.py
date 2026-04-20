from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # 2D multiplayer lobby
    re_path(r'ws/game/(?P<lobby_id>\w+)/$', consumers.GameConsumer.as_asgi()),
    # 3D proto-tank session
    re_path(r'ws/proto-tank/(?P<session_id>\w+)/$', consumers.ProtoTankConsumer.as_asgi()),
]
