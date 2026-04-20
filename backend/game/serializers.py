from rest_framework import serializers
from .models import Tank, TankStats, PlayerProfile, Arena, Obstacle

# 2 ModelSerializers
class TankStatsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TankStats
        fields = '__all__'


class TankSerializer(serializers.ModelSerializer):
    stats = TankStatsSerializer(read_only=True)
    bodyModelUrl = serializers.SerializerMethodField()
    turretModelUrl = serializers.SerializerMethodField()
    bulletModelUrl = serializers.SerializerMethodField()

    class Meta:
        model = Tank
        fields = '__all__'


    def get_bodyModelUrl(self, tank):
        return f'/3d_Models/{tank.bodyModelKey}.fbx'


    def get_turretModelUrl(self, tank):
        return f'/3d_Models/{tank.turretModelKey}.fbx'


    def get_bulletModelUrl(self, tank):
        if tank.bulletModelKey in ('default_bullet', 'default-bullet', 'primitive-bullet'):
            return None

        return f'/3d_Models/{tank.bulletModelKey}.fbx'


class ObstacleSerializer(serializers.ModelSerializer):
    modelUrl = serializers.SerializerMethodField()

    class Meta:
        model = Obstacle
        fields = '__all__'


    def get_modelUrl(self, obstacle):
        return f'/3d_Models/{obstacle.modelKey}.fbx'


class ArenaSerializer(serializers.ModelSerializer):
    obstacles = ObstacleSerializer(many=True, read_only=True)
    modelUrl = serializers.SerializerMethodField()

    class Meta:
        model = Arena
        fields = '__all__'


    def get_modelUrl(self, arena):
        return f'/3d_Models/{arena.modelKey}.fbx'


# 2 basic Serializers
class PlayerProfileSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    nickname = serializers.CharField(max_length=100)
    totalKills = serializers.IntegerField(read_only=True)
    totalDeaths = serializers.IntegerField(read_only=True)
    wins = serializers.IntegerField(read_only=True)
    losses = serializers.IntegerField(read_only=True)
    rating = serializers.IntegerField(read_only=True)

    def create(self, validated_data):
        return PlayerProfile.objects.create(**validated_data)

    def update(self, instance, validated_data):
        instance.nickname = validated_data.get('nickname', instance.nickname)
        instance.save()
        return instance

class LobbyStatusSerializer(serializers.Serializer):
    lobby_id = serializers.IntegerField()
    name = serializers.CharField()
    is_active = serializers.BooleanField()
    player_count = serializers.IntegerField()
