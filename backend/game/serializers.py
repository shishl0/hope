from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    Arena,
    FriendRequest,
    Lobby,
    LobbyInvite,
    LobbyPlayer,
    MatchPlayerStats,
    Obstacle,
    PlayerProfile,
    Tank,
    TankStats,
)


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


class PlayerProfileSerializer(serializers.ModelSerializer):
    userId = serializers.SerializerMethodField()
    publicId = serializers.SerializerMethodField()
    matchesPlayed = serializers.SerializerMethodField()
    selectedTank = TankSerializer(read_only=True)

    class Meta:
        model = PlayerProfile
        fields = [
            'id',
            'userId',
            'publicId',
            'nickname',
            'selectedTank',
            'matchesPlayed',
            'totalKills',
            'totalDeaths',
            'wins',
            'losses',
            'rating',
        ]

    def get_userId(self, profile):
        if not profile.user_id:
            raise serializers.ValidationError('Every player profile must be linked to a user ID.')
        return profile.user_id

    def get_publicId(self, profile):
        return f'P-{self.get_userId(profile):04d}'

    def get_matchesPlayed(self, profile):
        return MatchPlayerStats.objects.filter(player=profile).values('match_id').distinct().count()


class RegisterSerializer(serializers.Serializer):
    nickname = serializers.CharField(max_length=100)
    password = serializers.CharField(write_only=True, min_length=4, style={'input_type': 'password'})

    def validate_nickname(self, value):
        nickname = value.strip()
        if not nickname:
            raise serializers.ValidationError('Nickname is required.')
        if User.objects.filter(username__iexact=nickname).exists():
            raise serializers.ValidationError('This nickname is already taken.')
        if PlayerProfile.objects.filter(nickname__iexact=nickname).exists():
            raise serializers.ValidationError('This nickname is already taken.')
        return nickname

    def validate_password(self, value):
        if len(value.strip()) < 4:
            raise serializers.ValidationError('Password must be at least 4 characters long.')
        return value

    def create(self, validated_data):
        nickname = validated_data['nickname']
        password = validated_data['password']
        try:
            with transaction.atomic():
                user = User.objects.create_user(username=nickname, password=password)
                PlayerProfile.objects.create(user=user, nickname=nickname, lastSeenAt=timezone.now())
                return user
        except IntegrityError:
            raise serializers.ValidationError({'nickname': ['This nickname is already taken.']})


class ProfileUpdateSerializer(serializers.Serializer):
    nickname = serializers.CharField(max_length=100)

    def validate_nickname(self, value):
        nickname = value.strip()
        if not nickname:
            raise serializers.ValidationError('Nickname is required.')
        profile = self.context['profile']
        existing_profile = PlayerProfile.objects.filter(nickname__iexact=nickname).exclude(pk=profile.pk)
        existing_user = User.objects.filter(username__iexact=nickname).exclude(pk=profile.user_id)
        if existing_profile.exists() or existing_user.exists():
            raise serializers.ValidationError('This nickname is already taken.')
        return nickname

    def update(self, instance, validated_data):
        nickname = validated_data['nickname']
        instance.nickname = nickname
        instance.user.username = nickname
        instance.user.save(update_fields=['username'])
        instance.save(update_fields=['nickname'])
        return instance


class PasswordChangeSerializer(serializers.Serializer):
    currentPassword = serializers.CharField(write_only=True, style={'input_type': 'password'})
    newPassword = serializers.CharField(write_only=True, min_length=8, style={'input_type': 'password'})

    def validate_currentPassword(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError('Current password is incorrect.')
        return value

    def validate_newPassword(self, value):
        validate_password(value, self.context['request'].user)
        return value

    def save(self, **kwargs):
        user = self.context['request'].user
        user.set_password(self.validated_data['newPassword'])
        user.save(update_fields=['password'])
        return user


class SelectTankSerializer(serializers.Serializer):
    tank_id = serializers.IntegerField()

    def validate_tank_id(self, value):
        if not Tank.objects.filter(pk=value).exists():
            raise serializers.ValidationError('Tank not found.')
        return value


class LobbyStatusSerializer(serializers.Serializer):
    lobby_id = serializers.IntegerField()
    name = serializers.CharField()
    is_active = serializers.BooleanField()
    player_count = serializers.IntegerField()


class LobbyPlayerSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='player.id', read_only=True)
    nickname = serializers.CharField(source='player.nickname', read_only=True)
    avatar = serializers.SerializerMethodField()
    rating = serializers.IntegerField(source='player.rating', read_only=True)
    selectedTank = TankSerializer(source='player.selectedTank', read_only=True)

    class Meta:
        model = LobbyPlayer
        fields = ['id', 'nickname', 'avatar', 'rating', 'selectedTank', 'side', 'is_ready', 'joined_at']

    def get_avatar(self, obj):
        nickname = obj.player.nickname or 'T'
        return nickname[:1].upper()


class LobbySerializer(serializers.ModelSerializer):
    players = LobbyPlayerSerializer(many=True, read_only=True)
    player_count = serializers.SerializerMethodField()
    max_players = serializers.SerializerMethodField()

    class Meta:
        model = Lobby
        fields = ['id', 'name', 'is_active', 'max_players', 'player_count', 'players', 'created_at']

    def get_player_count(self, lobby):
        return lobby.players.count()

    def get_max_players(self, lobby):
        return 10


class LobbyCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    side = serializers.ChoiceField(choices=['allies', 'axis'], default='allies')

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError('Lobby name is required.')
        return name


class LobbySideSerializer(serializers.Serializer):
    side = serializers.ChoiceField(choices=['allies', 'axis'])


class FriendPlayerSerializer(serializers.ModelSerializer):
    publicId = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    matchesPlayed = serializers.SerializerMethodField()
    selectedTank = TankSerializer(read_only=True)
    isOnline = serializers.SerializerMethodField()
    daysSinceSeen = serializers.SerializerMethodField()
    activeLobbyId = serializers.SerializerMethodField()
    activeLobbyName = serializers.SerializerMethodField()

    class Meta:
        model = PlayerProfile
        fields = [
            'id',
            'publicId',
            'nickname',
            'avatar',
            'rating',
            'selectedTank',
            'matchesPlayed',
            'totalKills',
            'totalDeaths',
            'wins',
            'losses',
            'lastSeenAt',
            'isOnline',
            'daysSinceSeen',
            'activeLobbyId',
            'activeLobbyName',
        ]

    def get_publicId(self, profile):
        return f'P-{profile.user_id:04d}'

    def get_avatar(self, profile):
        return (profile.nickname or 'T')[:1].upper()

    def get_matchesPlayed(self, profile):
        return MatchPlayerStats.objects.filter(player=profile).values('match_id').distinct().count()

    def get_isOnline(self, profile):
        active_lobby = self._get_active_lobby(profile)
        if active_lobby is not None:
            return True
        if not profile.lastSeenAt:
            return False
        return (timezone.now() - profile.lastSeenAt).total_seconds() <= 300

    def get_daysSinceSeen(self, profile):
        if not profile.lastSeenAt:
            return None
        return max(0, (timezone.now().date() - profile.lastSeenAt.date()).days)

    def get_activeLobbyId(self, profile):
        lobby = self._get_active_lobby(profile)
        return lobby.id if lobby else None

    def get_activeLobbyName(self, profile):
        lobby = self._get_active_lobby(profile)
        return lobby.name if lobby else None

    def _get_active_lobby(self, profile):
        cache_name = f'_active_lobby_{profile.pk}'
        cached = getattr(self, cache_name, None)
        if cached is not None:
            return cached
        lobby_player = LobbyPlayer.objects.select_related('lobby').filter(
            player=profile,
            lobby__is_active=True,
        ).first()
        lobby = lobby_player.lobby if lobby_player else None
        setattr(self, cache_name, lobby)
        return lobby


class FriendRequestSerializer(serializers.ModelSerializer):
    fromPlayer = FriendPlayerSerializer(read_only=True)
    toPlayer = FriendPlayerSerializer(read_only=True)

    class Meta:
        model = FriendRequest
        fields = ['id', 'fromPlayer', 'toPlayer', 'status', 'created_at']


class LobbyInviteSerializer(serializers.ModelSerializer):
    fromPlayer = FriendPlayerSerializer(read_only=True)
    toPlayer = FriendPlayerSerializer(read_only=True)
    lobbyId = serializers.IntegerField(source='lobby.id', read_only=True)
    lobbyName = serializers.CharField(source='lobby.name', read_only=True)

    class Meta:
        model = LobbyInvite
        fields = ['id', 'fromPlayer', 'toPlayer', 'lobbyId', 'lobbyName', 'status', 'created_at']


class FriendsSummarySerializer(serializers.Serializer):
    playerId = serializers.CharField()
    friends = FriendPlayerSerializer(many=True)
    outgoing = FriendRequestSerializer(many=True)
    incoming = FriendRequestSerializer(many=True)
    outgoingInvites = LobbyInviteSerializer(many=True)
    incomingInvites = LobbyInviteSerializer(many=True)
