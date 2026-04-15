from rest_framework import serializers
from .models import Tank, PlayerProfile, Arena, Lobby

# 2 ModelSerializers
class TankSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tank
        fields = '__all__'

class ArenaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Arena
        fields = '__all__'

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
