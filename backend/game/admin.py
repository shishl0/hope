from django.contrib import admin
from .models import (
    TankStats, Tank, PlayerProfile, Arena, Obstacle,
    Lobby, LobbyPlayer, Match, MatchPlayerStats
)


@admin.register(TankStats)
class TankStatsAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'moveSpeed', 'maxHP', 'reloadSpeed',
        'rotationSpeed', 'turretRotationSpeed', 'bulletSpeed', 'bulletDamage'
    )


@admin.register(Tank)
class TankAdmin(admin.ModelAdmin):
    list_display = ('name', 'side', 'bodyModelKey', 'turretModelKey', 'bulletModelKey', 'stats')
    list_filter = ('side',)
    search_fields = ('name', 'side', 'bodyModelKey', 'turretModelKey')
    list_select_related = ('stats',)


class ObstacleInline(admin.TabularInline):
    model = Obstacle
    extra = 0
    fields = ('type', 'modelKey', 'x', 'y', 'z', 'rotationY', 'scaleX', 'scaleY', 'scaleZ')


@admin.register(Arena)
class ArenaAdmin(admin.ModelAdmin):
    list_display = ('name', 'modelKey', 'description')
    search_fields = ('name', 'modelKey')
    inlines = [ObstacleInline]


@admin.register(Obstacle)
class ObstacleAdmin(admin.ModelAdmin):
    list_display = ('type', 'arena', 'modelKey', 'x', 'y', 'z', 'rotationY', 'scaleX', 'scaleY', 'scaleZ')
    list_filter = ('arena', 'type', 'modelKey')
    search_fields = ('type', 'modelKey', 'arena__name')


admin.site.register(PlayerProfile)


@admin.register(Lobby)
class LobbyAdmin(admin.ModelAdmin):
    list_display = ('name', 'arena', 'is_active', 'created_at')
    list_filter = ('is_active', 'arena')
    search_fields = ('name', 'arena__name')
    list_select_related = ('arena',)


@admin.register(LobbyPlayer)
class LobbyPlayerAdmin(admin.ModelAdmin):
    list_display = ('lobby', 'player', 'is_ready', 'joined_at')
    list_filter = ('is_ready', 'lobby')
    list_select_related = ('lobby', 'player')


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'lobby', 'winner_team', 'started_at', 'finished_at')
    list_select_related = ('lobby',)


@admin.register(MatchPlayerStats)
class MatchPlayerStatsAdmin(admin.ModelAdmin):
    list_display = ('match', 'player', 'kills', 'deaths')
    list_select_related = ('match', 'player')
