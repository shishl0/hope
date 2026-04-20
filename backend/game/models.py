from django.db import models
from django.contrib.auth.models import User

class TankStats(models.Model):
    moveSpeed = models.FloatField(default=10.0)
    maxHP = models.IntegerField(default=100)
    reloadSpeed = models.FloatField(default=1.0)
    rotationSpeed = models.FloatField(default=2.0)
    turretRotationSpeed = models.FloatField(default=3.0)
    bulletSpeed = models.FloatField(default=20.0)
    bulletDamage = models.IntegerField(default=20)

    def __str__(self):
        return f"Stats {self.id}"


class Tank(models.Model):
    name = models.CharField(max_length=100)
    side = models.CharField(max_length=50, blank=True, null=True)
    bodyModelKey = models.CharField(max_length=100, default='default_body')
    turretModelKey = models.CharField(max_length=100, default='default_turret')
    bulletModelKey = models.CharField(max_length=100, default='default_bullet')
    description = models.TextField(blank=True, null=True)
    stats = models.ForeignKey(TankStats, on_delete=models.SET_NULL, null=True, related_name='tanks')

    def __str__(self):
        return self.name


class PlayerProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    nickname = models.CharField(max_length=100, unique=True)
    selectedTank = models.ForeignKey(Tank, on_delete=models.SET_NULL, null=True, blank=True)
    totalKills = models.IntegerField(default=0)
    totalDeaths = models.IntegerField(default=0)
    wins = models.IntegerField(default=0)
    losses = models.IntegerField(default=0)
    rating = models.IntegerField(default=1000)

    def __str__(self):
        return self.nickname


class Arena(models.Model):
    name = models.CharField(max_length=100)
    modelKey = models.CharField(max_length=100, default='default_arena')
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.name


class Obstacle(models.Model):
    arena = models.ForeignKey(Arena, on_delete=models.CASCADE, related_name='obstacles')
    type = models.CharField(max_length=50) # e.g. Box, Wall
    modelKey = models.CharField(max_length=100, default='default_obstacle')
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()
    rotationY = models.FloatField(default=0)
    scaleX = models.FloatField(default=1)
    scaleY = models.FloatField(default=1)
    scaleZ = models.FloatField(default=1)

    def __str__(self):
        return f"{self.type} at {self.x}, {self.z}"


class Lobby(models.Model):
    name = models.CharField(max_length=100)
    arena = models.ForeignKey(Arena, on_delete=models.SET_NULL, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class LobbyPlayer(models.Model):
    lobby = models.ForeignKey(Lobby, on_delete=models.CASCADE, related_name='players')
    player = models.ForeignKey(PlayerProfile, on_delete=models.CASCADE)
    is_ready = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)


class Match(models.Model):
    lobby = models.OneToOneField(Lobby, on_delete=models.SET_NULL, null=True)
    winner_team = models.CharField(max_length=50, blank=True, null=True) # or specific player
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)


class MatchPlayerStats(models.Model):
    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name='player_stats')
    player = models.ForeignKey(PlayerProfile, on_delete=models.CASCADE)
    kills = models.IntegerField(default=0)
    deaths = models.IntegerField(default=0)
