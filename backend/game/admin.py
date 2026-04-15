from django.contrib import admin
from .models import (
    TankStats, Tank, PlayerProfile, Arena, Obstacle,
    Lobby, LobbyPlayer, Match, MatchPlayerStats
)

admin.site.register(TankStats)
admin.site.register(Tank)
admin.site.register(PlayerProfile)
admin.site.register(Arena)
admin.site.register(Obstacle)
admin.site.register(Lobby)
admin.site.register(LobbyPlayer)
admin.site.register(Match)
admin.site.register(MatchPlayerStats)
